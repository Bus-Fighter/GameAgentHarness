import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestFieldTrace } from "../src/dev/test-field.js";
import { loadProfile } from "../src/core/profile.js";
import { listTools, dispatch } from "../src/mcp/registry.js";

function makeCtx(traceDir, extra = {}) {
  return {
    godotPath: null,
    projectRoot: process.cwd(),
    traceDir,
    profile: null,
    bridge: null,
    ...extra,
  };
}

test("harness tools are registered", () => {
  const names = listTools().map((t) => t.name);
  for (const expected of [
    "harness_list_traces",
    "harness_trace_summarize",
    "harness_trace_inspect",
    "harness_get_context",
    "harness_validate_scenario",
    "harness_capture_frame",
    "harness_editor_logs",
    "engine_command",
  ]) {
    assert.ok(names.includes(expected), `missing tool: ${expected}`);
  }
});

test("harness_list_traces lists the fixture trace", async () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-harness-"));
  const created = createTestFieldTrace({ traceDir });
  const result = await dispatch("harness_list_traces", {}, makeCtx(traceDir));
  assert.notEqual(result.isError, true);
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.count, 1);
  assert.equal(data.traces[0].id, created.traceId);
  assert.ok(data.traces[0].startedAt);
  assert.ok(data.traces[0].counts.events > 0);
});

test("harness_trace_summarize returns markdown summary", async () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-harness-"));
  const created = createTestFieldTrace({ traceDir });
  const result = await dispatch("harness_trace_summarize", {}, makeCtx(traceDir));
  assert.notEqual(result.isError, true);
  assert.match(result.content[0].text, new RegExp(`# Trace Summary: ${created.traceId}`));
  assert.match(result.content[0].text, /player\.hp_changed/);
});

test("harness_trace_inspect filters by stream and type", async () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-harness-"));
  createTestFieldTrace({ traceDir });
  const result = await dispatch("harness_trace_inspect", { stream: "events", type: "player", limit: 5 }, makeCtx(traceDir));
  assert.notEqual(result.isError, true);
  const data = JSON.parse(result.content[0].text);
  assert.ok(data.count >= 1);
  assert.ok(data.items.every((item) => item.type.startsWith("player")));
  assert.ok(data.items.some((item) => item.type === "player.hp_changed"));
});

test("harness_get_context returns context JSON", async () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-harness-"));
  createTestFieldTrace({ traceDir });
  const result = await dispatch("harness_get_context", {}, makeCtx(traceDir));
  assert.notEqual(result.isError, true);
  const context = JSON.parse(result.content[0].text);
  assert.equal(context.scene, "test://scenes/TestArena");
  assert.equal(context.latestSnapshot.player.hp, 2);
});

test("harness_validate_scenario runs scenario checks", async () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-harness-"));
  createTestFieldTrace({ traceDir });
  const scenarioPath = fileURLToPath(new URL("../examples/test-field.validation.json", import.meta.url));
  const profile = loadProfile(fileURLToPath(new URL("../examples/test-field.profile.json", import.meta.url)));
  const result = await dispatch("harness_validate_scenario", { scenario: scenarioPath }, makeCtx(traceDir, { profile }));
  assert.notEqual(result.isError, true);
  const report = JSON.parse(result.content[0].text);
  assert.equal(report.ok, true);
  assert.equal(report.failed, 0);
  assert.ok(report.checks.length > 0);
  assert.ok(report.checks.every((check) => typeof check.ok === "boolean"));
});

test("harness_editor_logs returns log stream items", async () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-harness-"));
  createTestFieldTrace({ traceDir });
  const result = await dispatch("harness_editor_logs", { limit: 10 }, makeCtx(traceDir));
  assert.notEqual(result.isError, true);
  const data = JSON.parse(result.content[0].text);
  assert.ok(data.items.length >= 1);
  assert.ok(data.items.every((item) => item.stream === "logs" || item.type.startsWith("log.")));
  assert.ok(data.items.some((item) => item.type === "log.info"));
});

test("engine_command without bridge returns isError", async () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-harness-"));
  const result = await dispatch("engine_command", { domain: "game", command: "get_tree" }, makeCtx(traceDir));
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /bridge/i);
});

test("harness_capture_frame without bridge returns isError with guidance", async () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-harness-"));
  const result = await dispatch("harness_capture_frame", {}, makeCtx(traceDir));
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /bridge/i);
});

test("engine_command with fake bridge passes through cmd", async () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-harness-"));
  const calls = [];
  const bridge = {
    isAvailable: async () => true,
    cmd: async (domain, command, params) => {
      calls.push({ domain, command, params });
      return { root: { name: "Root" } };
    },
  };
  const result = await dispatch("engine_command", { domain: "game", command: "get_tree", params: { depth: 2 } }, makeCtx(traceDir, { bridge }));
  assert.notEqual(result.isError, true);
  assert.deepEqual(calls, [{ domain: "game", command: "get_tree", params: { depth: 2 } }]);
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.ok, true);
  assert.equal(data.data.root.name, "Root");
});
