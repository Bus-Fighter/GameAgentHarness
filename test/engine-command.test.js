import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { HarnessHost } from "../src/host/harness-host.js";
import { encodeTextFrame, decodeFrames } from "../src/host/websocket-codec.js";
import { readTrace } from "../src/core/trace-reader.js";

const TEST_HOST = "127.0.0.1";
const INTAKE_PORT = 18777;

function connectWebSocket({ host, port }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(
        [
          "GET / HTTP/1.1",
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
      const handlers = [];

      function processPending() {
        const decoded = decodeFrames(pending);
        pending = Buffer.from(decoded.remaining);
        for (const msg of decoded.messages) {
          if (msg === null) {
            socket.end();
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(msg);
          } catch {
            continue;
          }
          messages.push(parsed);
          for (const handler of handlers) handler(parsed);
        }
      }

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
          resolve({
            socket,
            send: (value) => socket.write(encodeTextFrame(JSON.stringify(value), { masked: true })),
            onMessage: (handler) => handlers.push(handler),
            nextMessage: (timeoutMs = 5000) => waitForMessage(messages, timeoutMs),
            close: () => socket.end(),
          });
          processPending();
        } else {
          pending = Buffer.concat([pending, chunk]);
          processPending();
        }
      });

      socket.on("error", reject);
    });
  });
}

function waitForMessage(messages, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = setInterval(() => {
      if (messages.length > 0) {
        clearInterval(check);
        resolve(messages.shift());
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(check);
        resolve(null);
      }
    }, 10);
  });
}

async function createHost(t) {
  const traceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gah-engine-cmd-"));
  const host = new HarnessHost({
    host: TEST_HOST,
    port: INTAKE_PORT,
    traceDir: traceRoot,
    projectRoot: traceRoot,
  });
  await host.start();
  t.after(() => host.stop());
  return host;
}

async function connectFakeEngine(t) {
  const engine = await connectWebSocket({ host: TEST_HOST, port: INTAKE_PORT });
  t.after(() => engine.close());
  await engine.nextMessage(); // host.hello
  return engine;
}

test("sendEngineCommand resolves with data when engine replies with cmd.result", async (t) => {
  const host = await createHost(t);
  const engine = await connectFakeEngine(t);

  engine.onMessage((message) => {
    if (message.kind === "control" && message.action === "cmd") {
      engine.send({
        kind: "event",
        type: "cmd.result",
        id: message.id,
        ok: true,
        data: { version: "4.4.1", scenePath: "res://main.tscn" },
        error: null,
      });
    }
  });

  const data = await host.sendEngineCommand("editor", "ping", {});
  assert.deepEqual(data, { version: "4.4.1", scenePath: "res://main.tscn" });
  assert.equal(host.pendingCommands.size, 0);
});

test("sendEngineCommand rejects on timeout and cleans up", async (t) => {
  const host = await createHost(t);
  await connectFakeEngine(t);

  await assert.rejects(
    host.sendEngineCommand("editor", "ping", {}, { timeoutMs: 200 }),
    /timed out/,
  );
  assert.equal(host.pendingCommands.size, 0);
});

test("sendEngineCommand rejects when no engine is connected", async (t) => {
  const host = await createHost(t);
  await assert.rejects(host.sendEngineCommand("editor", "ping"), /no engine connected/);
});

test("cmd.result events are not appended to the trace", async (t) => {
  const host = await createHost(t);
  const engine = await connectFakeEngine(t);

  engine.onMessage((message) => {
    if (message.kind === "control" && message.action === "cmd") {
      engine.send({
        kind: "event",
        type: "cmd.result",
        id: message.id,
        ok: true,
        data: { ok: true },
        error: null,
      });
    }
  });

  // Start a trace by sending a normal engine event.
  engine.send({ kind: "event", type: "engine.connected", source: "godot", data: {} });
  await engine.nextMessage(); // host.ack

  const data = await host.sendEngineCommand("game", "get_performance", {});
  assert.deepEqual(data, { ok: true });

  const trace = readTrace(host.store, host.trace.traceId);
  const cmdResults = trace.timeline.filter((item) => item.type === "cmd.result");
  assert.equal(cmdResults.length, 0);
});

test("host relays cmd sent as control action from a client socket", async (t) => {
  const host = await createHost(t);
  const engine = await connectFakeEngine(t);

  engine.onMessage((message) => {
    if (message.kind === "control" && message.action === "cmd") {
      engine.send({
        kind: "event",
        type: "cmd.result",
        id: message.id,
        ok: true,
        data: { fps: 60 },
        error: null,
      });
    }
  });

  const client = await connectWebSocket({ host: TEST_HOST, port: INTAKE_PORT });
  t.after(() => client.close());
  await client.nextMessage(); // host.hello

  client.send({
    kind: "control",
    action: "cmd",
    id: "cli-1",
    domain: "game",
    command: "get_performance",
    params: {},
  });
  const result = await client.nextMessage();
  assert.equal(result.kind, "control.result");
  assert.equal(result.ok, true);
  assert.equal(result.id, "cli-1");
  assert.deepEqual(result.data, { fps: 60 });
});
