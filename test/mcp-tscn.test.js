import test from "node:test";
import assert from "node:assert/strict";
import { resolveWithinRoot, normalizeUserProjectPath, validateProjectRoot } from "../src/mcp/path-utils.js";
import { scanGdscriptSandbox, stripLiterals } from "../src/mcp/guard.js";
import { parseTscn, diffTscn } from "../src/mcp/tscn/parser.js";
import { addNode, removeNode, editNodeProperties, detachInstance } from "../src/mcp/tscn/editor.js";
import { mergeTscn } from "../src/mcp/tscn/merge.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

test("resolveWithinRoot rejects traversal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-paths-"));
  assert.throws(() => resolveWithinRoot(root, "../outside.txt"), /traversal/);
  assert.throws(() => resolveWithinRoot(root, "a/../../outside.txt"), /traversal/);
  assert.throws(() => resolveWithinRoot(root, "%2e%2e/outside.txt"), /traversal/);
  assert.throws(() => resolveWithinRoot(root, "CON.txt"), /traversal/);
  const ok = resolveWithinRoot(root, "scenes/main.tscn");
  assert.ok(ok.startsWith(fs.realpathSync(root)));
});

test("validateProjectRoot requires project.godot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-proj-"));
  assert.throws(() => validateProjectRoot(root), /project.godot/);
  fs.writeFileSync(path.join(root, "project.godot"), "");
  assert.equal(validateProjectRoot(root), root);
});

test("normalizeUserProjectPath strips res://", () => {
  assert.equal(normalizeUserProjectPath("res://scenes/main.tscn"), "scenes/main.tscn");
  assert.equal(normalizeUserProjectPath("scenes/main.tscn"), "scenes/main.tscn");
});

test("sandbox scanner blocks dangerous APIs but allows safe code", () => {
  assert.ok(scanGdscriptSandbox('OS.execute("calc.exe", [])').length > 0);
  assert.ok(scanGdscriptSandbox('var f = FileAccess.open("x", FileAccess.WRITE)').length > 0);
  assert.ok(scanGdscriptSandbox('Thread.new()').length > 0);
  assert.ok(scanGdscriptSandbox('str2var("x")').length > 0);
  assert.ok(scanGdscriptSandbox('load("/etc/passwd")').length > 0);
  assert.equal(scanGdscriptSandbox('var s = load("res://scenes/main.tscn")').length, 0);
  assert.equal(scanGdscriptSandbox("print(\"hello\")\nadd_child(node)").length, 0);
  const bypass = '"OS" + ".execute"';
  assert.ok(scanGdscriptSandbox(bypass).length > 0);
});

test("stripLiterals keeps res:// paths", () => {
  const out = stripLiterals('load("res://a.tscn") # comment\nprint("secret")');
  assert.ok(out.includes("res://"));
  assert.ok(!out.includes("secret"));
  assert.ok(!out.includes("comment"));
});

const FIXTURE_A = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://player.gd" id="1"]

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1")
speed = 200

[node name="Sprite2D" type="Sprite2D" parent="."]
position = Vector2(10, 20)
`;

test("tscn parse round trip", () => {
  const parsed = parseTscn(FIXTURE_A);
  assert.equal(parsed.header.format, 3);
  assert.equal(parsed.header.load_steps, 2);
  assert.equal(parsed.extResources.length, 1);
  assert.equal(parsed.extResources[0].path, "res://player.gd");
  assert.equal(parsed.nodes.length, 2);
  const root = parsed.nodes.find((n) => !n.parent);
  assert.equal(root.name, "Player");
  assert.equal(root.type, "CharacterBody2D");
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].name, "Sprite2D");
  const pos = root.children[0].properties.find((p) => p.name === "position");
  assert.deepEqual(pos.value, { __type: "Vector2", value: "10, 20" });
});

test("addNode inserts child and bumps load_steps", () => {
  const result = addNode(FIXTURE_A, { parent: ".", name: "Camera2D", type: "Camera2D", properties: { zoom: { x: 2, y: 2 }, script: "evil" } });
  assert.equal(result.success, true);
  assert.equal(result.fallback, false);
  assert.deepEqual(result.blockedProps, ["script"]);
  assert.ok(result.scene.includes('[node name="Camera2D" type="Camera2D" parent="."]'));
  assert.ok(result.scene.includes("zoom = Vector2(2, 2)"));
  assert.equal(result.scene.split("script =").length - 1, 1, "script property must not be added");
  assert.ok(result.scene.includes("load_steps=3"));
});

test("editNodeProperties updates and appends", () => {
  const result = editNodeProperties(FIXTURE_A, "Sprite2D", { position: { x: 1, y: 1 }, visible: false });
  assert.equal(result.success, true);
  assert.ok(result.scene.includes("position = Vector2(1, 1)"));
  assert.ok(result.scene.includes("visible = false"));
});

test("removeNode removes node and descendants", () => {
  const result = removeNode(FIXTURE_A, "Sprite2D");
  assert.equal(result.success, true);
  assert.ok(!result.scene.includes("Sprite2D"));
  const parsed = parseTscn(result.scene);
  assert.equal(parsed.nodes.length, 1);
});

test("diffTscn reports added/removed/changed", () => {
  const after = FIXTURE_A
    .replace("speed = 200", "speed = 300")
    .replace('[node name="Sprite2D" type="Sprite2D" parent="."]\nposition = Vector2(10, 20)\n', "")
    + '\n[node name="HUD" type="CanvasLayer" parent="."]\n';
  const diff = diffTscn(FIXTURE_A, after);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].name, "Sprite2D");
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].name, "HUD");
  assert.equal(diff.changed.length, 1);
  assert.ok(diff.changed[0].diffs.some((d) => d.property === "speed" && d.before === "200" && d.after === "300"));
});

const FIXTURE_B = `[gd_scene load_steps=2 format=3]

[ext_resource type="Texture2D" path="res://icon.png" id="1"]

[node name="Player" type="CharacterBody2D"]

[node name="Weapon" type="Node2D" parent="."]
texture = ExtResource("1")
`;

test("mergeTscn merges nodes and resources", () => {
  const merged = mergeTscn(FIXTURE_A, FIXTURE_B);
  const parsed = parseTscn(merged);
  assert.ok(parsed.nodes.some((n) => n.name === "Weapon"));
  assert.ok(parsed.extResources.some((e) => e.path === "res://icon.png"));
  assert.ok(parsed.extResources.some((e) => e.path === "res://player.gd"));
  const root = parsed.nodes.find((n) => !n.parent);
  assert.ok(root.children.some((c) => c.name === "Weapon"));
});

const INSTANCE_SOURCE = `[gd_scene format=3]

[node name="Enemy" type="CharacterBody2D"]
hp = 10

[node name="Sprite2D" type="Sprite2D" parent="."]
`;

const INSTANCE_TARGET = `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://enemy.tscn" id="1"]

[node name="Level" type="Node2D"]

[node name="EnemyA" parent="." instance=ExtResource("1")]
position = Vector2(5, 5)
`;

test("detachInstance inlines instanced scene nodes", () => {
  const result = detachInstance(INSTANCE_TARGET, INSTANCE_SOURCE, "EnemyA", ".");
  const parsed = parseTscn(result);
  const enemy = parsed.nodes.find((n) => n.name === "EnemyA");
  assert.ok(enemy);
  assert.equal(enemy.type, "CharacterBody2D");
  assert.equal(enemy.instance, undefined);
  assert.ok(enemy.properties.some((p) => p.name === "position"));
  assert.ok(parsed.nodes.some((n) => n.name === "Sprite2D" && n.parent === "EnemyA"));
});
