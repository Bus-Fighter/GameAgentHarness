import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listTools, dispatch } from "../src/mcp/registry.js";
import { findGodotBin } from "../src/core/editor-launcher.js";
import {
  genSignalConnectScript,
  genSignalDisconnectScript,
  genSignalEmitScript,
  genSignalListScript,
} from "../src/mcp/operations/signals.js";
import {
  genRaycastScript,
  genBodyInfoScript,
  genDiagnosePhysicsScript,
  genQuerySpatialScript,
  genCollisionOverlayScript,
} from "../src/mcp/operations/physics.js";
import {
  genAudioPlayScript,
  genAudioStopScript,
  genAudioSetParamScript,
  genAudioQueryScript,
} from "../src/mcp/operations/audio.js";
import {
  genTilemapReadScript,
  genTilemapSetCellScript,
  genTilemapEraseCellScript,
  genTilemapFillRectScript,
  genTilemapClearScript,
  genTilemapCopyScript,
  genTilemapPasteScript,
  genTilemapSetTransformScript,
} from "../src/mcp/operations/tilemap.js";
import { genSpatialInfoScript, genCreate3DScript, TYPE_WHITELIST } from "../src/mcp/operations/spatial.js";
import {
  genProfilerSnapshotScript,
  genProfilerSampleScript,
  genSignalAuditScript,
} from "../src/mcp/operations/profiler.js";

const EXPECTED_TOOLS = [
  "signal_connect", "signal_disconnect", "signal_emit", "signal_list",
  "physics_raycast", "physics_body_info", "diagnose_physics", "query_spatial", "collision_overlay",
  "audio_play", "audio_stop", "audio_set_param", "audio_query",
  "tilemap_read", "tilemap_set_cell", "tilemap_erase_cell", "tilemap_fill_rect",
  "tilemap_clear", "tilemap_copy", "tilemap_paste", "tilemap_set_transform",
  "spatial_info", "node_create_3d",
  "profiler",
];

function makeCtx() {
  return {
    godotPath: null,
    projectRoot: process.cwd(),
    traceDir: fs.mkdtempSync(path.join(os.tmpdir(), "gah-runtime-ops-")),
    profile: null,
    bridge: null,
  };
}

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-runtime-proj-"));
  fs.writeFileSync(path.join(dir, "project.godot"), '; Engine configuration file.\n');
  return dir;
}

test("runtime ops tools are registered with valid schemas", () => {
  const registered = listTools();
  const names = registered.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, "tool names must be unique");
  for (const name of EXPECTED_TOOLS) {
    assert.ok(names.includes(name), `missing tool: ${name}`);
    const tool = registered.find((t) => t.name === name);
    assert.equal(tool.inputSchema.type, "object", `${name} inputSchema.type must be "object"`);
    assert.equal(typeof tool.description, "string");
  }
});

