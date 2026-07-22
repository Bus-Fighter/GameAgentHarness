import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listTools, dispatch } from "../src/mcp/registry.js";
import * as nav from "../src/mcp/operations/navigation.js";
import * as particles from "../src/mcp/operations/particles.js";
import * as animation from "../src/mcp/operations/animation.js";
import * as animtree from "../src/mcp/operations/animtree.js";
import * as ik from "../src/mcp/operations/ik.js";
import * as ui from "../src/mcp/operations/ui.js";
import * as material from "../src/mcp/operations/material.js";
import * as apidocs from "../src/mcp/operations/apidocs.js";
import * as testexport from "../src/mcp/operations/testexport.js";
import * as workflow from "../src/mcp/operations/workflow.js";
import * as recording from "../src/mcp/operations/recording.js";

const EXPECTED_TOOLS = [
  "nav_create_region", "nav_bake_mesh", "nav_create_agent", "nav_set_params", "nav_create_link", "nav_query_path",
  "particles_create", "particles_set_emission", "particles_set_process", "particles_load_preset", "particles_set_material",
  "animation",
  "animtree_create", "animtree_add_state", "animtree_add_transition", "animtree_set_blend", "animtree_play",
  "ik_modifier_create", "ik_modifier_get", "ik_modifier_set", "ik_list_bones",
  "ui_create_control", "ui_build_layout", "ui_set_layout", "ui_get_layout", "ui_anchor_preset",
  "ui_set_theme", "ui_container_add", "theme_create", "theme_set_property",
  "material_read", "material_write", "shader_edit",
  "get_class_info", "search_classes", "find_method", "get_inheritance",
  "run_tests", "test_assert", "test_stress", "export_list_presets", "export_get_preset", "export_build",
  "dev_loop", "scene_snapshot", "batch_validate", "validate_gdd", "chain_verify", "list_templates", "apply_template",
  "recording_start", "recording_stop", "recording_save", "recording_load", "recording_play",
];

const ctx = {
  godotPath: null,
  projectRoot: process.cwd(),
  traceDir: fs.mkdtempSync(path.join(os.tmpdir(), "harness-ops2-test-")),
  profile: null,
  bridge: null,
};

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-ops2-proj-"));
  fs.writeFileSync(path.join(dir, "project.godot"), "[application]\nconfig/name=\"Test\"\n", "utf8");
  return dir;
}

// ─── Registration ────────────────────────────────────────────────────────────

test("all WS6b tools are registered with unique names", () => {
  const tools = listTools();
  const names = tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, "tool names must be globally unique (registry-wide, incl. other batch)");
  for (const expected of EXPECTED_TOOLS) {
    assert.ok(names.includes(expected), `missing tool: ${expected}`);
  }
});

test("all WS6b tools have valid schemas", () => {
  const tools = listTools().filter((t) => EXPECTED_TOOLS.includes(t.name));
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object", tool.name);
    assert.equal(typeof tool.description, "string");
    assert.ok(tool.description.length > 0);
    assert.equal(typeof tool.inputSchema.properties, "object");
  }
});

// ─── Param validation (isError, no Godot) ────────────────────────────────────

