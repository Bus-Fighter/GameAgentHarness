import { ArtifactStore } from "../core/artifact-store.js";
import { TraceSession } from "../core/trace-session.js";
import { buildSummary } from "../core/summary-builder.js";
import { WebSocketServer } from "./websocket-server.js";
import { encodeTextFrame } from "./websocket-codec.js";
import { DashboardServer } from "../dashboard/dashboard-server.js";
import { FrameStore } from "../dashboard/frame-store.js";
import { findGodotBin, launchEditor, killProcess } from "../core/editor-launcher.js";
import { loadProfile } from "../core/profile.js";
import path from "node:path";

export class HarnessHost {
  constructor({
    port = 8765,
    host = "127.0.0.1",
    traceDir = "traces",
    projectRoot = process.cwd(),
    dashboard = false,
    dashboardHost = "127.0.0.1",
    dashboardPort = 8766,
    godotBin = null,
    profilePath = null,
  } = {}) {
    this.port = Number(port);
    this.host = host;
    this.projectRoot = path.resolve(projectRoot);
    this.godotBin = godotBin || findGodotBin();
    this.profile = profilePath ? loadProfile(profilePath) : null;
    this.editorProcess = null;
    this.store = new ArtifactStore(traceDir);
    this.trace = null;
    this.server = new WebSocketServer({
      port: this.port,
      host: this.host,
      onConnection: (socket) => this.onConnection(socket),
      onMessage: (socket, message) => this.onMessage(socket, message),
      onClose: () => this.dashboard?.broadcastStatus(),
    });
    this.frameStore = new FrameStore();
    this.dashboard = dashboard
      ? new DashboardServer({
          host: dashboardHost,
          port: Number(dashboardPort),
          traceDir,
          projectRoot: this.projectRoot,
          intakePort: this.port,
          engineClientCount: () => this.server.clients.size,
          lastEngineAt: () => this.lastEngineAt,
          onControlMessage: (message) => this.handleDashboardControl(message),
          getRuntimeContext: () => ({ runtime: { running: this.runtimeRunning } }),
          onFlushTrace: () => this.trace?.flush(),
          profile: this.profile,
        })
      : null;
    this.liveFrameSeq = 0;
    this.lastEngineAt = null;
    this.runtimeRunning = false;
  }

  async start() {
    await this.server.start();
    if (this.dashboard) {
      this.dashboard.setFrameStore(this.frameStore);
      await this.dashboard.start();
    }
  }

  stop() {
    this.trace?.stop();
    if (this.trace) {
      buildSummary(this.store, this.trace.traceId);
    }
    this.dashboard?.stop();
    this.server.stop();
  }

  onConnection(socket) {
    this.lastEngineAt = new Date().toISOString();
    this.dashboard?.broadcastStatus();
    this.server.send(socket, {
      kind: "host.hello",
      host: "game-agent-harness",
      protocolVersion: 1,
      traceActive: Boolean(this.trace),
      traceId: this.trace?.traceId ?? null,
    });
  }

  onMessage(socket, text) {
    this.lastEngineAt = new Date().toISOString();
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      this.server.send(socket, { kind: "host.error", error: `Invalid JSON: ${error.message}` });
      return;
    }

    if (message.kind === "control") {
      this.handleControl(socket, message);
      return;
    }

    if (message.kind === "frame") {
      this.handleFrame(socket, message);
      return;
    }

    if (!this.trace) {
      this.trace = new TraceSession(this.store, {
        context: {
          source: message.source ?? "unknown",
          engine: message.engine ?? null,
          project: message.project ?? null,
          firstSeenAt: new Date().toISOString(),
        },
      });
      this.dashboard?.setTrace(this.trace);
      console.log(`[harness] started trace ${this.trace.traceId}`);
    }

