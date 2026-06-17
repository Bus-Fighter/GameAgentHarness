import { ArtifactStore } from "../core/artifact-store.js";
import { TraceSession } from "../core/trace-session.js";
import { buildSummary } from "../core/summary-builder.js";
import { WebSocketServer } from "./websocket-server.js";

export class HarnessHost {
  constructor({ port = 8765, host = "127.0.0.1", traceDir = "traces" } = {}) {
    this.port = Number(port);
    this.host = host;
    this.store = new ArtifactStore(traceDir);
    this.trace = null;
    this.server = new WebSocketServer({
      port: this.port,
      host: this.host,
      onConnection: (socket) => this.onConnection(socket),
      onMessage: (socket, message) => this.onMessage(socket, message),
      onClose: () => {},
    });
  }

  async start() {
    await this.server.start();
  }

  stop() {
    this.trace?.stop();
    if (this.trace) {
      buildSummary(this.store, this.trace.traceId);
    }
    this.server.stop();
  }

  onConnection(socket) {
    this.server.send(socket, {
      kind: "host.hello",
      host: "game-agent-harness",
      protocolVersion: 1,
      traceActive: Boolean(this.trace),
      traceId: this.trace?.traceId ?? null,
    });
  }

  onMessage(socket, text) {
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

    if (!this.trace) {
      this.trace = new TraceSession(this.store, {
        context: {
          source: message.source ?? "unknown",
          engine: message.engine ?? null,
          project: message.project ?? null,
          firstSeenAt: new Date().toISOString(),
        },
      });
      console.log(`[harness] started trace ${this.trace.traceId}`);
    }

    const event = this.trace.append(message);
    this.server.send(socket, { kind: "host.ack", seq: event.seq, traceId: event.traceId });
  }

  handleControl(socket, message) {
    if (message.action === "trace.start") {
      if (!this.trace || this.trace.endedAt) {
        this.trace = new TraceSession(this.store, { context: message.context ?? null });
        console.log(`[harness] started trace ${this.trace.traceId}`);
      }
      this.server.send(socket, { kind: "control.result", ok: true, traceId: this.trace.traceId });
      return;
    }

    if (message.action === "trace.stop") {
      if (this.trace) {
        this.trace.stop();
        buildSummary(this.store, this.trace.traceId);
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
