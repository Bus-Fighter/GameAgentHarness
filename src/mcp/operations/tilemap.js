import { opsErrorResult, gdEscape } from "../util.js";
import { resolveGodotPath } from "../godot-process.js";
import { requireProjectPath } from "../path-utils.js";
import { executeGdscript, parseGdscriptResult } from "../gdscript.js";

const NON_PERSIST = "Runtime operation: affects only the current headless execution context and is not persisted to .tscn files. To persist changes, edit the scene files instead.";

const HEADER = [
  "extends SceneTree",
  "var _mcp_root: Node = null",
  "func _mcp_get_root() -> Node:",
  "\tif _mcp_root != null:",
  "\t\treturn _mcp_root",
  "\tif self.root != null:",
  "\t\t_mcp_root = self.root",
  "\t\treturn _mcp_root",
  "\treturn null",
  "func _mcp_get_node(path) -> Node:",
  "\tvar _p: String = str(path)",
  "\twhile _p.begins_with(\"/\"):",
  "\t\t_p = _p.substr(1)",
  "\tvar _r: Node = _mcp_get_root()",
  "\tif _r == null:",
  "\t\treturn null",
  "\tif _p == \"\" or _p == \"root\":",
  "\t\treturn _r",
  "\tvar _node: Node = _r.get_node_or_null(_p)",
  "\tif _node != null:",
  "\t\treturn _node",
  "\tvar _parts: PackedStringArray = _p.split(\"/\")",
  "\t_node = _r",
  "\tfor _part in _parts:",
  "\t\tif _part == \"\" or (_part == \"root\" and _node == _r):",
  "\t\t\tcontinue",
  "\t\tvar _next: Node = null",
  "\t\tfor _ch in _node.get_children():",
  "\t\t\tif _ch.name == _part:",
  "\t\t\t\t_next = _ch",
  "\t\t\t\tbreak",
  "\t\tif _next == null:",
  "\t\t\treturn null",
  "\t\t_node = _next",
  "\treturn _node",
  "func _mcp_load_main_scene() -> void:",
  "\tvar _r: Node = _mcp_get_root()",
  "\tif _r == null:",
  "\t\treturn",
  "\tvar _sp = ProjectSettings.get_setting(\"application/run/main_scene\")",
  "\tif _sp != null and _sp != \"\":",
  "\t\tvar _sr = load(_sp)",
  "\t\tif _sr:",
  "\t\t\t_r.add_child(_sr.instantiate())",
  "",
].join("\n");

function layerArg(layer) {
  return layer !== undefined ? `${layer}, ` : "0, ";
}

function nodePreamble(nodePath) {
  return `\tvar node = _mcp_get_node("${gdEscape(nodePath)}")\n\tif node == null:\n\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")\n\t\t_mcp_done()\n\t\treturn`;
}

function tilemapBranch(tileMapBody, layerBody, returnOnError = true) {
  const elseBlock = returnOnError
    ? '\t\t_mcp_output("error", "Not a TileMap or TileMapLayer: " + node.get_class())\n\t\t_mcp_done()\n\t\treturn'
    : '\t\t_mcp_output("error", "Not a TileMap or TileMapLayer: " + node.get_class())';
  const tmBody = tileMapBody.endsWith("\n") ? tileMapBody : tileMapBody + "\n";
  const lyBody = layerBody.endsWith("\n") ? layerBody : layerBody + "\n";
  return `\tif node.get_class() == "TileMap":\n${tmBody}\telif node.get_class() == "TileMapLayer":\n${lyBody}\telse:\n${elseBlock}`;
}

function tilemapCall(method, callArgs, layer) {
  const la = layerArg(layer);
  return tilemapBranch(`\t\tnode.${method}(${la}${callArgs})\n`, `\t\tnode.${method}(${callArgs})\n`, false);
}

