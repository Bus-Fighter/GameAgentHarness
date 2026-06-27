import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import crypto from "node:crypto";
import { HarnessHost } from "../src/host/harness-host.js";
import { encodeTextFrame, decodeFrames } from "../src/host/websocket-codec.js";

const TEST_HOST = "127.0.0.1";
const INTAKE_PORT = 18765;
const DASHBOARD_PORT = 18766;

function parseWsUrl(url) {
  const match = url.match(/^ws:\/\/([^\/]+)(\/.*)?$/);
  if (!match) throw new Error(`Invalid ws URL: ${url}`);
  const hostPort = match[1];
  const [host, portStr] = hostPort.split(":");
  return { host, port: Number(portStr), path: match[2] || "/" };
}

function connectWebSocket(url) {
  const { host, port, path } = parseWsUrl(url);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: ${host}:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "\r\n",
        ].join("\r\n"),
      );

      let handshakeDone = false;
      let pending = Buffer.alloc(0);
      const messages = [];

      socket.on("data", (chunk) => {
        if (!handshakeDone) {
          pending = Buffer.concat([pending, chunk]);
          const end = pending.indexOf("\r\n\r\n");
          if (end === -1) return;
          const response = pending.subarray(0, end + 4).toString("utf8");
          if (!response.includes("101 Switching Protocols")) {
            reject(new Error("WebSocket handshake failed: " + response.split("\r\n")[0]));
            socket.destroy();
            return;
          }
          handshakeDone = true;
          pending = pending.subarray(end + 4);
          processPending();
          resolve({
            socket,
            send: (value) => socket.write(encodeTextFrame(JSON.stringify(value))),
            nextMessage: (kind = null, timeoutMs = 5000) => waitForMessage(messages, kind, timeoutMs),
            close: () => socket.end(),
          });
        } else {
          pending = Buffer.concat([pending, chunk]);
          processPending();
        }

        function processPending() {
          const decoded = decodeFrames(pending);
          pending = Buffer.from(decoded.remaining);
          for (const msg of decoded.messages) {
            if (msg === null) {
              socket.end();
              return;
            }
            try {
              messages.push(JSON.parse(msg));
            } catch {
              messages.push(msg);
            }
          }
        }
      });

      socket.on("error", reject);
    });
  });
}

function waitForMessage(messages, kind = null, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = setInterval(() => {
      const index = messages.findIndex((msg) => {
        if (kind != null) return msg?.kind === kind;
        return msg?.kind !== "status";
      });
      if (index !== -1) {
        clearInterval(check);
        resolve(messages.splice(index, 1)[0]);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(check);
        resolve(null);
      }
    }, 10);
  });
}

function fetchHttp(urlPath, port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${TEST_HOST}:${port}${urlPath}`, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error("HTTP request timeout"));
    });
  });
}

async function createHost(t) {
  const traceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gah-dashboard-"));
  const host = new HarnessHost({
    host: TEST_HOST,
    port: INTAKE_PORT,
    traceDir: traceRoot,
    dashboard: true,
    dashboardHost: TEST_HOST,
    dashboardPort: DASHBOARD_PORT,
  });
  await host.start();
  t.after(() => {
    host.stop();
    try {
      fs.rmSync(traceRoot, { recursive: true, force: true });
    } catch {}
  });
  return { host, traceRoot };
}

test("dashboard serves built React app and status", async (t) => {
  const { host } = await createHost(t);

  const index = await fetchHttp("/", DASHBOARD_PORT);
  assert.equal(index.status, 200);
  assert.match(index.body.toString("utf8"), /Game Agent Harness/);
  assert.match(index.body.toString("utf8"), /id="root"/);
  assert.match(index.body.toString("utf8"), /viewport-fit=cover/);

  const status = await fetchJson("/api/status", DASHBOARD_PORT);
  assert.equal(status.traceActive, false);
  assert.equal(status.traceId, null);
  assert.equal(status.dashboardClients, 0);
  assert.equal(status.engineClients, 0);
  assert.equal(status.lastEngineAt, null);
  assert.equal(status.intakeUrl, "ws://127.0.0.1:18765");
  assert.equal(status.latestFrame, null);
});

test("live frame is broadcast to dashboard and available via API", async (t) => {
  const { host } = await createHost(t);

  const intake = await connectWebSocket(`ws://${TEST_HOST}:${INTAKE_PORT}`);
  const dashboard = await connectWebSocket(`ws://${TEST_HOST}:${DASHBOARD_PORT}/ws`);

  const hello = await dashboard.nextMessage();
  assert.equal(hello.kind, "hello");

  const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  intake.send({
    kind: "frame",
    format: "png",
    data: imageBuffer.toString("base64"),
    width: 100,
    height: 80,
    source: "runtime",
    persist: false,
  });

  const frameMsg = await dashboard.nextMessage();
  assert.equal(frameMsg.kind, "frame");
  assert.equal(frameMsg.width, 100);
  assert.equal(frameMsg.height, 80);
  assert.equal(frameMsg.source, "runtime");
  assert.equal(frameMsg.data, undefined);

  const live = await fetchHttp("/api/live/frame", DASHBOARD_PORT);
  assert.equal(live.status, 200);
  assert.equal(live.headers["content-type"], "image/png");
  assert.deepEqual(live.body, imageBuffer);

  const status = await fetchJson("/api/status", DASHBOARD_PORT);
  assert.equal(status.latestFrame.width, 100);
  assert.equal(status.latestFrame.source, "runtime");

  intake.close();
  dashboard.close();
});

