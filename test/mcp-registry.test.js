import test from "node:test";
import assert from "node:assert/strict";
import { listTools, dispatch } from "../src/mcp/registry.js";

const EXPECTED_TOOLS = [
  "launch_editor", "run_project", "stop_project", "get_debug_output", "capture_screenshot", "get_godot_version",
  "execute_gdscript", "query_scene_tree", "inspect_node",
  "run_and_verify", "analyze_error", "validate_scripts", "validate_project",
  "list_projects", "get_project_info", "list_files", "read_project_config", "create_project", "import_resources",
  "read_scene", "create_scene", "add_node", "batch_add_nodes", "save_scene", "load_sprite",
  "edit_node", "remove_node", "quick_scene", "instance_scene", "detach_instance", "diff_scenes", "merge_scene",
  "read_script", "write_script", "edit_script", "project_replace",
  "get_uid", "update_project_uids",
];

const ctx = {
  godotPath: null,
  projectRoot: process.cwd(),
  traceDir: "traces",
  profile: null,
  bridge: null,
};

test("registry lists all Tier A tools with unique names", () => {
  const tools = listTools();
  const names = tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, "tool names must be unique");
  for (const expected of EXPECTED_TOOLS) {
    assert.ok(names.includes(expected), `missing tool: ${expected}`);
  }
});

test("all tools have valid MCP schemas", () => {
  for (const tool of listTools()) {
    assert.equal(typeof tool.name, "string");
    assert.ok(tool.name.length > 0);
    assert.equal(typeof tool.description, "string");
    assert.ok(tool.description.length > 0);
    assert.equal(tool.inputSchema.type, "object", `${tool.name} inputSchema.type`);
    assert.equal(typeof tool.inputSchema.properties, "object", `${tool.name} inputSchema.properties`);
  }
});

test("dispatch returns error result for unknown tool", async () => {
  const result = await dispatch("no_such_tool", {}, ctx);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unknown tool/);
});

test("analyze_error works without Godot", async () => {
  const result = await dispatch("analyze_error", {
    output: 'SCRIPT ERROR: Parse Error: Expected ")" at end of expression.\nat: res://main.gd:12\n',
  }, ctx);
  assert.notEqual(result.isError, true);
  const analysis = JSON.parse(result.content[0].text);
  assert.equal(analysis.hasErrors, true);
  assert.equal(analysis.errors[0].type, "parse_error");
  assert.equal(analysis.errors[0].line, 12);
});

test("destructive tools require confirm_token round trip", async () => {
  const first = await dispatch("project_replace", {
    project_path: "nonexistent-dir",
    search: "a",
    replace: "b",
  }, ctx);
  assert.notEqual(first.isError, true);
  assert.match(first.content[0].text, /confirm_token="([^"]+)"/);
  const token = first.content[0].text.match(/confirm_token="([^"]+)"/)[1];

  const second = await dispatch("project_replace", {
    project_path: "nonexistent-dir",
    search: "a",
    replace: "b",
    confirm_token: token,
  }, ctx);
  assert.equal(second.isError, true);
  assert.match(second.content[0].text, /project_path|project.godot|does not exist/i);

  const reused = await dispatch("project_replace", {
    project_path: "nonexistent-dir",
    search: "a",
    replace: "b",
    confirm_token: token,
  }, ctx);
  assert.equal(reused.isError, true);
  assert.match(reused.content[0].text, /Invalid or expired confirm_token/);
});