export function genTilemapReadScript({ nodePath, region, layer }) {
  const la = layerArg(layer);
  if (region) {
    const readCellBody = (prefix) =>
      `\t\tvar cells = []\n\t\tfor cy in range(${region.y}, ${region.y + region.h}):\n\t\t\tfor cx in range(${region.x}, ${region.x + region.w}):\n\t\t\t\tvar sid = node.get_cell_source_id(${prefix}Vector2i(cx, cy))\n\t\t\t\tif sid >= 0:\n\t\t\t\t\tvar ac = node.get_cell_atlas_coords(${prefix}Vector2i(cx, cy))\n\t\t\t\t\tvar alt = node.get_cell_alternative_tile(${prefix}Vector2i(cx, cy))\n\t\t\t\t\tcells.append({"coords": [cx, cy], "source_id": sid, "atlas_coords": [ac.x, ac.y], "alternative_tile": alt})\n\t\t_mcp_output("cells", cells)`;
    return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${nodePreamble(nodePath)}
${tilemapBranch(readCellBody(la), readCellBody(""))}
\t_mcp_done()
`;
  }
  const readUsedBody = (prefix) =>
    `\t\tvar used = node.get_used_cells(${prefix.trim().replace(/,\s*$/, "")})\n\t\tvar cells = []\n\t\tfor c in used:\n\t\t\tvar sid = node.get_cell_source_id(${prefix}c)\n\t\t\tvar ac = node.get_cell_atlas_coords(${prefix}c)\n\t\t\tvar alt = node.get_cell_alternative_tile(${prefix}c)\n\t\t\tcells.append({"coords": [c.x, c.y], "source_id": sid, "atlas_coords": [ac.x, ac.y], "alternative_tile": alt})\n\t\t_mcp_output("cells", cells)`;
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${nodePreamble(nodePath)}
${tilemapBranch(readUsedBody(la), readUsedBody(""))}
\t_mcp_done()
`;
}

export function genTilemapSetCellScript({ nodePath, coords, sourceId, atlasCoords, alternativeTile, layer }) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${nodePreamble(nodePath)}
\tvar coords = Vector2i(${coords.x}, ${coords.y})
\tvar atlas = Vector2i(${atlasCoords.x}, ${atlasCoords.y})
${tilemapCall("set_cell", `coords, ${sourceId}, atlas, ${alternativeTile}`, layer)}
\t_mcp_output("set", {"coords": [${coords.x}, ${coords.y}], "source_id": ${sourceId}})
\t_mcp_done()
`;
}

export function genTilemapEraseCellScript({ nodePath, coords, layer }) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${nodePreamble(nodePath)}
\tvar coords = Vector2i(${coords.x}, ${coords.y})
${tilemapCall("erase_cell", "coords", layer)}
\t_mcp_output("erased", {"coords": [${coords.x}, ${coords.y}]})
\t_mcp_done()
`;
}

export function genTilemapFillRectScript({ nodePath, region, sourceId, atlasCoords, alternativeTile, layer }) {
  const la = layerArg(layer);
  const fillBody = (prefix) =>
    `\t\tfor cy in range(${region.h}):\n\t\t\tfor cx in range(${region.w}):\n\t\t\t\tnode.set_cell(${prefix}Vector2i(${region.x} + cx, ${region.y} + cy), ${sourceId}, atlas, ${alternativeTile})\n`;
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${nodePreamble(nodePath)}
\tvar atlas = Vector2i(${atlasCoords.x}, ${atlasCoords.y})
${tilemapBranch(fillBody(la), fillBody(""))}
\t_mcp_output("filled", {"region": {"x": ${region.x}, "y": ${region.y}, "w": ${region.w}, "h": ${region.h}}, "source_id": ${sourceId}})
\t_mcp_done()
`;
}

export function genTilemapClearScript({ nodePath, layer, clearAll }) {
  const tileMapClear = clearAll ? "\t\tnode.clear()" : `\t\tnode.clear_layer(${layer ?? 0})`;
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${nodePreamble(nodePath)}
${tilemapBranch(`${tileMapClear}\n`, "\t\tnode.clear()\n")}
\t_mcp_output("cleared", {"node": "${gdEscape(nodePath)}"})
\t_mcp_done()
`;
}