test("nav tools validate params without Godot", async () => {
  const project = makeProject();
  let r = await dispatch("nav_create_region", { project_path: project, name: "bad/name" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /INVALID_PARAMS/);

  r = await dispatch("nav_set_params", { project_path: project, node_path: "root/A", params: { radius: -5 } }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /No valid params/);

  r = await dispatch("nav_query_path", { project_path: project, start_pos: { x: 0, y: 0 }, end_pos: { x: 1, y: 1, z: 1 } }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /INVALID_VECTOR/);
});

test("particles tools validate params without Godot", async () => {
  const project = makeProject();
  let r = await dispatch("particles_create", { project_path: project, node_type: "CPUParticles2D", name: "P" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /INVALID_TYPE/);

  r = await dispatch("particles_load_preset", { project_path: project, node_path: "root/P", preset: "lava" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /PRESET_NOT_FOUND/);
});

test("animation validates action and required params without Godot", async () => {
  const project = makeProject();
  let r = await dispatch("animation", { project_path: project, action: "bogus" }, ctx);
  assert.equal(r.isError, true);
  r = await dispatch("animation", { project_path: project, action: "play", node_path: "root/AP" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /animation_name required/);
});

test("animtree/ik validate without Godot", async () => {
  const project = makeProject();
  let r = await dispatch("animtree_set_blend", { project_path: project, node_path: "root/T", parameter_name: "p" }, ctx);
  assert.equal(r.isError, true);
  r = await dispatch("ik_modifier_create", { project_path: project, type: "BadIK", name: "X" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /INVALID_TYPE/);
  r = await dispatch("ik_modifier_set", { project_path: project, node_path: "root/X", properties: { bogus: 1 } }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Unknown property/);
});

test("ui tools validate without Godot", async () => {
  const project = makeProject();
  fs.writeFileSync(path.join(project, "ui.tscn"), "[gd_scene format=3]\n\n[node name=\"Root\" type=\"Control\"]\n", "utf8");
  let r = await dispatch("ui_create_control", { project_path: project, scene_path: "ui.tscn", node_type: "Node3D", node_name: "X" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /INVALID_CONTROL_TYPE/);
  r = await dispatch("ui_anchor_preset", { project_path: project, scene_path: "ui.tscn", node_path: "root", preset: "nope" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /INVALID_ANCHOR_PRESET/);
  r = await dispatch("ui_build_layout", { project_path: project, scene_path: "ui.tscn", tree: { name: "L", layout: { direction: "diagonal" } } }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /INVALID_LAYOUT/);
  r = await dispatch("ui_create_control", { project_path: project, scene_path: "../escape.tscn", node_type: "Label", node_name: "X" }, ctx);
  assert.equal(r.isError, true);
});

test("material/shader validate without Godot", async () => {
  const project = makeProject();
  let r = await dispatch("material_write", { project_path: project, action: "set_params", node_path: "root/M", params: { script: "x" } }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /blocked/);
  r = await dispatch("shader_edit", { project_path: project, action: "apply_template", node_path: "root/M", template_name: "nope" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /INVALID_TEMPLATE/);
});

test("shader_edit list_templates works without Godot", async () => {
  const r = await dispatch("shader_edit", { project_path: "whatever", action: "list_templates" }, ctx);
  assert.notEqual(r.isError, true);
  const parsed = JSON.parse(r.content[0].text);
  assert.equal(parsed.success, true);
  assert.ok(parsed.templates.length >= 5);
});

test("apidocs validate without Godot", async () => {
  const project = makeProject();
  let r = await dispatch("get_class_info", { project_path: project, class_name: "Not A Class!" }, ctx);
  assert.equal(r.isError, true);
  r = await dispatch("search_classes", { project_path: project, query: "" }, ctx);
  assert.equal(r.isError, true);
  r = await dispatch("search_classes", { project_path: project, query: "Node", limit: -1 }, ctx);
  assert.equal(r.isError, true);
});

test("testexport tools validate without Godot", async () => {
  const project = makeProject();
  let r = await dispatch("run_tests", { project_path: project }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /GUT_NOT_INSTALLED/);

  r = await dispatch("test_assert", { project_path: project, assertion_type: "teleports" }, ctx);
  assert.equal(r.isError, true);

  r = await dispatch("test_stress", { project_path: project, node_type: "Window" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /INVALID_NODE_TYPE/);

  r = await dispatch("export_list_presets", { project_path: project }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /export_presets.cfg not found/);
});

test("export presets parse from export_presets.cfg without Godot", async () => {
  const project = makeProject();
  fs.writeFileSync(path.join(project, "export_presets.cfg"), [
    "[preset.0]",
    "",
    'name="Windows/Desktop"',
    'platform="Windows Desktop"',
    "runnable=true",
    'export_path="build/game.exe"',
    "",
    "[preset.1]",
    "",
    'name="Web"',
    'platform="Web"',
    "runnable=false",
    "",
  ].join("\n"), "utf8");
  let r = await dispatch("export_list_presets", { project_path: project }, ctx);
  assert.notEqual(r.isError, true);
  const listed = JSON.parse(r.content[0].text);
  assert.equal(listed.count, 2);
  assert.equal(listed.presets[0].name, "Windows/Desktop");

  r = await dispatch("export_get_preset", { project_path: project, name: "Web" }, ctx);
  assert.notEqual(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).preset.platform, "Web");

  r = await dispatch("export_get_preset", { project_path: project, name: "Nope" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /PRESET_NOT_FOUND/);
});

test("workflow pure tools work without Godot", async () => {
  let r = await dispatch("chain_verify", { verdict: "pass", context: "only checked the happy path" }, ctx);
  assert.notEqual(r.isError, true);
  const cov = JSON.parse(r.content[0].text);
  assert.equal(cov.questions.length, 5);
  assert.ok(cov.confidence < 0.9, "weak signal lowers confidence");

  r = await dispatch("list_templates", {}, ctx);
  assert.notEqual(r.isError, true);
  assert.match(r.content[0].text, /T001/);
  assert.match(r.content[0].text, /T010/);

  r = await dispatch("validate_gdd", { project_path: makeProject(), gdd_path: "missing.md" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /FILE_NOT_FOUND/);
});

test("validate_gdd enforces the 8-section standard", async () => {
  const project = makeProject();
  const good = workflow.GDD_REQUIRED_SECTIONS.map((s) => `## ${s}\n\n- This section has enough body content to pass the minimum length check.`).join("\n\n");
  fs.writeFileSync(path.join(project, "gdd.md"), `# GDD\n\n${good}\n`, "utf8");
  let r = await dispatch("validate_gdd", { project_path: project, gdd_path: "gdd.md" }, ctx);
  assert.notEqual(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).passed, true);

  fs.writeFileSync(path.join(project, "bad.md"), "# GDD\n\n## Overview\n\nToo short.\n", "utf8");
  r = await dispatch("validate_gdd", { project_path: project, gdd_path: "bad.md" }, ctx);
  const bad = JSON.parse(r.content[0].text);
  assert.equal(bad.passed, false);
  assert.equal(bad.sections_missing.length, 7);
});

test("apply_template writes a script within the project", async () => {
  const project = makeProject();
  let r = await dispatch("apply_template", { project_path: project, template_id: "T010", script_path: "scripts/sm.gd", variables: { states: "IDLE,ATTACK" } }, ctx);
  assert.notEqual(r.isError, true);
  const content = fs.readFileSync(path.join(project, "scripts", "sm.gd"), "utf8");
  assert.match(content, /enum State/);
  assert.match(content, /ATTACK/);

  r = await dispatch("apply_template", { project_path: project, template_id: "T999", script_path: "scripts/x.gd" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /TEMPLATE_NOT_FOUND/);

  r = await dispatch("apply_template", { project_path: project, template_id: "T010", script_path: "../evil.gd" }, ctx);
  assert.equal(r.isError, true);
});

test("recording validation without Godot", async () => {
  const project = makeProject();
  let r = await dispatch("recording_save", { project_path: project, events_json: "not json" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /INVALID_RECORDING_FORMAT/);

  r = await dispatch("recording_load", { project_path: project, file_name: "../evil.json" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /INVALID_FILE_NAME/);

  r = await dispatch("recording_play", { project_path: project, events_json: JSON.stringify({ version: 1, events: [] }) }, ctx);
  // would need Godot; if no binary, still an error result either way
  assert.equal(r.isError, true);
});

test("recording session start/stop round trip (traceDir file memory)", async () => {
  const project = makeProject();
  let r = await dispatch("recording_start", { project_path: project, session_name: "s1" }, ctx);
  assert.notEqual(r.isError, true);

  r = await dispatch("recording_start", { project_path: project }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /RECORDING_IN_PROGRESS/);

  r = await dispatch("recording_stop", { project_path: project }, ctx);
  assert.notEqual(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).session.active, false);

  r = await dispatch("recording_stop", { project_path: project }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /NO_RECORDING/);
});

// ─── Script generators (pure functions) ──────────────────────────────────────

test("nav generators produce valid GDScript structure", () => {
  const s1 = nav.genCreateRegionScript("Nav", "root", { x: 1, y: 2, z: 3 }, true);
  assert.match(s1, /extends SceneTree/);
  assert.match(s1, /NavigationRegion3D\.new\(\)/);
  assert.match(s1, /bake_navigation_mesh/);
  assert.match(s1, /_mcp_output\("created"/);

  const s2 = nav.genNavQueryScript({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 });
  assert.match(s2, /NavigationServer3D\.map_get_path/);

  const s3 = nav.genSetParamsScript("root/A", { radius: 1.5, avoidance_enabled: true });
  assert.match(s3, /_agent\.radius = 1\.5/);
  assert.match(s3, /_agent\.avoidance_enabled = true/);

  assert.equal(nav.ff(2), "2.0");
  assert.equal(nav.ff(2.5), "2.5");
  assert.throws(() => nav.validateVector3({ x: 1, y: 2 }), /z/);
});

test("particles generators and presets", () => {
  const s = particles.genParticlesCreateScript("GPUParticles3D", "Fire", "root", { x: 1, y: 2, z: 3 });
  assert.match(s, /GPUParticles3D\.new\(\)/);
  assert.match(s, /Vector3\(1\.0, 2\.0, 3\.0\)/);

  const p = particles.genLoadPresetScript("root/P", "fire");
  assert.match(p, /node\.amount = 40/);
  assert.match(p, /ParticleProcessMaterial/);
  assert.equal(particles.genLoadPresetScript("root/P", "bogus"), "");

  const e = particles.genSetEmissionScript("root/P", 10, "sphere", 2.5);
  assert.match(e, /node\.amount = 10/);
  assert.match(e, /EMISSION_SHAPE_SPHERE/);
  assert.match(e, /emission_sphere_radius = 2\.5/);
});

test("animation generators and valueToGd", () => {
  const s = animation.genGetKeyframes("root/AP", "walk", 0);
  assert.match(s, /track_get_key_time/);
  assert.match(s, /Animation not found/);

  const a = animation.genAddTrack("root/AP", "walk", "value", "Sprite2D:frame", 1);
  assert.match(a, /_anim\.add_track\(0, 1\)/);
  assert.match(a, /track_set_path/);

  assert.equal(animation.valueToGd(true), "true");
  assert.equal(animation.valueToGd([1, 2]), "Vector2(1, 2)");
  assert.equal(animation.valueToGd([1, 2, 3]), "Vector3(1, 2, 3)");
  assert.equal(animation.valueToGd([1, 2, 3], "rotation_3d"), "Quaternion.from_euler(Vector3(1, 2, 3))");
  assert.equal(animation.valueToGd([1, 0, 0, 1]), "Color(1, 0, 0, 1)");
  assert.equal(animation.valueToGd("hi"), '"hi"');
  assert.throws(() => animation.valueToGd(NaN));

  assert.equal(animation.animErrorMapper("AnimationPlayer not found"), "NODE_NOT_FOUND");
  assert.equal(animation.animErrorMapper("Animation not found: x"), "ANIM_NOT_FOUND");
});

test("animtree generators", () => {
  const c = animtree.genCreate("Tree", "root", "../Player", "AnimationNodeBlendTree");
  assert.match(c, /AnimationTree\.new\(\)/);
  assert.match(c, /AnimationNodeBlendTree\.new\(\)/);
  const t = animtree.genAddTransition("root/T", "idle", "run", 0.2, [{ name: "speed", value: 1 }]);
  assert.match(t, /add_transition\("idle", "run"/);
  assert.match(t, /add_condition\("speed", 1\)/);
});

test("ik generators", () => {
  const s = ik.genIkCreateScript("TwoBoneIK3D", "IK", "root/Skeleton", undefined, "hand", "../Target");
  assert.match(s, /TwoBoneIK3D\.new\(\)/);
  assert.match(s, /bone_name = "hand"/);
  assert.match(s, /target_nodepath = NodePath\("\.\.\/Target"\)/);
  const b = ik.genListBonesScript("root/Skeleton", 5);
  assert.match(b, /get_bone_count/);
  assert.match(b, /slice\(0, 5\)/);
});

test("ui generators: anchor presets, layout, theme", () => {
  assert.equal(Object.keys(ui.ANCHOR_PRESETS).length, 16);
  const a = ui.genUiAnchorPresetScript("ui.tscn", "root", 15, "full_rect");
  assert.match(a, /set_anchors_preset\(15\)/);

  const l = ui.genUiSetLayoutScript("ui.tscn", "root", { left: 0.5 }, { top: 10 });
  assert.match(l, /anchor_left = 0\.5/);
  assert.match(l, /offset_top = 10/);

  const tree = {
    name: "Menu",
    layout: { direction: "column", alignment: "center", gap: 8 },
    children: [
      { type: "Label", name: "Title", properties: { text: "Hi" } },
      { type: "Button", name: "Play" },
    ],
  };
  const b = ui.genUiBuildLayoutScript("ui.tscn", "root", tree);
  assert.match(b, /VBoxContainer/);
  assert.match(b, /node\.alignment = 1/);
  assert.match(b, /separation", 8\)/);
  assert.match(b, /ClassDB\.instantiate\("Label"\)/);

  const grid = ui.genUiBuildLayoutScript("ui.tscn", "root", { name: "G", layout: { direction: "grid", columns: 3, gap: 4 }, children: [] });
  assert.match(grid, /GridContainer/);
  assert.match(grid, /node\.columns = 3/);

  assert.throws(() => ui.genUiBuildLayoutScript("ui.tscn", "root", { type: "Sprite3D", name: "Bad" }), /INVALID_CONTROL_TYPE/);

  const tp = ui.genThemeSetPropertyScript("root", "color", "font_color", [1, 0, 0, 1], "Label", "ui.tscn");
  assert.match(tp, /set_color\("font_color", "Label", Color\(1, 0, 0, 1\)\)/);
});

test("material generators and param parsing", () => {
  assert.equal(material.parseMaterialParam([1, 2]), "Vector2(1, 2)");
  assert.equal(material.parseMaterialParam([1, 0, 0, 1]), "Color(1, 0, 0, 1)");
  assert.equal(material.parseMaterialParam("res://t.png", true), 'load("res://t.png")');
  assert.throws(() => material.validateParamType([1, 2, 3, 4, 5]));

  const s = material.genMaterialSetParamsScript("root/M", 0, { albedo_color: [1, 0, 0, 1] });
  assert.match(s, /set_shader_parameter\("albedo_color"/);
  const w = material.genShaderWriteScript("root/M", 0, "shader_type canvas_item;");
  assert.match(w, /JSON\.parse_string/);
  assert.match(w, /compile_result/);
  assert.throws(() => material.genShaderApplyTemplateScript("root/M", 0, "bogus"), /Invalid template/);
  assert.ok(Object.keys(material.SHADER_TEMPLATES).length >= 5);
});

test("apidocs generators", () => {
  const s = apidocs.genGetClassInfoScript("Node2D", true);
  assert.match(s, /ClassDB\.class_get_method_list/);
  assert.match(s, /ClassDB\.get_parent_class/);
  const f = apidocs.genFindMethodScript("Node2D", "move_local_x");
  assert.match(f, /while cur != ""/);
  const i = apidocs.genGetInheritanceScript("Node2D");
  assert.match(i, /chain\.append\(cur\)/);
});

test("testexport generators and preset parser", () => {
  const a = testexport.genTestAssertScript({ assertionType: "node_exists", path: "root/Player" });
  assert.match(a, /"node_exists"/);
  const st = testexport.genTestStressScript("Node2D", 50);
  assert.match(st, /OBJECT_COUNT/);
  assert.match(st, /var _iters = 50/);

  const presets = testexport.parseExportPresets('[preset.0]\nname="A"\nplatform="Web"\nrunnable=true\nfoo="bar"\n');
  assert.equal(presets.length, 1);
  assert.equal(presets[0].name, "A");
  assert.equal(presets[0].runnable, true);
  assert.equal(presets[0].options.foo, "bar");
});

test("workflow pure functions: gdd, cov, templates, snapshot diff", () => {
  const gdd = workflow.validateGDD("# Title\n\n## Overview\n\nSome overview text here that is long enough.\n");
  assert.equal(gdd.passed, false);
  assert.ok(gdd.sections_missing.includes("Formulas"));

  const cov = workflow.chainOfVerification("pass", "checked everything thoroughly with all evidence");
  assert.equal(cov.questions.length, 5);
  assert.ok(cov.confidence > 0.8);

  assert.equal(workflow.TEMPLATES.length, 4);
  const state = workflow.formatSessionState({ current_task: "Port tools", decisions: ["Use ClassDB"] });
  assert.match(state, /# Session State/);
  assert.match(state, /Use ClassDB/);

  const before = { name: "Root", type: "Node", children: [{ name: "A", type: "Node2D", children: [] }] };
  const after = { name: "Root", type: "Node", children: [{ name: "B", type: "Node2D", children: [] }] };
  const diff = workflow.diffSnapshots(before, after);
  assert.deepEqual(diff.added, ["Root/B"]);
  assert.deepEqual(diff.removed, ["Root/A"]);

  const snap = workflow.genSceneSnapshotScript("res://main.tscn", 5);
  assert.match(snap, /func _snap/);
});

test("recording helpers", () => {
  assert.equal(recording.sanitizeRecordingFileName("recording_abc-1.json"), "recording_abc-1.json");
  assert.throws(() => recording.sanitizeRecordingFileName("recording_../x.json"), /traversal/);
  assert.throws(() => recording.sanitizeRecordingFileName("evil.json"), /recording_\*\.json/);
  assert.match(recording.generateRecordingFileName(), /^recording_\d{8}_\d{6}\.json$/);

  const valid = recording.validateEventsJson(JSON.stringify({ version: 1, duration_ms: 100, events: [] }));
  assert.equal(valid.version, 1);
  assert.throws(() => recording.validateEventsJson("{}"), /version/);
  assert.throws(() => recording.validateEventsJson("nope"), /not valid JSON/);

  assert.equal(recording.keycodeToBridgeKey(4), "a");
  assert.equal(recording.keycodeToBridgeKey(999), null);

  const play = recording.genRecordingPlayScript("{}", 2.0);
  assert.match(play, /Input\.parse_input_event/);
  assert.match(play, /InputEventScreenDrag/);
});

// ─── Real Godot execution (skipped when binary unavailable) ──────────────────

function findGodot() {
  if (process.env.GODOT_PATH && fs.existsSync(process.env.GODOT_PATH)) return process.env.GODOT_PATH;
  return null;
}

const godotBin = findGodot();
const maybe = godotBin ? test : test.skip;

maybe("search_classes works against a real Godot binary", async () => {
  const project = makeProject();
  const r = await dispatch("search_classes", { project_path: project, query: "AnimationPlayer", limit: 5, godot_path: godotBin }, ctx);
  assert.notEqual(r.isError, true);
  assert.match(r.content[0].text, /AnimationPlayer/);
});

maybe("test_assert node_exists on empty project", async () => {
  const project = makeProject();
  const r = await dispatch("test_assert", { project_path: project, assertion_type: "node_exists", path: "root", godot_path: godotBin }, ctx);
  assert.notEqual(r.isError, true);
  assert.match(r.content[0].text, /passed/);
});