test("persisted frame creates evidence file and event", async (t) => {
  const { host, traceRoot } = await createHost(t);

  const intake = await connectWebSocket(`ws://${TEST_HOST}:${INTAKE_PORT}`);
  const hello = await intake.nextMessage();
  assert.equal(hello.kind, "host.hello");

  intake.send({
    kind: "event",
    type: "scene.changed",
    source: "godot",
    data: { scenePath: "res://Stage.tscn" },
  });

  const ack = await intake.nextMessage();
  assert.equal(ack.kind, "host.ack");

  const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xff]);
  intake.send({
    kind: "frame",
    format: "png",
    data: imageBuffer.toString("base64"),
    width: 200,
    height: 150,
    source: "editor",
    persist: true,
  });

  const frameAck = await intake.nextMessage();
  assert.equal(frameAck.kind, "host.ack");
  assert.ok(frameAck.seq);

  const traceId = frameAck.traceId;
  const evidencePath = path.join(traceRoot, traceId, "evidence", `frame-${frameAck.seq}.png`);
  assert.ok(fs.existsSync(evidencePath));
  assert.deepEqual(fs.readFileSync(evidencePath), imageBuffer);

  const eventsRes = await fetchJson(`/api/traces/${traceId}/events?type=evidence.`, DASHBOARD_PORT);
  const evidenceEvents = eventsRes.events.filter((e) => e.type === "evidence.frame");
  assert.equal(evidenceEvents.length, 1);
  assert.equal(evidenceEvents[0].data.path, `frame-${frameAck.seq}.png`);

  const fileRes = await fetchHttp(`/api/traces/${traceId}/evidence/frame-${frameAck.seq}.png`, DASHBOARD_PORT);
  assert.equal(fileRes.status, 200);
  assert.deepEqual(fileRes.body, imageBuffer);

  intake.close();
});

test("events are broadcast to dashboard clients", async (t) => {
  const { host } = await createHost(t);

  const dashboard = await connectWebSocket(`ws://${TEST_HOST}:${DASHBOARD_PORT}/ws`);
  const hello = await dashboard.nextMessage();
  assert.equal(hello.kind, "hello");

  const intake = await connectWebSocket(`ws://${TEST_HOST}:${INTAKE_PORT}`);
  intake.send({
    kind: "event",
    type: "input.pointer.pressed",
    source: "godot",
    data: { x: 10, y: 20 },
  });

  let eventMsg = await dashboard.nextMessage();
  if (eventMsg.kind == "trace") {
    eventMsg = await dashboard.nextMessage();
  }
  assert.equal(eventMsg.kind, "event");
  assert.equal(eventMsg.event.type, "input.pointer.pressed");
  assert.equal(eventMsg.event.data.x, 10);

  intake.close();
  dashboard.close();
});

test("dashboard can send control messages to engine clients", async (t) => {
  const { host } = await createHost(t);

  const engine = await connectWebSocket(`ws://${TEST_HOST}:${INTAKE_PORT}`);
  const engineHello = await engine.nextMessage();
  assert.equal(engineHello.kind, "host.hello");

  const dashboard = await connectWebSocket(`ws://${TEST_HOST}:${DASHBOARD_PORT}/ws`);
  const dashboardHello = await dashboard.nextMessage();
  assert.equal(dashboardHello.kind, "hello");

  dashboard.send({
    kind: "control",
    action: "runtime_capture",
    enabled: false,
  });

  const controlMsg = await engine.nextMessage();
  assert.equal(controlMsg.kind, "control");
  assert.equal(controlMsg.action, "runtime_capture");
  assert.equal(controlMsg.enabled, false);

  engine.close();
  dashboard.close();
});

