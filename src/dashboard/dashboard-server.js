import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { buildHandshakeResponse, decodeFrames, encodeTextFrame } from "../host/websocket-codec.js";
import { ArtifactStore } from "../core/artifact-store.js";
import { readTrace, resolveTraceId } from "../core/trace-reader.js";
import { buildCurrentContext } from "../core/context-builder.js";
import { buildDashboardHtml } from "./dashboard-ui.js";

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

export class DashboardServer {
  constructor({ host = "127.0.0.1", port = 8766, traceDir = "traces", projectRoot = process.cwd(), intakePort = 8765, engineClientCount = null, lastEngineAt = null, onControlMessage = null } = {}) {
    this.host = host;
    this.port = port;
    this.intakePort = intakePort;
    this.projectRoot = path.resolve(projectRoot);
    this.store = new ArtifactStore(traceDir);
    this.frameStore = null;
    this.trace = null;
    this.server = null;
    this.clients = new Set();
    this.sseClients = new Set();
    this.engineClientCount = engineClientCount;
    this.lastEngineAt = lastEngineAt;
    this.onControlMessage = onControlMessage;
  }

  setFrameStore(frameStore) {
    this.frameStore = frameStore;
  }

  setTrace(trace) {
    this.trace = trace;
    if (trace) {
      this.broadcast({ kind: "trace", traceId: trace.traceId, active: !trace.endedAt });
    }
  }

  clearTrace() {
    this.trace = null;
    this.broadcast({ kind: "trace", traceId: null, active: false });
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
    this.server?.close();
  }

  handleHttp(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
      const html = buildDashboardHtml();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (pathname === "/api/status") {
      const frame = this.frameStore?.getFrame();
      json(res, {
        traceActive: Boolean(this.trace && !this.trace.endedAt),
        traceId: this.trace?.traceId ?? null,
        dashboardClients: this.clients.size + this.sseClients.size,
        dashboardWsClients: this.clients.size,
        dashboardSseClients: this.sseClients.size,
        engineClients: this.engineClientCount?.() ?? 0,
        lastEngineAt: this.lastEngineAt?.() ?? null,
        intakeUrl: `ws://${this.host === "0.0.0.0" ? "*" : this.host}:${this.intakePort ?? 8765}`,
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

    if (pathname === "/api/live/frame") {
      const frame = this.frameStore?.getFrame();
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
        pending = Buffer.from(decoded.remaining);
        for (const message of decoded.messages) {
          if (message === null) {
            socket.end();
            return;
          }
          this.handleClientMessage(socket, message);
        }
      });

      socket.on("close", () => {
        this.clients.delete(socket);
      });

      socket.on("error", () => {
        this.clients.delete(socket);
      });

      this.send(socket, { kind: "hello", traceId: this.trace?.traceId ?? null });
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
    this.sendSse(JSON.stringify({ kind: "hello", traceId: this.trace?.traceId ?? null }));
    res.on("close", () => {
      this.sseClients.delete(res);
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
      data: frame.buffer.toString("base64"),
    };
    this.broadcast(payload);
  }

  broadcastEvent(event) {
    this.broadcast({ kind: "event", event });
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
          .filter((d) => !d.name.startsWith("."))
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
          const dir = path.dirname(target.fullPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(target.fullPath, payload.content ?? "", "utf8");
          json(res, { ok: true, path: target.rel });
        });
        return;
      }
    }

    notFound(res);
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