test("param validation returns isError without Godot", async () => {
  const project = makeProject();
  const ctx = makeCtx();
  const cases = [
    ["signal_connect", { project_path: project, source_node: "root/A", target_node: "root/B" }], // missing signal/method
    ["signal_connect", { project_path: project, source_node: "root/A", signal_name: "x y", target_node: "root/B", method_name: "ok" }],
    ["signal_emit", { project_path: project, source_node: "root/A", signal_name: "hit", args: [{ nested: 1 }] }],
    ["signal_list", { project_path: project, node_path: "../escape" }],
    ["physics_raycast", { project_path: project, from: { x: 0, y: 0 } }], // missing z and to
    ["physics_raycast", { project_path: project, from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 0 }, collision_mask: "abc" }],
    ["physics_body_info", { project_path: project, node_path: "../evil" }],
    ["query_spatial", { project_path: project }], // missing origin
    ["collision_overlay", { project_path: project, color_override: "red" }],
    ["audio_play", { project_path: project }], // neither node_path nor stream_path
    ["audio_play", { project_path: project, node_path: "root/Music", volume_db: "loud" }],
    ["audio_set_param", { project_path: project, node_path: "root/Music" }], // no params
    ["audio_stop", { project_path: project }], // missing node_path
    ["tilemap_set_cell", { project_path: project, node_path: "root/TM", coords: { x: 1.5, y: 2 }, source_id: 0, atlas_coords: { x: 0, y: 0 } }],
    ["tilemap_fill_rect", { project_path: project, node_path: "root/TM", region: { x: 0, y: 0, w: 0, h: 2 }, source_id: 0, atlas_coords: { x: 0, y: 0 } }],
    ["tilemap_paste", { project_path: project, node_path: "root/TM", target: { x: 0, y: 0 }, pattern: {} }],
    ["tilemap_read", { project_path: project }], // missing node_path
    ["spatial_info", { project_path: project, node_path: "root/../../etc" }],
    ["node_create_3d", { project_path: project, type: "HTTPClient", name: "Bad" }], // not whitelisted
    ["node_create_3d", { project_path: project, type: "Node3D", name: "bad name!" }],
    ["profiler", { project_path: project, action: "explode" }],
    ["profiler", { project_path: project, action: "sample", duration_ms: -5 }],
  ];
  for (const [tool, args] of cases) {
    const result = await dispatch(tool, args, ctx);
    assert.equal(result.isError, true, `${tool} should reject invalid params: ${result.content[0].text}`);
  }
});

test("signals script generation", () => {
  const connect = genSignalConnectScript({ sourcePath: "root/Player", signalName: "health_changed", targetPath: "root/UI", methodName: "_on_health_changed" });
  assert.match(connect, /source\.connect\("health_changed", Callable\(target, "_on_health_changed"\)\)/);
  assert.match(connect, /_mcp_load_main_scene\(\)/);

  const withFlags = genSignalConnectScript({ sourcePath: "root/A", signalName: "sig", targetPath: "root/B", methodName: "m", flags: 2 });
  assert.match(withFlags, /Callable\(target, "m"\), 2\)/);

  const disconnect = genSignalDisconnectScript({ sourcePath: "root/Player", signalName: "died", targetPath: "root/Game", methodName: "_on_died" });
  assert.match(disconnect, /source\.disconnect\("died", Callable\(target, "_on_died"\)\)/);

  const emit = genSignalEmitScript({ sourcePath: "root/Player", signalName: "hit", args: [5, true, "head", null] });
  assert.match(emit, /source\.emit_signal\("hit", 5, true, "head", null\)/);
  assert.throws(() => genSignalEmitScript({ sourcePath: "root/P", signalName: "s", args: [{ obj: 1 }] }), /basic types/);

  const list = genSignalListScript({ nodePath: "root/Player" });
  assert.match(list, /node\.get_signal_list\(\)/);

  const sceneCtx = genSignalListScript({ nodePath: "root/Player", scenePath: "res://level.tscn" });
  assert.match(sceneCtx, /_mcp_load_scene\("res:\/\/level\.tscn"\)/);
  assert.match(sceneCtx, /_mcp_get_scene_node\("root\/Player"\)/);
});