test("dashboard forwards snapshot, pause, play, stop, and input.pointer controls to engine clients", async (t) => {
  const { host } = await createHost(t);

  const engine = await connectWebSocket(`ws://${TEST_HOST}:${INTAKE_PORT}`);
  const engineHello = await engine.nextMessage();
  assert.equal(engineHello.kind, "host.hello");

  const dashboard = await connectWebSocket(`ws://${TEST_HOST}:${DASHBOARD_PORT}/ws`);
  const dashboardHello = await dashboard.nextMessage();
  assert.equal(dashboardHello.kind, "hello");

  dashboard.send({ kind: "control", action: "snapshot" });
  let msg = await engine.nextMessage();
  assert.equal(msg.kind, "control");
  assert.equal(msg.action, "snapshot");

  dashboard.send({ kind: "control", action: "pause", enabled: true });
  msg = await engine.nextMessage();
  assert.equal(msg.kind, "control");
  assert.equal(msg.action, "pause");
  assert.equal(msg.enabled, true);

  dashboard.send({ kind: "control", action: "play" });
  msg = await engine.nextMessage();
  assert.equal(msg.kind, "control");
  assert.equal(msg.action, "play");

  dashboard.send({ kind: "control", action: "stop" });
  msg = await engine.nextMessage();
  assert.equal(msg.kind, "control");
  assert.equal(msg.action, "stop");

  dashboard.send({ kind: "control", action: "input.pointer", phase: "pressed", x: 0.5, y: 0.5, button: 1 });
  msg = await engine.nextMessage();
  assert.equal(msg.kind, "control");
  assert.equal(msg.action, "input.pointer");
  assert.equal(msg.phase, "pressed");
  assert.equal(msg.x, 0.5);
  assert.equal(msg.y, 0.5);

  engine.close();
  dashboard.close();
});

test("SSE endpoint streams events when WebSocket is unavailable", async (t) => {
  const { host } = await createHost(t);

  const sseMessages = [];
  const req = http.get(`http://${TEST_HOST}:${DASHBOARD_PORT}/api/live/events`, (res) => {
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "text/event-stream");
    let buffer = "";
    res.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop();
      let current = "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          current = line.slice("data: ".length);
        } else if (line === "" && current) {
          try {
            sseMessages.push(JSON.parse(current));
          } catch {}
          current = "";
        }
      }
    });
  });
  req.on("error", assert.fail);
  req.setTimeout(3000, () => req.destroy());

  await new Promise((resolve) => setTimeout(resolve, 100));

  const intake = await connectWebSocket(`ws://${TEST_HOST}:${INTAKE_PORT}`);
  intake.send({
    kind: "event",
    type: "input.pointer.pressed",
    source: "godot",
    data: { x: 10, y: 20 },
  });

  const deadline = Date.now() + 2000;
  while (!sseMessages.find((m) => m.kind === "event") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.equal(sseMessages[0].kind, "hello");
  const eventMsg = sseMessages.find((m) => m.kind === "event");
  assert.ok(eventMsg);
  assert.equal(eventMsg.event.type, "input.pointer.pressed");
  assert.equal(eventMsg.event.data.x, 10);

  req.destroy();
  intake.close();
});

test("HTTP control endpoint forwards messages to engine clients", async (t) => {
  const { host } = await createHost(t);

  const engine = await connectWebSocket(`ws://${TEST_HOST}:${INTAKE_PORT}`);
  const engineHello = await engine.nextMessage();
  assert.equal(engineHello.kind, "host.hello");

  const controlBody = JSON.stringify({ kind: "control", action: "live_capture", enabled: false });
  const res = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: TEST_HOST,
        port: DASHBOARD_PORT,
        path: "/api/control",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(controlBody),
        },
      },
      (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => resolve({ status: r.statusCode, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    req.write(controlBody);
    req.end();
  });

  assert.equal(res.status, 200);
  assert.ok(JSON.parse(res.body.toString("utf8")).ok);

  const controlMsg = await engine.nextMessage();
  assert.equal(controlMsg.kind, "control");
  assert.equal(controlMsg.action, "live_capture");
  assert.equal(controlMsg.enabled, false);

  engine.close();
});

