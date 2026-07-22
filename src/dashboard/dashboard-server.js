import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildHandshakeResponse, decodeFrames, encodeCloseFrame, encodeTextFrame } from "../host/websocket-codec.js";
import { ArtifactStore } from "../core/artifact-store.js";
import { readTrace, resolveTraceId } from "../core/trace-reader.js";
import { buildCurrentContext } from "../core/context-builder.js";
import { getLanIp } from "../core/network.js";
import { listTools as listMcpTools, dispatch as dispatchMcpTool } from "../mcp/registry.js";
import { createHttpHandler } from "../mcp/mcp-server.js";
import { installIdeConfig, listIdeConfigs } from "../mcp/ide-configs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, "../../dist/dashboard");
const PLACEHOLDER_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8Af//Z",
  "base64",
);

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

function json(res, value, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    notFound(res);
    return;
  }
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": data.length,
  });
  res.end(data);
}

const ALWAYS_SKIP_DIRS = new Set([".git", ".godot", "node_modules", "dist"]);

function globToRegex(pattern) {
  let pat = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  pat = pat.replace(/\*\*/g, "{{GLOBSTAR}}");
  pat = pat.replace(/\*/g, "[^/]*");
  pat = pat.replace(/\?/g, "[^/]");
  pat = pat.replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp("^" + pat + "$", "i");
}