test("physics script generation", () => {
  const ray = genRaycastScript({ from: { x: 0, y: 1, z: 0 }, to: { x: 0, y: -1, z: 0 }, collisionMask: 4, excludePaths: ["root/Player"] });
  assert.match(ray, /PhysicsRayQueryParameters3D\.create\(Vector3\(0, 1, 0\), Vector3\(0, -1, 0\)\)/);
  assert.match(ray, /query\.collision_mask = 4/);
  assert.match(ray, /exclude_bodies\.append/);
  assert.match(ray, /space_state\.intersect_ray\(query\)/);

  const body = genBodyInfoScript("root/Ball");
  assert.match(body, /get_debug_mesh\(\)\.get_aabb\(\)/);
  assert.match(body, /_mcp_output\("collision_layer", body\.collision_layer\)/);

  const diag = genDiagnosePhysicsScript("root/Ball");
  assert.match(diag, /move_and_collide\(Vector3\.ZERO, true, 0\.001, true\)/);
  assert.match(diag, /ConcavePolygonShape3D/);

  const spatial = genQuerySpatialScript({ center: { x: 1, y: 2, z: 3 }, radius: 5, collisionMask: 2 });
  assert.match(spatial, /SphereShape3D\.new\(\)/);
  assert.match(spatial, /sphere\.radius = 5/);
  assert.match(spatial, /space_state\.intersect_shape\(query\)/);
  assert.match(spatial, /query\.collision_mask = 2/);

  const overlay = genCollisionOverlayScript({ parentPath: "root/Level" });
  assert.match(overlay, /_MCP_CollisionOverlay/);
  assert.match(overlay, /Color\(0\.3, 0\.5, 1\.0, 0\.5\)/);
  const overlayColor = genCollisionOverlayScript({ parentPath: "root", colorOverride: "1, 0, 0, 0.5" });
  assert.match(overlayColor, /var base_color = Color\(1, 0, 0, 0\.5\)/);
});

test("audio script generation", () => {
  const play = genAudioPlayScript({ nodePath: "root/Music", streamPath: "res://sfx/hit.ogg", volumeDb: -6, pitchScale: 1.5, bus: "SFX", fromPosition: 0.5 });
  assert.match(play, /var stream_res = load\("res:\/\/sfx\/hit\.ogg"\)/);
  assert.match(play, /node\.volume_db = -6\.0/);
  assert.match(play, /node\.pitch_scale = 1\.5/);
  assert.match(play, /node\.bus = "SFX"/);
  assert.match(play, /node\.play\(0\.5\)/);

  const playTemp = genAudioPlayScript({ streamPath: "res://a.ogg" });
  assert.match(playTemp, /AudioStreamPlayer\.new\(\)/);

  const stop = genAudioStopScript("root/Music");
  assert.match(stop, /node\.stop\(\)/);

  const setParam = genAudioSetParamScript({ nodePath: "root/Music", volumeDb: -3, bus: "Music" });
  assert.match(setParam, /node\.volume_db = -3\.0/);
  assert.match(setParam, /node\.bus = "Music"/);

  const query = genAudioQueryScript("root/Music");
  assert.match(query, /node\.get_playback_position\(\)/);
  assert.match(query, /_mcp_output\("audio_info", info\)/);
});