test("file API reads project files and git status", async (t) => {
  const FILE_API_PORT = 18767;
  const FILE_DASHBOARD_PORT = 18768;
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gah-files-"));
  fs.mkdirSync(path.join(projectRoot, "Scripts"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "Scripts", "StageSession.cs"), "class StageSession {}", "utf8");

  const { spawnSync } = await import("node:child_process");
  spawnSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: projectRoot, stdio: "ignore" });

  const traceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gah-dashboard-files-"));
  const host = new HarnessHost({
    host: TEST_HOST,
    port: FILE_API_PORT,
    traceDir: traceRoot,
    projectRoot,
    dashboard: true,
    dashboardHost: TEST_HOST,
    dashboardPort: FILE_DASHBOARD_PORT,
  });
  await host.start();
  t.after(() => {
    host.stop();
    try { fs.rmSync(traceRoot, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch {}
  });

  const tree = await fetchJson("/api/files/tree?path=.", FILE_DASHBOARD_PORT);
  assert.equal(tree.ok, true);
  assert.ok(tree.entries.some((e) => e.name === "Scripts" && e.type === "directory"));

  const file = await fetchJson("/api/files?path=Scripts/StageSession.cs", FILE_DASHBOARD_PORT);
  assert.equal(file.ok, true);
  assert.equal(file.type, "file");
  assert.equal(file.content, "class StageSession {}");

  const status = await fetchJson("/api/git/status", FILE_DASHBOARD_PORT);
  assert.equal(status.ok, true);
  assert.ok(Array.isArray(status.files));

  const postRes = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ path: "Scripts/StageSession.cs", content: "class StageSession { int x; }" });
    const req = http.request(
      {
        hostname: TEST_HOST,
        port: FILE_DASHBOARD_PORT,
        path: "/api/files",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => resolve({ status: r.statusCode, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
  assert.equal(postRes.status, 200);
  assert.equal(fs.readFileSync(path.join(projectRoot, "Scripts", "StageSession.cs"), "utf8"), "class StageSession { int x; }");
});

test("host sends signal subscriptions from profile after engine connects", async (t) => {
  const traceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gah-signals-"));
  const profilePath = path.join(traceRoot, "test.profile.json");
  fs.writeFileSync(
    profilePath,
    JSON.stringify({
      signalSubscriptions: [
        {
          match: { nodeClass: "PlayerHealthSystem" },
          signal: "HpChanged",
          eventType: "player.hp_changed",
          argMapping: ["previous", "current"],
        },
      ],
    }),
  );

  const host = new HarnessHost({
    host: TEST_HOST,
    port: INTAKE_PORT,
    traceDir: traceRoot,
    dashboard: true,
    dashboardHost: TEST_HOST,
    dashboardPort: DASHBOARD_PORT,
    profilePath,
  });
  await host.start();
  t.after(() => {
    host.stop();
    try {
      fs.rmSync(traceRoot, { recursive: true, force: true });
    } catch {}
  });

  const engine = await connectWebSocket(`ws://${TEST_HOST}:${INTAKE_PORT}`);
  const engineHello = await engine.nextMessage();
  assert.equal(engineHello.kind, "host.hello");

  engine.send({
    kind: "event",
    type: "engine.connected",
    source: "godot",
    engine: { name: "godot", version: "4.x" },
    project: { name: "TestProject", root: "/tmp/test" },
    data: {},
  });

  const controlMsg = await engine.nextMessage("control");
  assert.equal(controlMsg.kind, "control");
  assert.equal(controlMsg.action, "signal.subscribe");
  assert.equal(controlMsg.signal, "HpChanged");
  assert.equal(controlMsg.eventType, "player.hp_changed");
  assert.deepEqual(controlMsg.argMapping, ["previous", "current"]);

  engine.close();
});

test("websocket codec handles large frames", () => {
  const bigText = "x".repeat(200_000);
  const frame = encodeTextFrame(bigText);
  const decoded = decodeFrames(frame);
  assert.equal(decoded.messages.length, 1);
  assert.equal(decoded.messages[0], bigText);
  assert.equal(decoded.remaining.length, 0);
});

async function fetchJson(urlPath, port) {
  const res = await fetchHttp(urlPath, port);
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/json");
  return JSON.parse(res.body.toString("utf8"));
}