function shouldIgnore(relPath, ignorePatterns) {
  if (!ignorePatterns || ignorePatterns.length === 0) return false;
  const normalized = relPath.replace(/\\/g, "/");
  const basename = path.posix.basename(normalized);
  for (const pattern of ignorePatterns) {
    if (!pattern) continue;
    try {
      const regex = globToRegex(pattern);
      if (pattern.includes("/")) {
        if (regex.test(normalized)) return true;
      } else if (regex.test(basename)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

function parseIgnorePatterns(url) {
  const raw = url.searchParams.get("ignore") || "";
  if (!raw) return [];
  return raw.split(",").map((p) => decodeURIComponent(p.trim())).filter(Boolean);
}

function isBinaryContent(buffer) {
  for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function isProtectedPath(rel) {
  const normalized = rel.replace(/\\/g, "/");
  if (normalized === "" || normalized === ".") return true;
  if (normalized === ".git" || normalized.startsWith(".git/")) return true;
  return false;
}

function parseGitRefs(decorate) {
  if (!decorate) return [];
  return decorate.split(", ").map((part) => {
    const trimmed = part.trim();
    if (trimmed.startsWith("tag: ")) return { type: "tag", name: trimmed.slice(5) };
    if (trimmed.includes(" -> ")) return { type: "branch", name: trimmed.split(" -> ")[1] };
    if (trimmed === "HEAD") return { type: "head", name: "HEAD" };
    return { type: "ref", name: trimmed };
  });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesGlob(relPath, pattern) {
  if (!pattern) return true;
  const normalized = relPath.replace(/\\/g, "/");
  const hasSlash = pattern.includes("/");
  const regex = globToRegex(hasSlash ? pattern : `**/${pattern}`);
  return regex.test(normalized);
}

function createContentMatcher(query, caseSensitive, wholeWord) {
  if (wholeWord) {
    const pattern = `\\b${escapeRegex(query)}\\b`;
    const flags = caseSensitive ? "g" : "gi";
    const re = new RegExp(pattern, flags);
    return (line) => re.test(line);
  }
  const q = caseSensitive ? query : query.toLowerCase();
  return (line) => (caseSensitive ? line.includes(query) : line.toLowerCase().includes(q));
}

export class DashboardServer {
  constructor({ host = "127.0.0.1", port = 8766, traceDir = "traces", projectRoot = process.cwd(), intakePort = 8765, engineClientCount = null, lastEngineAt = null, editorActive = null, editorManaged = null, onControlMessage = null, getRuntimeContext = null, onFlushTrace = null, profile = null, mcpHooks = null } = {}) {
    this.host = host;
    this.port = port;
    this.intakePort = intakePort;
    this.projectRoot = path.resolve(projectRoot);
    this.store = new ArtifactStore(traceDir);
    this.frameStore = null;
    this.trace = null;
    this.profile = profile;
    this.server = null;
    this.clients = new Set();
    this.sseClients = new Set();
    this.mjpegClients = new Set();
    this.engineClientCount = engineClientCount;
    this.lastEngineAt = lastEngineAt;
    this.editorActive = editorActive;
    this.editorManaged = editorManaged;
    this.onControlMessage = onControlMessage;
    this.getRuntimeContext = getRuntimeContext;
    this.onFlushTrace = onFlushTrace;
    this.mcpHooks = mcpHooks;
    this.mcpHttpHandler = null;
  }

  getMcpUrl() {
    return `http://${this.host === "0.0.0.0" ? getLanIp() : this.host}:${this.port}/mcp`;
  }

  getMcpHttpHandler() {
    if (!this.mcpHttpHandler) {
      const ctx = this.mcpHooks?.getCtx?.() ?? {
        godotPath: null,
        projectRoot: this.projectRoot,
        traceDir: this.store.rootDir,
        profile: this.profile,
        bridge: null,
        processManager: null,
      };
      const dispatch = this.mcpHooks?.dispatch ?? ((name, args, toolCtx) => dispatchMcpTool(name, args, toolCtx));
      this.mcpHttpHandler = createHttpHandler({ dispatch, listTools: listMcpTools, ...ctx });
    }
    return this.mcpHttpHandler;
  }

  getMcpStatusPayload() {
    const state = this.mcpHooks?.getStatus?.() ?? { running: false, startedAt: null, clientRequests: 0 };
    return {
      running: Boolean(state.running),
      startedAt: state.startedAt ?? null,
      clientRequests: state.clientRequests ?? 0,
      url: this.getMcpUrl(),
      transport: "streamable-http",
      toolCount: listMcpTools().length,
      engineConnected: (this.engineClientCount?.() ?? 0) > 0,
    };
  }

  async closeMcpHttpHandler() {
    if (this.mcpHttpHandler) {
      const handler = this.mcpHttpHandler;
      this.mcpHttpHandler = null;
      await handler.close();
    }
  }

  broadcastStatus() {
    const frame = this.frameStore?.getPrimaryFrame();
    const status = {
      kind: "status",
      traceActive: Boolean(this.trace && !this.trace.endedAt),
      traceId: this.trace?.traceId ?? null,
      dashboardClients: this.clients.size + this.sseClients.size,
      dashboardWsClients: this.clients.size,
      dashboardSseClients: this.sseClients.size,
      engineClients: this.engineClientCount?.() ?? 0,
      lastEngineAt: this.lastEngineAt?.() ?? null,
      editorActive: Boolean(this.editorActive?.()),
      editorManaged: Boolean(this.editorManaged?.()),
      intakeUrl: `ws://${this.host === "0.0.0.0" ? getLanIp() : this.host}:${this.intakePort ?? 8765}`,
      latestFrame: frame
        ? {
            contentType: frame.contentType,
            source: frame.source,
            width: frame.width,
            height: frame.height,
            seq: frame.seq,
            traceId: frame.traceId,
            receivedAt: frame.receivedAt,
          }
        : null,
    };
    this.broadcast(status);
  }

  setFrameStore(frameStore) {
    this.frameStore = frameStore;
  }

  setTrace(trace) {
    this.trace = trace;
    if (trace) {
      this.broadcast({ kind: "trace", traceId: trace.traceId, active: !trace.endedAt });
    }
    this.broadcastStatus();
  }

  clearTrace() {
    this.trace = null;
    this.broadcast({ kind: "trace", traceId: null, active: false });
    this.broadcastStatus();
  }

  start() {
    this.server = http.createServer((req, res) => this.handleHttp(req, res));
    this.server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));

    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  stop() {
    for (const client of this.clients) {
      try {
        client.destroy();
      } catch {}
    }
    this.clients.clear();
    for (const res of this.sseClients) {
      try {
        res.end();
      } catch {}
    }
    this.sseClients.clear();
    for (const client of this.mjpegClients) {
      try {
        client.res.end();
      } catch {}
    }
    this.mjpegClients.clear();
    this.closeMcpHttpHandler();
    this.server?.close();
  }

  handleHttp(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && pathname === "/api/control") {
      this.handleControlPost(req, res);
      return;
    }

    if (pathname === "/mcp") {
      this.handleMcpRequest(req, res);
      return;
    }

    if (pathname === "/api/mcp/status") {
      json(res, this.getMcpStatusPayload());
      return;
    }

    if (pathname === "/api/mcp/start") {
      if (req.method !== "POST") {
        json(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      this.mcpHooks?.start?.();
      json(res, this.getMcpStatusPayload());
      return;
    }

    if (pathname === "/api/mcp/stop") {
      if (req.method !== "POST") {
        json(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      this.mcpHooks?.stop?.();
      this.closeMcpHttpHandler();
      json(res, this.getMcpStatusPayload());
      return;
    }

    if (pathname === "/api/mcp/ide-configs") {
      json(res, { ides: listIdeConfigs({ projectRoot: this.projectRoot, dashboardUrl: this.getMcpUrl() }) });
      return;
    }

    if (pathname === "/api/mcp/install-config") {
      if (req.method !== "POST") {
        json(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          json(res, { ok: false, error: "invalid json" }, 400);
          return;
        }
        try {
          const result = installIdeConfig({
            ide: parsed.ide,
            projectRoot: this.projectRoot,
            dashboardUrl: this.getMcpUrl(),
          });
          json(res, result);
        } catch (error) {
          json(res, { ok: false, error: error.message }, 400);
        }
      });
      return;
    }

    if (pathname.startsWith("/api/files")) {
      this.handleFilesRequest(req, res, pathname, url);
      return;
    }

    if (pathname.startsWith("/api/git/")) {
      this.handleGitRequest(req, res, pathname, url);
      return;
    }

    if (pathname === "/api/git/status") {
      this.handleGitRequest(req, res, pathname, url);
      return;
    }

    if (pathname === "/api/live/events") {
      this.handleSse(req, res);
      return;
    }

    if (pathname === "/") {
      this.serveStatic(res, "index.html");
      return;
    }

    if (pathname.startsWith("/assets/")) {
      this.serveStatic(res, pathname.slice(1));
      return;
    }

    if (pathname === "/api/scenes") {
      json(res, { ok: true, scenes: this._listScenes() });
      return;
    }

    if (pathname === "/api/status") {
      const frame = this.frameStore?.getPrimaryFrame();
      json(res, {
        traceActive: Boolean(this.trace && !this.trace.endedAt),
        traceId: this.trace?.traceId ?? null,
        dashboardClients: this.clients.size + this.sseClients.size,
        dashboardWsClients: this.clients.size,
        dashboardSseClients: this.sseClients.size,
        engineClients: this.engineClientCount?.() ?? 0,
        lastEngineAt: this.lastEngineAt?.() ?? null,
        editorActive: Boolean(this.editorActive?.()),
        editorManaged: Boolean(this.editorManaged?.()),
        intakeUrl: `ws://${this.host === "0.0.0.0" ? getLanIp() : this.host}:${this.intakePort ?? 8765}`,
        latestFrame: frame
          ? {
              contentType: frame.contentType,
              source: frame.source,
              width: frame.width,
              height: frame.height,
              seq: frame.seq,
              traceId: frame.traceId,
              receivedAt: frame.receivedAt,
            }
          : null,
      });
      return;
    }

    if (pathname === "/api/traces") {
      json(res, { traces: this.store.listTraces() });
      return;
    }

    if (pathname.startsWith("/api/traces/")) {
      const rest = pathname.slice("/api/traces/".length);
      const [traceId, ...segments] = rest.split("/");

      if (segments.length === 0) {
        const trace = readTrace(this.store, traceId);
        json(res, { traceId, manifest: trace.manifest });
        return;
      }

      if (segments[0] === "events") {
        this.onFlushTrace?.();
        const trace = readTrace(this.store, traceId);
        const since = Number(url.searchParams.get("since") ?? 0);
        const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : null;
        let events = trace.timeline.filter((event) => event.seq > since);
        if (limit != null && limit > 0) {
          events = events.slice(-limit);
        }
        json(res, { traceId, since, events });
        return;
      }

      if (segments[0] === "evidence" && segments[1]) {
        const fileName = segments.slice(1).join("/");
        const filePath = path.join(this.store.traceDir(traceId), "evidence", fileName);
        const ext = path.extname(fileName).toLowerCase();
        const contentType =
          ext === ".png"
            ? "image/png"
            : ext === ".jpg" || ext === ".jpeg"
              ? "image/jpeg"
              : ext === ".webp"
                ? "image/webp"
                : "application/octet-stream";
        serveFile(res, filePath, contentType);
        return;
      }

      if (segments[0] === "context") {
        const context = buildCurrentContext(this.store, traceId);
        json(res, { traceId, context });
        return;
      }
    }

    if (pathname === "/api/live/frame.mjpeg") {
      this.handleMjpeg(req, res);
      return;
    }

    if (pathname === "/api/live/frame") {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const source = url.searchParams.get("source");
      const frame = source ? this.frameStore?.getFrame(source) : this.frameStore?.getPrimaryFrame();
      if (!frame || !frame.buffer) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": frame.contentType,
        "Content-Length": frame.buffer.length,
        "Cache-Control": "no-cache",
      });
      res.end(frame.buffer);
      return;
    }

    notFound(res);
  }

  handleUpgrade(req, socket, head) {
    if (new URL(req.url, `http://${req.headers.host}`).pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }

    try {
      socket.write(buildHandshakeResponseFromKey(key));
      this.clients.add(socket);

      let pending = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        const decoded = decodeFrames(pending);
        pending = decoded.remaining;
        for (const message of decoded.messages) {
          if (message === null) {
            try {
              socket.write(encodeCloseFrame());
            } catch {}
            socket.end();
            return;
          }
          this.handleClientMessage(socket, message);
        }
      });

      socket.on("close", () => {
        this.clients.delete(socket);
        this.broadcastStatus();
      });

      socket.on("error", () => {
        this.clients.delete(socket);
        this.broadcastStatus();
      });

      this.send(socket, { kind: "hello", traceId: this.trace?.traceId ?? null, context: this.getRuntimeContext?.() ?? null, signalSubscriptions: this.profile?.signalSubscriptions ?? [] });
      this.broadcastStatus();
    } catch {
      socket.destroy();
    }
  }

  handleClientMessage(socket, text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.action === "ping") {
      this.send(socket, { kind: "pong" });
      return;
    }
    if (message.kind === "control" || message.action != null) {
      this.onControlMessage?.(message);
      this.send(socket, { kind: "control.ack", action: message.action, ok: true });
    }
  }

  send(socket, value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    try {
      socket.write(encodeTextFrame(text));
    } catch {}
  }

  broadcast(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const frame = encodeTextFrame(text);
    for (const client of this.clients) {
      try {
        client.write(frame);
      } catch {}
    }
    this.sendSse(text);
  }

  handleMcpRequest(req, res) {
    const running = Boolean(this.mcpHooks?.getStatus?.().running);
    if (!running) {
      json(res, { error: "MCP server not running" }, 503);
      return;
    }
    const handler = this.getMcpHttpHandler();
    if (req.method === "POST") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          json(res, { error: "invalid json" }, 400);
          return;
        }
        handler.handle(req, res, parsed);
      });
      return;
    }
    handler.handle(req, res);
  }

  sendSse(text) {
    const payload = `data: ${text}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(payload);
      } catch {}
    }
  }

  handleControlPost(req, res) {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        json(res, { ok: false, error: "invalid json" }, 400);
        return;
      }
      this.onControlMessage?.(message);
      json(res, { ok: true, action: message.action });
    });
  }

  handleSse(_req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(":ok\n\n");
    this.sseClients.add(res);
    this.sendSse(JSON.stringify({ kind: "hello", traceId: this.trace?.traceId ?? null, signalSubscriptions: this.profile?.signalSubscriptions ?? [] }));
    this.broadcastStatus();
    res.on("close", () => {
      this.sseClients.delete(res);
      this.broadcastStatus();
    });
  }

  broadcastFrame(frame) {
    const payload = {
      kind: "frame",
      contentType: frame.contentType,
      source: frame.source,
      width: frame.width,
      height: frame.height,
      seq: frame.seq,
      traceId: frame.traceId,
      receivedAt: frame.receivedAt,
    };
    this.broadcast(payload);
    this.broadcastStatus();
    this.broadcastMjpegFrame(frame);
  }

  broadcastMjpegFrame(frame, singleClient = null) {
    // Use the de-facto MJPEG convention: the header boundary includes the
    // leading "--" and each part starts with that exact delimiter. Many
    // browsers (and Home Assistant) use this form; the strict RFC form of
    // "boundary=frame" + body "--frame" is not universally parsed.
    const boundary = "--frame";
    const header = `Content-Type: ${frame.contentType}\r\nContent-Length: ${frame.buffer.length}\r\n\r\n`;
    const targets = singleClient ? [singleClient] : this.mjpegClients;
    for (const client of targets) {
      try {
        if (client.source && frame.source !== client.source) {
          continue;
        }
        const writeFrame = () => {
          client.res.write(boundary);
          client.res.write("\r\n");
          client.res.write(header);
          client.res.write(frame.buffer);
          client.res.write("\r\n");
        };
        writeFrame();
        // Chrome sometimes displays the n-1 frame; send the first frame twice
        // so the stream starts rendering immediately.
        if (client.firstFrame) {
          client.firstFrame = false;
          writeFrame();
        }
      } catch (err) {
        console.error("[mjpeg] write error:", err.message);
        try {
          client.res.end();
        } catch {}
        this.mjpegClients.delete(client);
      }
    }
  }

  handleMjpeg(_req, res) {
    const url = new URL(_req.url, `http://${_req.headers.host}`);
    const clientId = url.searchParams.get("client") || "unknown";
    const source = url.searchParams.get("source") || null;
    console.log(`[mjpeg] client connected: ${clientId}${source ? ` source=${source}` : ""}`);
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=--frame",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    const client = { res, firstFrame: true, source };
    this.mjpegClients.add(client);
    const frame = source ? this.frameStore?.getFrame(source) : this.frameStore?.getPrimaryFrame();
    if (frame && frame.buffer) {
      this.broadcastMjpegFrame(frame, client);
    } else {
      // Send a tiny placeholder so the browser stops its loading spinner
      // before the first real frame arrives.
      this.broadcastMjpegFrame(
        {
          buffer: PLACEHOLDER_JPEG,
          contentType: "image/jpeg",
          source: "placeholder",
          width: 1,
          height: 1,
          seq: 0,
          traceId: null,
          receivedAt: new Date().toISOString(),
        },
        client,
      );
    }
    res.on("close", () => {
      console.log(`[mjpeg] client disconnected: ${clientId}`);
      this.mjpegClients.delete(client);
    });
    res.on("error", (err) => {
      console.error(`[mjpeg] client error: ${clientId} ${err.message}`);
      this.mjpegClients.delete(client);
    });
  }

  broadcastEvent(event) {
    this.broadcast({ kind: "event", event });
  }

  serveStatic(res, relativePath) {
    const filePath = path.join(DIST_DIR, relativePath);
    if (!filePath.startsWith(DIST_DIR)) {
      notFound(res);
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      if (relativePath !== "index.html") {
        this.serveStatic(res, "index.html");
        return;
      }
      notFound(res);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js" || ext === ".mjs"
          ? "application/javascript"
          : ext === ".css"
            ? "text/css"
            : ext === ".json"
              ? "application/json"
              : ext === ".png"
                ? "image/png"
                : ext === ".jpg" || ext === ".jpeg"
                  ? "image/jpeg"
                  : ext === ".svg"
                    ? "image/svg+xml"
                    : "application/octet-stream";
    serveFile(res, filePath, contentType);
  }

  resolveProjectPath(inputPath) {
    if (!inputPath) return { error: "missing path" };
    const normalized = path.normalize(inputPath).replace(/^(\.\.(\/|\\|$))+/, "");
    const fullPath = path.resolve(this.projectRoot, normalized);
    const rel = path.relative(this.projectRoot, fullPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return { error: "path outside project root" };
    }
    return { fullPath, rel };
  }

  _listScenes() {
    const scenes = [];
    const maxScenes = 500;
    const walk = (dir) => {
      if (scenes.length >= maxScenes) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (scenes.length >= maxScenes) break;
        if (entry.name.startsWith(".")) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".tscn")) {
          const rel = path.relative(this.projectRoot, fullPath).replace(/\\/g, "/");
          scenes.push(rel);
        }
      }
    };
    walk(this.projectRoot);
    return scenes.sort();
  }

  async readRequestBody(req) {
    return new Promise((resolve, reject) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }

  handleFilesRequest(req, res, pathname, url) {
    const ignorePatterns = parseIgnorePatterns(url);

    if (pathname === "/api/files/tree") {
      const relPath = url.searchParams.get("path") || ".";
      const resolved = this.resolveProjectPath(relPath);
      if (resolved.error) {
        json(res, { ok: false, error: resolved.error }, 400);
        return;
      }
      if (!fs.existsSync(resolved.fullPath)) {
        json(res, { ok: false, error: "not found" }, 404);
        return;
      }
      const stat = fs.statSync(resolved.fullPath);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(resolved.fullPath, { withFileTypes: true })
          .filter((d) => !d.name.startsWith(".") && !shouldIgnore(path.posix.join(resolved.rel.replace(/\\/g, "/"), d.name), ignorePatterns))
          .map((d) => ({
            name: d.name,
            type: d.isDirectory() ? "directory" : "file",
            path: path.posix.join(resolved.rel.replace(/\\/g, "/"), d.name).replace(/^\.\//, ""),
          }))
          .sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === "directory" ? -1 : 1;
          });
        json(res, { ok: true, path: resolved.rel, entries });
        return;
      }
      json(res, { ok: false, error: "not a directory" }, 400);
      return;
    }

    if (pathname === "/api/files/search") {
      const q = url.searchParams.get("q") || "";
      const relPath = url.searchParams.get("path") || ".";
      const contentMode = url.searchParams.get("content") === "1";
      const caseSensitive = url.searchParams.get("case") === "1";
      const wholeWord = url.searchParams.get("word") === "1";
      const glob = url.searchParams.get("glob") || "";
      const resolved = this.resolveProjectPath(relPath);
      if (resolved.error) {
        json(res, { ok: false, error: resolved.error }, 400);
        return;
      }
      if (!fs.existsSync(resolved.fullPath)) {
        json(res, { ok: false, error: "not found" }, 404);
        return;
      }
      if (q.length === 0) {
        json(res, { ok: true, mode: contentMode ? "content" : "name", query: q, matches: [], files: [], filesScanned: 0, truncated: false });
        return;
      }
      const searchOptions = { caseSensitive, wholeWord, glob, ignorePatterns };
      if (contentMode) {
        const result = this._searchFileContents(resolved.fullPath, resolved.rel, q, searchOptions);
        json(res, { ok: true, mode: "content", query: q, matches: result.matches, filesScanned: result.filesScanned, truncated: result.truncated });
        return;
      }
      const result = this._searchFileNames(resolved.fullPath, resolved.rel, q, searchOptions);
      json(res, { ok: true, mode: "name", query: q, files: result.files, filesScanned: result.filesScanned, truncated: result.truncated });
      return;
    }

    if (pathname === "/api/files/create-dir") {
      if (req.method !== "POST") {
        json(res, { ok: false, error: "method not allowed" }, 405);
        return;
      }
      this.readRequestBody(req).then((body) => {
        let payload;
        try {
          payload = JSON.parse(body);
        } catch {
          json(res, { ok: false, error: "invalid json" }, 400);
          return;
        }
        const target = this.resolveProjectPath(payload.path || ".");
        if (target.error) {
          json(res, { ok: false, error: target.error }, 400);
          return;
        }
        if (isProtectedPath(target.rel)) {
          json(res, { ok: false, error: "protected path" }, 400);
          return;
        }
        try {
          fs.mkdirSync(target.fullPath, { recursive: true });
          this._notifyFsRefresh(target.rel);
          json(res, { ok: true, path: target.rel });
        } catch (e) {
          json(res, { ok: false, error: e.message }, 500);
        }
      });
      return;
    }

    if (pathname === "/api/files") {
      const relPath = url.searchParams.get("path");
      if (req.method === "GET") {
        const resolved = this.resolveProjectPath(relPath || ".");
        if (resolved.error) {
          json(res, { ok: false, error: resolved.error }, 400);
          return;
        }
        if (!fs.existsSync(resolved.fullPath)) {
          json(res, { ok: false, error: "not found" }, 404);
          return;
        }
        const stat = fs.statSync(resolved.fullPath);
        if (stat.isDirectory()) {
          json(res, { ok: true, path: resolved.rel, type: "directory" });
          return;
        }
        const content = fs.readFileSync(resolved.fullPath, "utf8");
        json(res, { ok: true, path: resolved.rel, type: "file", content });
        return;
      }
      if (req.method === "POST") {
        this.readRequestBody(req).then((body) => {
          let payload;
          try {
            payload = JSON.parse(body);
          } catch {
            json(res, { ok: false, error: "invalid json" }, 400);
            return;
          }
          const target = this.resolveProjectPath(payload.path || relPath);
          if (target.error) {
            json(res, { ok: false, error: target.error }, 400);
            return;
          }
          if (isProtectedPath(target.rel)) {
            json(res, { ok: false, error: "protected path" }, 400);
            return;
          }
          const dir = path.dirname(target.fullPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(target.fullPath, payload.content ?? "", "utf8");
          this._notifyFsRefresh(target.rel);
          json(res, { ok: true, path: target.rel });
        });
        return;
      }
      if (req.method === "DELETE") {
        const resolved = this.resolveProjectPath(relPath || ".");
        if (resolved.error) {
          json(res, { ok: false, error: resolved.error }, 400);
          return;
        }
        if (!fs.existsSync(resolved.fullPath)) {
          json(res, { ok: false, error: "not found" }, 404);
          return;
        }
        if (isProtectedPath(resolved.rel)) {
          json(res, { ok: false, error: "protected path" }, 400);
          return;
        }
        try {
          fs.rmSync(resolved.fullPath, { recursive: true, force: false });
          this._notifyFsRefresh(resolved.rel);
          json(res, { ok: true, path: resolved.rel });
        } catch (e) {
          json(res, { ok: false, error: e.message }, 500);
        }
        return;
      }
    }

    notFound(res);
  }

  _notifyFsRefresh(relPath) {
    try {
      this.onControlMessage?.({ action: "fs.refresh", path: relPath.replace(/\\/g, "/") });
    } catch {}
  }

  _searchFileNames(rootPath, rootRel, query, options = {}) {
    const { ignorePatterns = [], glob = "" } = options;
    const files = [];
    const MAX_FILES = 200;
    const q = query.toLowerCase();
    let filesScanned = 0;
    const walk = (dir, rel) => {
      if (files.length >= MAX_FILES) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= MAX_FILES) break;
        if (entry.name.startsWith(".")) continue;
        const childRel = path.posix.join(rel.replace(/\\/g, "/"), entry.name);
        if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
        if (shouldIgnore(childRel, ignorePatterns)) continue;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), childRel);
        } else if (entry.isFile()) {
          if (!matchesGlob(childRel, glob)) continue;
          filesScanned++;
          if (childRel.toLowerCase().includes(q)) {
            files.push({ name: entry.name, type: "file", path: childRel });
          }
        }
      }
    };
    walk(rootPath, rootRel);
    return { files, filesScanned, truncated: files.length >= MAX_FILES };
  }

  _searchFileContents(rootPath, rootRel, query, options = {}) {
    const { ignorePatterns = [], caseSensitive = false, wholeWord = false, glob = "" } = options;
    const matches = [];
    const MAX_MATCHES = 1000;
    const MAX_FILES = 1000;
    const MAX_FILE_SIZE = 1024 * 1024;
    const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
    let fileCount = 0;
    let filesScanned = 0;
    let totalBytes = 0;
    let truncated = false;
    const lineMatches = createContentMatcher(query, caseSensitive, wholeWord);
    const walk = (dir, rel) => {
      if (matches.length >= MAX_MATCHES || fileCount >= MAX_FILES || truncated) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (matches.length >= MAX_MATCHES || fileCount >= MAX_FILES || truncated) break;
        if (entry.name.startsWith(".")) continue;
        const childRel = path.posix.join(rel.replace(/\\/g, "/"), entry.name);
        if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
        if (shouldIgnore(childRel, ignorePatterns)) continue;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), childRel);
        } else if (entry.isFile()) {
          if (!matchesGlob(childRel, glob)) continue;
          const fullPath = path.join(dir, entry.name);
          const stat = fs.statSync(fullPath);
          if (!stat.isFile() || stat.size > MAX_FILE_SIZE) continue;
          let buffer;
          try {
            buffer = fs.readFileSync(fullPath);
          } catch {
            continue;
          }
          if (isBinaryContent(buffer)) continue;
          totalBytes += buffer.length;
          if (totalBytes > MAX_TOTAL_BYTES) {
            truncated = true;
            break;
          }
          fileCount++;
          filesScanned++;
          const content = buffer.toString("utf8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lineMatches(lines[i])) {
              matches.push({ path: childRel, lineNo: i + 1, line: lines[i].slice(0, 240) });
              if (matches.length >= MAX_MATCHES) break;
            }
          }
        }
      }
    };
    walk(rootPath, rootRel);
    return { matches, filesScanned, truncated: truncated || matches.length >= MAX_MATCHES || fileCount >= MAX_FILES };
  }

  execGit(args, options = {}) {
    return new Promise((resolve, reject) => {
      import("node:child_process").then(({ spawn }) => {
        const child = spawn("git", args, {
          cwd: this.projectRoot,
          env: process.env,
          ...options,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => { stdout += d; });
        child.stderr.on("data", (d) => { stderr += d; });
        child.on("close", (code) => {
          resolve({ code, stdout, stderr });
        });
        child.on("error", reject);
      }).catch(reject);
    });
  }

  async handleGitRequest(req, res, pathname, url) {
    if (pathname === "/api/git/log") {
      const branch = url.searchParams.get("branch") || "HEAD";
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));
      const skip = Math.max(0, Number(url.searchParams.get("skip") || 0));
      const FIELD_SEP = "\x00";
      const RECORD_SEP = "\x01";
      const FIELD_FMT = "%x00";
      const RECORD_FMT = "%x01";
      const [logResult, countResult] = await Promise.all([
        this.execGit([
          "log", branch,
          "--skip", String(skip),
          "--max-count", String(limit),
          `--pretty=format:%H${FIELD_FMT}%P${FIELD_FMT}%an${FIELD_FMT}%ae${FIELD_FMT}%at${FIELD_FMT}%D${FIELD_FMT}%s${RECORD_FMT}`,
        ]),
        this.execGit(["rev-list", "--count", branch]),
      ]);
      if (logResult.code !== 0) {
        json(res, { ok: false, error: logResult.stderr || "git log failed" }, 500);
        return;
      }
      const records = logResult.stdout.split(RECORD_SEP).filter((r) => r.includes(FIELD_SEP));
      const commits = records.map((record) => {
        const cleanRecord = record.replace(/^\n/, "");
        const [hash, parents, author, email, date, refs, ...subjectRest] = cleanRecord.split(FIELD_SEP);
        const timestamp = Number(date);
        return {
          hash: (hash || "").trim(),
          parents: parents ? parents.split(" ").filter(Boolean) : [],
          author: author || "",
          email: email || "",
          date: Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : null,
          refs: parseGitRefs(refs),
          subject: subjectRest.join(FIELD_SEP).replace(/\n$/, "") || "",
        };
      });
      json(res, {
        ok: true,
        branch,
        skip,
        limit,
        total: countResult.code === 0 ? Number(countResult.stdout.trim()) || commits.length : commits.length,
        commits,
      });
      return;
    }

    if (pathname.startsWith("/api/git/commit/")) {
      const hash = pathname.slice("/api/git/commit/".length).split("/")[0];
      if (!hash) {
        json(res, { ok: false, error: "missing commit hash" }, 400);
        return;
      }
      const relPath = url.searchParams.get("path");
      const resolved = relPath ? this.resolveProjectPath(relPath) : null;
      if (resolved?.error) {
        json(res, { ok: false, error: resolved.error }, 400);
        return;
      }
      const FIELD_SEP = "\x00";
      const FIELD_FMT = "%x00";
      const [metaResult, filesResult] = await Promise.all([
        this.execGit(["show", "-s", `--format=%H${FIELD_FMT}%an${FIELD_FMT}%ae${FIELD_FMT}%at${FIELD_FMT}%s`, hash]),
        this.execGit(["diff-tree", "--no-commit-id", "--name-status", "-r", hash]),
      ]);
      if (metaResult.code !== 0) {
        json(res, { ok: false, error: metaResult.stderr || "git show failed" }, 500);
        return;
      }
      const metaParts = metaResult.stdout.split(FIELD_SEP);
      const timestamp = Number(metaParts[3]);
      const meta = {
        hash: (metaParts[0] || hash).trim(),
        author: metaParts[1] || "",
        email: metaParts[2] || "",
        date: Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : null,
        subject: metaParts.slice(4).join(FIELD_SEP).replace(/\n$/, "") || "",
      };
      const files = filesResult.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [status, ...rest] = line.split("\t");
          const filePath = rest.join("\t");
          return { path: filePath, status };
        });
      let diff = "";
      if (resolved) {
        const hasParent = await this.execGit(["rev-parse", `${hash}^`]);
        const diffResult = hasParent.code === 0 && hasParent.stdout.trim()
          ? await this.execGit(["diff", `${hash}^`, hash, "--", resolved.fullPath])
          : await this.execGit(["show", "--format=", hash, "--", resolved.fullPath]);
        if (diffResult.code !== 0) {
          json(res, { ok: false, error: diffResult.stderr || "git diff failed" }, 500);
          return;
        }
        diff = diffResult.stdout;
      }
      json(res, { ok: true, meta, files, diff });
      return;
    }

    if (pathname === "/api/git/status") {
      const result = await this.execGit(["status", "--porcelain=v1", "-b"]);
      if (result.code !== 0) {
        json(res, { ok: false, error: result.stderr || "git status failed" }, 500);
        return;
      }
      const lines = result.stdout.split("\n");
      const branchLine = lines[0];
      const branchMatch = branchLine.match(/^##\s+(\S+)(?:\.\.\.(\S+))?/);
      const files = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.length < 4) continue;
        const index = line[0];
        const worktree = line[1];
        const filePath = line.slice(3);
        files.push({
          path: filePath,
          indexStatus: index === "?" ? "untracked" : index === " " ? "unmodified" : index,
          worktreeStatus: worktree === "?" ? "untracked" : worktree === " " ? "unmodified" : worktree,
        });
      }
      json(res, {
        ok: true,
        branch: branchMatch ? branchMatch[1] : null,
        upstream: branchMatch ? branchMatch[2] : null,
        files,
      });
      return;
    }

    if (pathname === "/api/git/diff") {
      const relPath = url.searchParams.get("path");
      const args = relPath ? ["diff", "HEAD", "--", relPath] : ["diff", "HEAD"];
      const result = await this.execGit(args);
      if (result.code !== 0 && result.code !== 1) {
        json(res, { ok: false, error: result.stderr || "git diff failed" }, 500);
        return;
      }
      json(res, { ok: true, path: relPath, diff: result.stdout });
      return;
    }

    if (req.method === "POST" && pathname === "/api/git/stage") {
      const body = await this.readRequestBody(req);
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        json(res, { ok: false, error: "invalid json" }, 400);
        return;
      }
      const resolved = this.resolveProjectPath(payload.path);
      if (resolved.error) {
        json(res, { ok: false, error: resolved.error }, 400);
        return;
      }
      const result = await this.execGit(["add", "--", resolved.fullPath]);
      if (result.code !== 0) {
        json(res, { ok: false, error: result.stderr || "git add failed" }, 500);
        return;
      }
      json(res, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/api/git/unstage") {
      const body = await this.readRequestBody(req);
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        json(res, { ok: false, error: "invalid json" }, 400);
        return;
      }
      const resolved = this.resolveProjectPath(payload.path);
      if (resolved.error) {
        json(res, { ok: false, error: resolved.error }, 400);
        return;
      }
      const result = await this.execGit(["reset", "HEAD", "--", resolved.fullPath]);
      if (result.code !== 0) {
        json(res, { ok: false, error: result.stderr || "git reset failed" }, 500);
        return;
      }
      json(res, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/api/git/reset") {
      const body = await this.readRequestBody(req);
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        json(res, { ok: false, error: "invalid json" }, 400);
        return;
      }
      const resolved = this.resolveProjectPath(payload.path);
      if (resolved.error) {
        json(res, { ok: false, error: resolved.error }, 400);
        return;
      }
      const result = await this.execGit(["checkout", "--", resolved.fullPath]);
      if (result.code !== 0) {
        json(res, { ok: false, error: result.stderr || "git checkout failed" }, 500);
        return;
      }
      json(res, { ok: true });
      return;
    }

    notFound(res);
  }
}

function buildHandshakeResponseFromKey(key) {
  const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  const accept = crypto.createHash("sha1").update(`${key.trim()}${WS_MAGIC}`).digest("base64");
  return [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n",
  ].join("\r\n");
}
