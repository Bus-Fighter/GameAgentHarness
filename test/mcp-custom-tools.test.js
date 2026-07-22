import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const customModule = await import("../src/mcp/operations/custom.js");

function makeTempProject(toolsJson) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-custom-tools-"));
  if (toolsJson !== undefined) {
    fs.mkdirSync(path.join(dir, ".harness"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".harness", "custom-tools.json"), JSON.stringify(toolsJson));
  }
  return dir;
}

function fakeBridge(recorded, response = { ok: true }) {
  return {
    async cmd(domain, command, params) {
      recorded.push({ domain, command, params });
      return response;
    },
  };
}

async function importDeclaredFresh() {
  const url = pathToFileURL(path.resolve("src/mcp/operations/custom-declared.js")).href;
  return import(`${url}?t=${Date.now()}-${Math.random()}`);
}

test("custom.js: tools error cleanly when bridge unavailable", async () => {
  const ctx = { projectRoot: process.cwd(), bridge: null };
  for (const tool of customModule.tools) {
    const args = {};
    for (const req of tool.inputSchema.required ?? []) args[req] = "x";
    const result = await customModule.handle(tool.name, args, ctx);
    assert.equal(result.isError, true, `${tool.name} should be an error result`);
    assert.match(result.content[0].text, /bridge unavailable/i);
  }
});

test("custom.js: console_execute forwards { input } to game.console_exec", async () => {
  const calls = [];
  const ctx = { projectRoot: process.cwd(), bridge: fakeBridge(calls, { success: true, logs: [], events: [] }) };
  const result = await customModule.handle("console_execute", { input: "info version" }, ctx);
  assert.notEqual(result.isError, true);
  assert.deepEqual(calls, [{ domain: "game", command: "console_exec", params: { input: "info version" } }]);
});

test("custom-declared: registers tool from .harness/custom-tools.json", async () => {
  const dir = makeTempProject({
    tools: [
      {
        name: "my_game_tool",
        description: "test tool",
        inputSchema: { type: "object", properties: { who: { type: "string" } } },
        target: { domain: "game", command: "some_command", paramMap: { who: "entity" } },
      },
    ],
  });
  const mod = await importDeclaredFresh();
  const calls = [];
  const ctx = { projectRoot: dir, bridge: fakeBridge(calls) };
  const result = await mod.handle("my_game_tool", { who: "player", extra: 1 }, ctx);
  assert.notEqual(result.isError, true);
  assert.deepEqual(calls, [{
    domain: "game",
    command: "some_command",
    params: { entity: "player", extra: 1 },
  }]);
});

test("custom-declared: collision with built-in is skipped", async () => {
  const dir = makeTempProject({
    tools: [
      {
        name: "list_projects",
        description: "colliding tool",
        target: { domain: "game", command: "x" },
      },
    ],
  });
  const mod = await importDeclaredFresh();
  const calls = [];
  const ctx = { projectRoot: dir, bridge: fakeBridge(calls) };
  const result = await mod.handle("list_projects", {}, ctx);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No declared custom tool/);
  assert.equal(calls.length, 0);
});

test("custom-declared: missing file registers zero tools, no error", async () => {
  const dir = makeTempProject();
  const mod = await importDeclaredFresh();
  const calls = [];
  const ctx = { projectRoot: dir, bridge: fakeBridge(calls) };
  const result = await mod.handle("anything", {}, ctx);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No declared custom tool/);
  assert.equal(calls.length, 0);
});