export function genTilemapCopyScript({ nodePath, sourceRegion, layer }) {
  const la = layerArg(layer);
  const copyBody = (prefix) =>
    `\t\tfor cy in range(${sourceRegion.h}):\n\t\t\tfor cx in range(${sourceRegion.w}):\n\t\t\t\tvar c = Vector2i(${sourceRegion.x} + cx, ${sourceRegion.y} + cy)\n\t\t\t\tvar sid = node.get_cell_source_id(${prefix}c)\n\t\t\t\tif sid >= 0:\n\t\t\t\t\tvar ac = node.get_cell_atlas_coords(${prefix}c)\n\t\t\t\t\tvar alt = node.get_cell_alternative_tile(${prefix}c)\n\t\t\t\t\tcells.append({"coords": [cx, cy], "source_id": sid, "atlas_coords": [ac.x, ac.y], "alternative_tile": alt})\n`;
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${nodePreamble(nodePath)}
\tvar cells = []
${tilemapBranch(copyBody(la), copyBody(""))}
\t_mcp_output("pattern", {"cells": cells, "size": {"w": ${sourceRegion.w}, "h": ${sourceRegion.h}}})
\t_mcp_done()
`;
}

export function genTilemapPasteScript({ nodePath, targetCoords, pattern, layer }) {
  const patternJson = JSON.stringify(pattern);
  const la = layerArg(layer);
  const pasteBody = (prefix) =>
    `\t\tfor cell in pattern["cells"]:\n\t\t\tvar cx = cell["coords"][0] + tx\n\t\t\tvar cy = cell["coords"][1] + ty\n\t\t\tnode.set_cell(${prefix}Vector2i(cx, cy), cell["source_id"], Vector2i(cell["atlas_coords"][0], cell["atlas_coords"][1]), cell["alternative_tile"])\n`;
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${nodePreamble(nodePath)}
\tvar pattern = JSON.parse_string("${gdEscape(patternJson)}")
\tvar tx = ${targetCoords.x}
\tvar ty = ${targetCoords.y}
${tilemapBranch(pasteBody(la), pasteBody(""))}
\t_mcp_output("pasted", {"target": [tx, ty], "cell_count": pattern["cells"].size()})
\t_mcp_done()
`;
}

