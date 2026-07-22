import test from "node:test";
import assert from "node:assert/strict";

const { classifyCmdline, filterByProject } = await import("../src/mcp/process-scan.js");
const { listTools, dispatch } = await import("../src/mcp/registry.js");
const { resetTokens } = await import("../src/mcp/guard.js");

const ctx = { projectRoot: process.cwd(), traceDir: "traces", bridge: null };

test("process control tools are registered", () => {
  const names = listTools().map((t) => t.name);
  assert.ok(names.includes("find_godot_processes"));
  assert.ok(names.includes("kill_godot_process"));
});

test("classifyCmdline detects editor vs game and --path", () => {
  const editor = classifyCmdline('"C:\\Godot\\Godot.exe" -e --path "C:\\proj\\My Game"');
  assert.equal(editor.kind, "editor");
  assert.equal(editor.projectPath, "C:\\proj\\My Game");

  const game = classifyCmdline('"C:\\Godot\\Godot.exe" --path /home/user/proj --debug');
  assert.equal(game.kind, "game");
  assert.equal(game.projectPath, "/home/user/proj");

  const noPath = classifyCmdline("godot --headless --script foo.gd");
  assert.equal(noPath.kind, "game");
  assert.equal(noPath.projectPath, null);
});

test("filterByProject matches normalized paths", () => {
  const processes = [
    { pid: 1, projectPath: "C:\\Users\\x\\cs", cmdline: "" },
    { pid: 2, projectPath: "/other/proj", cmdline: "" },
    { pid: 3, projectPath: null, cmdline: "" },
  ];
  const filtered = filterByProject(processes, "c:/users/x/cs/");
  assert.deepEqual(filtered.map((p) => p.pid), [1]);
  assert.equal(filterByProject(processes, null).length, 3);
});

test("kill_godot_process requires valid pid and confirm token", async () => {
  resetTokens();
  const bad = await dispatch("kill_godot_process", {}, ctx);
  assert.equal(bad.isError, true);

  const gate = await dispatch("kill_godot_process", { pid: 999999 }, ctx);
  assert.notEqual(gate.isError, true);
  const match = gate.content[0].text.match(/confirm_token="([^"]+)"/);
  assert.ok(match, "expected a confirm token in the gate response");

  const invalid = await dispatch("kill_godot_process", { pid: 999999, confirm_token: "bogus" }, ctx);
  assert.equal(invalid.isError, true);
});

test("find_godot_processes returns an array result on this machine", async () => {
  const result = await dispatch("find_godot_processes", {}, ctx);
  assert.notEqual(result.isError, true);
  const parsed = JSON.parse(result.content[0].text);
  assert.ok(Array.isArray(parsed.processes));
  assert.equal(typeof parsed.count, "number");
});