    const event = this.trace.append(message);
    this.dashboard?.broadcastEvent(event);
    if (event.type === "engine.connected") {
      this.sendSignalSubscriptions(socket);
    } else if (event.type === "runtime.started") {
      this.runtimeRunning = true;
      this.dashboard?.broadcast({ kind: "context", context: { runtime: { running: true } } });
    } else if (event.type === "runtime.stopped") {
      this.runtimeRunning = false;
      this.dashboard?.broadcast({ kind: "context", context: { runtime: { running: false } } });
    }
    this.server.send(socket, { kind: "host.ack", seq: event.seq, traceId: event.traceId });
  }

  handleFrame(socket, message) {
    if (!message.data || typeof message.data !== "string") {
      this.server.send(socket, { kind: "host.error", error: "Frame missing base64 data" });
      return;
    }

    let buffer;
    try {
      buffer = Buffer.from(message.data, "base64");
    } catch (error) {
      this.server.send(socket, { kind: "host.error", error: `Invalid frame data: ${error.message}` });
      return;
    }

    console.log(`[harness] received frame ${message.width ?? "?"}x${message.height ?? "?"} ${buffer.length} bytes from ${message.source ?? "unknown"}`);

    const format = message.format === "jpeg" || message.format === "jpg" ? "jpg" : "png";
    const contentType = format === "jpg" ? "image/jpeg" : "image/png";
    let seq = null;
    let fileName = null;

    if (message.persist && this.trace) {
      seq = this.trace.nextSeq();
      fileName = `frame-${seq}.${format}`;
      const evidencePath = this.store.writeBinary(this.trace.traceId, path.join("evidence", fileName), buffer);
      this.trace.registerEvidenceFile(evidencePath);
      const event = this.trace.append({
        kind: "event",
        type: "evidence.frame",
        source: message.source ?? "unknown",
        engine: message.engine ?? null,
        project: message.project ?? null,
        entity: message.entity ?? null,
        data: {
          path: fileName,
          width: message.width ?? null,
          height: message.height ?? null,
          format,
          source: message.source ?? "unknown",
        },
      });
      this.dashboard?.broadcastEvent(event);
    } else if (this.trace) {
      seq = ++this.liveFrameSeq;
    }

    const frame = {
      buffer,
      contentType,
      source: message.source ?? "unknown",
      width: message.width ?? null,
      height: message.height ?? null,
      seq,
      traceId: this.trace?.traceId ?? null,
      receivedAt: new Date().toISOString(),
    };
    this.frameStore.setFrame(frame);
    this.dashboard?.broadcastFrame(frame);

    this.server.send(socket, {
      kind: "host.ack",
      seq,
      traceId: this.trace?.traceId ?? null,
    });
  }

  forwardControlToEngine(message) {
    const payload = { kind: "control", ...message };
    const text = JSON.stringify(payload);
    const frame = encodeTextFrame(text);
    for (const client of this.server.clients) {
      try {
        this.server.sendFrame(client, frame);
      } catch {}
    }
  }

  handleDashboardControl(message) {
    if (message.action === "launch.editor") {
      this.handleLaunchEditor(message);
      return;
    }
    this.forwardControlToEngine(message);
  }

  handleLaunchEditor(_message) {
    if (this.editorProcess) {
      console.log("[harness] restarting Godot editor");
      killProcess(this.editorProcess);
      this.editorProcess = null;
    } else {
      console.log("[harness] launching Godot editor");
    }

    try {
      this.editorProcess = launchEditor({ godotBin: this.godotBin, projectRoot: this.projectRoot });
      this.dashboard?.broadcast({ kind: "editor.launch", ok: true, pid: this.editorProcess.pid });
    } catch (error) {
      console.error(`[harness] launch editor failed: ${error.message}`);
      this.dashboard?.broadcast({ kind: "editor.launch", ok: false, error: error.message });
    }
  }

  sendSignalSubscriptions(socket) {
    const subscriptions = this.profile?.signalSubscriptions ?? this.profile?.raw?.signalSubscriptions ?? [];
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
      return;
    }
    for (const sub of subscriptions) {
      this.server.send(socket, {
        kind: "control",
        action: "signal.subscribe",
        match: sub.match ?? {},
        signal: sub.signal,
        eventType: sub.eventType,
        argMapping: sub.argMapping ?? [],
      });
    }
  }

  handleControl(socket, message) {
    if (message.action === "trace.start") {
      if (!this.trace || this.trace.endedAt) {
        this.trace = new TraceSession(this.store, { context: message.context ?? null });
        this.dashboard?.setTrace(this.trace);
        console.log(`[harness] started trace ${this.trace.traceId}`);
      }
      this.server.send(socket, { kind: "control.result", ok: true, traceId: this.trace.traceId });
      return;
    }

    if (message.action === "trace.stop") {
      if (this.trace) {
        this.trace.stop();
        buildSummary(this.store, this.trace.traceId);
        this.dashboard?.clearTrace();
      }
      this.server.send(socket, {
        kind: "control.result",
        ok: true,
        traceId: this.trace?.traceId ?? null,
      });
      return;
    }

    if (message.action === "status") {
      this.server.send(socket, {
        kind: "control.result",
        ok: true,
        traceActive: Boolean(this.trace && !this.trace.endedAt),
        traceId: this.trace?.traceId ?? null,
      });
      return;
    }

    this.server.send(socket, { kind: "control.result", ok: false, error: "Unknown control action" });
  }
}