export function genTilemapSetTransformScript({ nodePath, coords, flipH, flipV, transpose, layer }) {
  const la = layerArg(layer);
  const readTileBody = (prefix) =>
    `\t\tsid = node.get_cell_source_id(${prefix}c)\n\t\tif sid < 0:\n\t\t\t_mcp_output("error", "No tile at coords")\n\t\t\t_mcp_done()\n\t\t\treturn\n\t\tac = node.get_cell_atlas_coords(${prefix}c)\n\t\talt = node.get_cell_alternative_tile(${prefix}c)\n`;
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${nodePreamble(nodePath)}
\tvar c = Vector2i(${coords.x}, ${coords.y})
\tvar sid: int = -1
\tvar ac: Vector2i = Vector2i(0, 0)
\tvar alt: int = 0
${tilemapBranch(readTileBody(la), readTileBody(""))}
\tvar base_alt = alt & ~7
\tvar new_alt = base_alt
\tif ${flipH}:
\t\tnew_alt = new_alt | 1
\tif ${flipV}:
\t\tnew_alt = new_alt | 2
\tif ${transpose}:
\t\tnew_alt = new_alt | 4
${tilemapCall("set_cell", "c, sid, ac, new_alt", layer)}
\t_mcp_output("transform_set", {"coords": [${coords.x}, ${coords.y}], "flip_h": ${flipH}, "flip_v": ${flipV}, "transpose": ${transpose}, "alternative_tile": new_alt})
\t_mcp_done()
`;
}

function cleanNodePath(value, fallback = "root") {
  const raw = value == null || String(value).trim() === "" ? fallback : String(value).trim();
  if (raw.includes("..")) return { error: `node path must not contain "..": ${raw}` };
  return { path: raw.replace(/^\/+/, "") || "root" };
}

function cleanCoords(v, label = "coords") {
  if (typeof v !== "object" || v === null) return { error: `${label} must be an object with x, y integer fields` };
  for (const key of ["x", "y"]) {
    if (typeof v[key] !== "number" || !Number.isInteger(v[key])) return { error: `${label} field "${key}" must be an integer` };
  }
  return { coords: { x: v.x, y: v.y } };
}

function cleanRect(v, label = "region") {
  if (typeof v !== "object" || v === null) return { error: `${label} must be an object with x, y, w, h integer fields` };
  for (const key of ["x", "y", "w", "h"]) {
    if (typeof v[key] !== "number" || !Number.isInteger(v[key])) return { error: `${label} field "${key}" must be an integer` };
  }
  if (v.w <= 0) return { error: `${label} w must be > 0` };
  if (v.h <= 0) return { error: `${label} h must be > 0` };
  return { rect: { x: v.x, y: v.y, w: v.w, h: v.h } };
}

function cleanLayer(value) {
  if (value === undefined) return { layer: undefined };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return { error: "layer must be a non-negative integer" };
  return { layer: n };
}

function cleanSourceId(value) {
  const n = Number(value);
  if (!Number.isInteger(n)) return { error: "source_id must be an integer" };
  return { sourceId: n };
}

function cleanAlternativeTile(value) {
  if (value === undefined) return { alt: 0 };
  const n = Number(value);
  if (!Number.isInteger(n)) return { error: "alternative_tile must be an integer" };
  return { alt: n };
}

const RECT2I_SCHEMA = {
  type: "object",
  description: "Rect2i {x, y, w, h}; w and h must be > 0",
  properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
  required: ["x", "y", "w", "h"],
};

const COORDS_SCHEMA = {
  type: "object",
  description: "Vector2i {x, y}",
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
};

const COMMON_PROPS = {
  project_path: { type: "string", description: "Path to the Godot project directory" },
  node_path: { type: "string", description: "TileMap/TileMapLayer node path (e.g. root/Level/TileMap)" },
  layer: { type: "number", description: "Layer index (optional, default 0). tilemap_clear: omit to clear all layers" },
  godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
};

export const tools = [
  {
    name: "tilemap_read",
    description: `Read cells from a TileMap or TileMapLayer node, either within a region or all used cells. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: { ...COMMON_PROPS, region: { ...RECT2I_SCHEMA, description: "Region to read (optional; omit to read all used cells)" } },
      required: ["project_path", "node_path"],
    },
  },
  {
    name: "tilemap_set_cell",
    description: `Set a single cell on a TileMap or TileMapLayer node. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        ...COMMON_PROPS,
        coords: COORDS_SCHEMA,
        source_id: { type: "number", description: "TileSet source ID" },
        atlas_coords: COORDS_SCHEMA,
        alternative_tile: { type: "number", description: "Alternative tile index (default 0)" },
      },
      required: ["project_path", "node_path", "coords", "source_id", "atlas_coords"],
    },
  },
  {
    name: "tilemap_erase_cell",
    description: `Erase a single cell on a TileMap or TileMapLayer node. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: { ...COMMON_PROPS, coords: COORDS_SCHEMA },
      required: ["project_path", "node_path", "coords"],
    },
  },
  {
    name: "tilemap_fill_rect",
    description: `Fill a rectangular region of a TileMap or TileMapLayer with a single tile. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        ...COMMON_PROPS,
        region: RECT2I_SCHEMA,
        source_id: { type: "number", description: "TileSet source ID" },
        atlas_coords: COORDS_SCHEMA,
        alternative_tile: { type: "number", description: "Alternative tile index (default 0)" },
      },
      required: ["project_path", "node_path", "region", "source_id", "atlas_coords"],
    },
  },
  {
    name: "tilemap_clear",
    description: `Clear a TileMap or TileMapLayer node: one layer when layer is given, all layers otherwise. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: { ...COMMON_PROPS },
      required: ["project_path", "node_path"],
    },
  },
  {
    name: "tilemap_copy",
    description: `Copy a rectangular region of tiles into a portable pattern object (use with tilemap_paste). ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: { ...COMMON_PROPS, source_region: RECT2I_SCHEMA },
      required: ["project_path", "node_path", "source_region"],
    },
  },
  {
    name: "tilemap_paste",
    description: `Paste a pattern previously produced by tilemap_copy onto a TileMap or TileMapLayer at a target coordinate. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        ...COMMON_PROPS,
        target: { ...COORDS_SCHEMA, description: "Target top-left coordinate" },
        pattern: { type: "object", description: "Pattern object returned by tilemap_copy ({cells, size})" },
      },
      required: ["project_path", "node_path", "target", "pattern"],
    },
  },
  {
    name: "tilemap_set_transform",
    description: `Set flip_h / flip_v / transpose transform bits on an existing cell's alternative tile. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        ...COMMON_PROPS,
        coords: COORDS_SCHEMA,
        flip_h: { type: "boolean", description: "Flip horizontally (default false)" },
        flip_v: { type: "boolean", description: "Flip vertically (default false)" },
        transpose: { type: "boolean", description: "Transpose (default false)" },
      },
      required: ["project_path", "node_path", "coords"],
    },
  },
];

async function runTrusted(args, ctx, code) {
  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path ?? ctx?.godotPath);
  const result = await executeGdscript({ godotPath: godot, projectPath, code, timeout: 30, trusted: true });
  return parseGdscriptResult(result, {
    mapError: (msg) => (msg.includes("Node not found") ? "TILEMAP_NOT_FOUND" : "SCRIPT_EXEC_FAILED"),
  });
}

function nodePathOrError(args) {
  const node = cleanNodePath(args.node_path, "");
  if (node.error) return { error: opsErrorResult("INVALID_PATH", node.error) };
  if (!args.node_path) return { error: opsErrorResult("INVALID_PATH", "node_path is required") };
  return { path: node.path };
}

export async function handle(toolName, args, ctx) {
  switch (toolName) {
    case "tilemap_read": {
      const node = nodePathOrError(args);
      if (node.error) return node.error;
      const layer = cleanLayer(args.layer);
      if (layer.error) return opsErrorResult("INVALID_TILE_COORDS", layer.error);
      let region;
      if (args.region !== undefined) {
        const r = cleanRect(args.region);
        if (r.error) return opsErrorResult("INVALID_REGION", r.error);
        region = r.rect;
      }
      return runTrusted(args, ctx, genTilemapReadScript({ nodePath: node.path, region, layer: layer.layer }));
    }

    case "tilemap_set_cell": {
      const node = nodePathOrError(args);
      if (node.error) return node.error;
      const coords = cleanCoords(args.coords);
      if (coords.error) return opsErrorResult("INVALID_TILE_COORDS", coords.error);
      const source = cleanSourceId(args.source_id);
      if (source.error) return opsErrorResult("INVALID_TILE_COORDS", source.error);
      const atlas = cleanCoords(args.atlas_coords, "atlas_coords");
      if (atlas.error) return opsErrorResult("INVALID_TILE_COORDS", atlas.error);
      const alt = cleanAlternativeTile(args.alternative_tile);
      if (alt.error) return opsErrorResult("INVALID_TILE_COORDS", alt.error);
      const layer = cleanLayer(args.layer);
      if (layer.error) return opsErrorResult("INVALID_TILE_COORDS", layer.error);
      return runTrusted(args, ctx, genTilemapSetCellScript({ nodePath: node.path, coords: coords.coords, sourceId: source.sourceId, atlasCoords: atlas.coords, alternativeTile: alt.alt, layer: layer.layer }));
    }

    case "tilemap_erase_cell": {
      const node = nodePathOrError(args);
      if (node.error) return node.error;
      const coords = cleanCoords(args.coords);
      if (coords.error) return opsErrorResult("INVALID_TILE_COORDS", coords.error);
      const layer = cleanLayer(args.layer);
      if (layer.error) return opsErrorResult("INVALID_TILE_COORDS", layer.error);
      return runTrusted(args, ctx, genTilemapEraseCellScript({ nodePath: node.path, coords: coords.coords, layer: layer.layer }));
    }

    case "tilemap_fill_rect": {
      const node = nodePathOrError(args);
      if (node.error) return node.error;
      const region = cleanRect(args.region);
      if (region.error) return opsErrorResult("INVALID_REGION", region.error);
      const source = cleanSourceId(args.source_id);
      if (source.error) return opsErrorResult("INVALID_TILE_COORDS", source.error);
      const atlas = cleanCoords(args.atlas_coords, "atlas_coords");
      if (atlas.error) return opsErrorResult("INVALID_TILE_COORDS", atlas.error);
      const alt = cleanAlternativeTile(args.alternative_tile);
      if (alt.error) return opsErrorResult("INVALID_TILE_COORDS", alt.error);
      const layer = cleanLayer(args.layer);
      if (layer.error) return opsErrorResult("INVALID_TILE_COORDS", layer.error);
      return runTrusted(args, ctx, genTilemapFillRectScript({ nodePath: node.path, region: region.rect, sourceId: source.sourceId, atlasCoords: atlas.coords, alternativeTile: alt.alt, layer: layer.layer }));
    }

    case "tilemap_clear": {
      const node = nodePathOrError(args);
      if (node.error) return node.error;
      const layer = cleanLayer(args.layer);
      if (layer.error) return opsErrorResult("INVALID_TILE_COORDS", layer.error);
      return runTrusted(args, ctx, genTilemapClearScript({ nodePath: node.path, layer: layer.layer, clearAll: layer.layer === undefined }));
    }

    case "tilemap_copy": {
      const node = nodePathOrError(args);
      if (node.error) return node.error;
      const region = cleanRect(args.source_region, "source_region");
      if (region.error) return opsErrorResult("INVALID_REGION", region.error);
      const layer = cleanLayer(args.layer);
      if (layer.error) return opsErrorResult("INVALID_TILE_COORDS", layer.error);
      return runTrusted(args, ctx, genTilemapCopyScript({ nodePath: node.path, sourceRegion: region.rect, layer: layer.layer }));
    }

    case "tilemap_paste": {
      const node = nodePathOrError(args);
      if (node.error) return node.error;
      const target = cleanCoords(args.target, "target");
      if (target.error) return opsErrorResult("INVALID_TILE_COORDS", target.error);
      const pattern = args.pattern;
      if (!pattern || typeof pattern !== "object" || !Array.isArray(pattern.cells)) {
        return opsErrorResult("INVALID_REGION", "pattern must be an object with a cells array (from tilemap_copy)");
      }
      const layer = cleanLayer(args.layer);
      if (layer.error) return opsErrorResult("INVALID_TILE_COORDS", layer.error);
      return runTrusted(args, ctx, genTilemapPasteScript({ nodePath: node.path, targetCoords: target.coords, pattern, layer: layer.layer }));
    }

    case "tilemap_set_transform": {
      const node = nodePathOrError(args);
      if (node.error) return node.error;
      const coords = cleanCoords(args.coords);
      if (coords.error) return opsErrorResult("INVALID_TILE_COORDS", coords.error);
      const layer = cleanLayer(args.layer);
      if (layer.error) return opsErrorResult("INVALID_TILE_COORDS", layer.error);
      return runTrusted(args, ctx, genTilemapSetTransformScript({
        nodePath: node.path, coords: coords.coords,
        flipH: args.flip_h === true, flipV: args.flip_v === true, transpose: args.transpose === true,
        layer: layer.layer,
      }));
    }

    default:
      return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  }
}
