import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, createHttpHandler } from "../src/mcp/mcp-server.js";
import { listTools, dispatch } from "../src/mcp/registry.js";
import { DashboardServer } from "../src/dashboard/dashboard-server.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

function makeCtxOptions(tmp) {
  return {
    dispatch,
    listTools,
    projectRoot: tmp,
    traceDir: path.join(tmp, "traces"),
    bridge: null,
  };
}

function makeGodotProject(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-server-test-"));
  const projectDir = path.join(tmp, "demo");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, "project.godot"), "; Engine configuration file.\n");
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return { tmp, projectDir };
}

test("createMcpServer: ListTools returns registry tools and CallTool dispatches", async (t) => {
  const { tmp } = makeGodotProject(t);
  const server = createMcpServer(makeCtxOptions(tmp));
  const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const toolsResult = await client.listTools();
  assert.ok(toolsResult.tools.length >= 38, `expected >= 38 tools, got ${toolsResult.tools.length}`);
  assert.ok(toolsResult.tools.some((tool) => tool.name === "list_projects"));

  const callResult = await client.callTool({ name: "list_projects", arguments: { directory: tmp, recursive: false } });
  assert.ok(Array.isArray(callResult.content));
  assert.notEqual(callResult.isError, true);
  assert.match(callResult.content[0].text, /demo/);
});

async function postJsonRpc(port, payload) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(payload),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
    return { status: response.status, body: dataLine ? JSON.parse(dataLine.slice(5)) : null };
  }
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test("createHttpHandler: initialize, tools/list, tools/call over Streamable HTTP", async (t) => {
  const { tmp } = makeGodotProject(t);
  const handler = createHttpHandler(makeCtxOptions(tmp));
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      handler.handle(req, res, body ? JSON.parse(body) : undefined);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  t.after(async () => {
    await handler.close();
    server.close();
  });

  const init = await postJsonRpc(port, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.1" },
    },
  });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.serverInfo.name, "game-agent-harness");

  const toolsList = await postJsonRpc(port, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(toolsList.status, 200);
  assert.ok(toolsList.body.result.tools.length >= 38);

  const call = await postJsonRpc(port, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "list_projects", arguments: { directory: tmp, recursive: false } },
  });
  assert.equal(call.status, 200);
  assert.notEqual(call.body.result.isError, true);
  assert.match(call.body.result.content[0].text, /demo/);
});

test("dashboard /mcp returns 503 when MCP stopped, serves JSON-RPC when running", async (t) => {
  const { tmp } = makeGodotProject(t);
  const state = { running: false, startedAt: null, clientRequests: 0 };
  const dashboard = new DashboardServer({
    host: "127.0.0.1",
    port: 0,
    traceDir: path.join(tmp, "traces"),
    projectRoot: tmp,
    mcpHooks: {
      getStatus: () => ({ ...state }),
      start: () => {
        state.running = true;
        state.startedAt = new Date().toISOString();
      },
      stop: () => {
        state.running = false;
      },
      getCtx: () => ({ projectRoot: tmp, traceDir: path.join(tmp, "traces"), bridge: null }),
      dispatch: (name, args, ctx) => {
        state.clientRequests += 1;
        return dispatch(name, args, ctx);
      },
    },
  });
  await dashboard.start();
  const port = dashboard.server.address().port;
  t.after(() => dashboard.stop());

  const stopped = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assert.equal(stopped.status, 503);
  assert.match((await stopped.json()).error, /not running/);

  const statusBefore = await (await fetch(`http://127.0.0.1:${port}/api/mcp/status`)).json();
  assert.equal(statusBefore.running, false);
  assert.equal(statusBefore.transport, "streamable-http");
  assert.ok(statusBefore.toolCount >= 38);

  const started = await (await fetch(`http://127.0.0.1:${port}/api/mcp/start`, { method: "POST" })).json();
  assert.equal(started.running, true);
  assert.ok(started.startedAt);
  assert.match(started.url, /\/mcp$/);

  const toolsList = await postJsonRpc(port, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(toolsList.status, 200);
  assert.ok(toolsList.body.result.tools.length >= 38);
  assert.equal(state.clientRequests, 0);

  const stoppedStatus = await (await fetch(`http://127.0.0.1:${port}/api/mcp/stop`, { method: "POST" })).json();
  assert.equal(stoppedStatus.running, false);
});

test("cli: mcp serve answers initialize on stdio", async (t) => {
  const child = spawn(process.execPath, [CLI, "mcp", "serve"], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());

  let stdout = "";
  child.stdout.setEncoding("utf8");
  const responsePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for initialize response; stdout=${stdout}`)), 15000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.id === 1) {
            clearTimeout(timer);
            resolve(parsed);
            return;
          }
        } catch {}
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`mcp serve exited early with code ${code}; stdout=${stdout}`));
    });
  });

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.1" },
    },
  })}\n`);

  const response = await responsePromise;
  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.result.serverInfo.name, "game-agent-harness");
  child.kill();
});