test("tilemap script generation", () => {
  const readAll = genTilemapReadScript({ nodePath: "root/TM" });
  assert.match(readAll, /node\.get_used_cells\(0\)/);
  assert.match(readAll, /node\.get_class\(\) == "TileMapLayer"/);

  const readRegion = genTilemapReadScript({ nodePath: "root/TM", region: { x: 1, y: 2, w: 3, h: 4 }, layer: 1 });
  assert.match(readRegion, /for cy in range\(2, 6\)/);
  assert.match(readRegion, /node\.get_cell_source_id\(1, Vector2i\(cx, cy\)\)/);

  const setCell = genTilemapSetCellScript({ nodePath: "root/TM", coords: { x: 3, y: 4 }, sourceId: 2, atlasCoords: { x: 1, y: 0 }, alternativeTile: 0, layer: 1 });
  assert.match(setCell, /node\.set_cell\(1, coords, 2, atlas, 0\)/);
  const setCellLayer = genTilemapSetCellScript({ nodePath: "root/TML", coords: { x: 0, y: 0 }, sourceId: 1, atlasCoords: { x: 0, y: 0 }, alternativeTile: 0 });
  assert.match(setCellLayer, /node\.set_cell\(coords, 1, atlas, 0\)/);

  const erase = genTilemapEraseCellScript({ nodePath: "root/TM", coords: { x: 5, y: 6 } });
  assert.match(erase, /node\.erase_cell\(/);

  const fill = genTilemapFillRectScript({ nodePath: "root/TM", region: { x: 0, y: 0, w: 4, h: 3 }, sourceId: 1, atlasCoords: { x: 2, y: 1 }, alternativeTile: 0 });
  assert.match(fill, /for cy in range\(3\)/);
  assert.match(fill, /for cx in range\(4\)/);

  const clearAll = genTilemapClearScript({ nodePath: "root/TM", clearAll: true });
  assert.match(clearAll, /node\.clear\(\)/);
  const clearLayer = genTilemapClearScript({ nodePath: "root/TM", layer: 2, clearAll: false });
  assert.match(clearLayer, /node\.clear_layer\(2\)/);

  const copy = genTilemapCopyScript({ nodePath: "root/TM", sourceRegion: { x: 0, y: 0, w: 2, h: 2 } });
  assert.match(copy, /_mcp_output\("pattern"/);

  const pattern = { cells: [{ coords: [0, 0], source_id: 1, atlas_coords: [0, 0], alternative_tile: 0 }], size: { w: 1, h: 1 } };
  const paste = genTilemapPasteScript({ nodePath: "root/TM", targetCoords: { x: 10, y: 10 }, pattern });
  assert.match(paste, /JSON\.parse_string\(/);
  assert.match(paste, /var tx = 10/);

  const transform = genTilemapSetTransformScript({ nodePath: "root/TM", coords: { x: 1, y: 1 }, flipH: true, flipV: false, transpose: true });
  assert.match(transform, /new_alt = new_alt \| 1/);
  assert.match(transform, /new_alt = new_alt \| 4/);
  assert.match(transform, /node\.set_cell\(0, c, sid, ac, new_alt\)/);
});

test("spatial script generation", () => {
  const info = genSpatialInfoScript("root/Level");
  assert.match(info, /VisualInstance3D/);
  assert.match(info, /get_aabb\(\)/);
  assert.match(info, /node\.global_transform/);

  const create = genCreate3DScript({
    nodeType: "CharacterBody3D", nodeName: "Enemy", parentPath: "root",
    position: { x: 1, y: 0, z: 2 }, scale: { x: 2, y: 2, z: 2 },
    properties: { speed: 4.5, active: true, label: "grunt" },
  });
  assert.match(create, /var node = CharacterBody3D\.new\(\)/);
  assert.match(create, /node\.position = Vector3\(1, 0, 2\)/);
  assert.match(create, /node\.scale = Vector3\(2, 2, 2\)/);
  assert.match(create, /node\.speed = 4\.5/);
  assert.match(create, /node\.active = true/);
  assert.match(create, /node\.label = "grunt"/);
  assert.equal(TYPE_WHITELIST.length, 16);
});

test("profiler script generation", () => {
  const snapshot = genProfilerSnapshotScript();
  assert.match(snapshot, /Performance\.TIME_FPS/);
  assert.match(snapshot, /Performance\.MEMORY_STATIC/);
  assert.match(snapshot, /Performance\.RENDER_TOTAL_DRAW_CALLS_IN_FRAME/);
  assert.match(snapshot, /Performance\.PHYSICS_3D_ACTIVE_OBJECTS/);

  const sample = genProfilerSampleScript(120);
  assert.match(sample, /var _frame_count: int = 120/);
  assert.match(sample, /func _process\(_delta: float\):/);
  assert.match(sample, /Performance\.TIME_PROCESS/);
  assert.match(sample, /Performance\.TIME_PHYSICS_PROCESS/);
  assert.match(sample, /d\["p95_ms"\]/);

  const audit = genSignalAuditScript("root/Player");
  assert.match(audit, /get_signal_connection_list/);
  assert.match(audit, /_mcp_output\("signal_connections", _results\)/);
});

test("execution smoke test (skipped without Godot binary)", async (t) => {
  const godot = findGodotBin();
  if (!godot) {
    t.skip("Godot binary not found");
    return;
  }
  const project = makeProject();
  const result = await dispatch("profiler", { project_path: project, action: "snapshot", godot_path: godot }, makeCtx());
  assert.ok(result.content[0].text.length > 0);
});
