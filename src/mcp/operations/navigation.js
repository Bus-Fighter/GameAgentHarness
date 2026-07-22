import { opsErrorResult, gdEscape, normalizeNodePath, CLASS_NAME_RE } from "../util.js";
import { requireProjectPath } from "../path-utils.js";
import { resolveGodotPath } from "../godot-process.js";
import { executeGdscript, parseGdscriptResult, SCENE_TREE_HEADER } from "../gdscript.js";

const NON_PERSIST = " Runtime effect only: changes do NOT persist to .tscn files (edit the scene file to persist).";

const GD_LOAD_MAIN_SCENE = [
  "func _mcp_load_main_scene() -> void:",
  "\tvar _r: Node = _mcp_get_root()",
  "\tif _r == null:",
  "\t\treturn",
  "\tvar _sp: Variant = ProjectSettings.get_setting(\"application/run/main_scene\")",
  "\tif _sp != null and _sp != \"\":",
  "\t\tvar _sr = load(_sp)",
  "\t\tif _sr:",
  "\t\t\t_r.add_child(_sr.instantiate())",
].join("\n");

export const HEADER = SCENE_TREE_HEADER + "\n" + GD_LOAD_MAIN_SCENE + "\n";

export const ff = (n) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

export function validateVector3(v, label = "Vector3") {
  if (typeof v !== "object" || v === null) throw new Error(`${label} must be an object with x, y, z number fields`);
  for (const key of ["x", "y", "z"]) {
    if (typeof v[key] !== "number" || !Number.isFinite(v[key])) throw new Error(`${label} field "${key}" must be a finite number`);
  }
  return { x: v.x, y: v.y, z: v.z };
}

export function clampParam(val, min, max, name, warnings) {
  if (val === undefined) return undefined;
  if (typeof val !== "number" || !Number.isFinite(val)) return undefined;
  if (val < min) { warnings.push(`${name} ${val} clamped to ${min}`); return min; }
  if (val > max) { warnings.push(`${name} ${val} clamped to ${max}`); return max; }
  return val;
}

export function ensureNumber(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number, got: ${JSON.stringify(v)}`);
  return n;
}

export function genCreateRegionScript(nodeName, parentPath, position, bake) {
  const bakeBlock = bake ? "\n\t_nav.bake_navigation_mesh()" : "";
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar parent = _mcp_get_node("${gdEscape(parentPath)}")
\tif parent == null:
\t\t_mcp_output("error", "Parent node not found: ${gdEscape(parentPath)}")
\t\t_mcp_done()
\t\treturn
\tvar _nav = NavigationRegion3D.new()
\t_nav.name = "${gdEscape(nodeName)}"
\t_nav.position = Vector3(${ff(position.x)}, ${ff(position.y)}, ${ff(position.z)})
\tparent.add_child(_nav)
\tvar _root: Node = _mcp_get_root()
\tif _root != null:
\t\t_nav.set_owner(_root)
\tvar _mesh = NavigationMesh.new()
\t_nav.navigation_mesh = _mesh${bakeBlock}
\t_mcp_output("created", {"name": "${gdEscape(nodeName)}", "type": "NavigationRegion3D", "parent": "${gdEscape(parentPath)}", "baked": ${bake}})
\t_mcp_done()
`;
}

export function genBakeMeshScript(nodePath) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar _nav = _mcp_get_node("${gdEscape(nodePath)}")
\tif _nav == null:
\t\t_mcp_output("error", "NavigationRegion3D not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif not (_nav is NavigationRegion3D):
\t\t_mcp_output("error", "Node is not a NavigationRegion3D: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\t_nav.bake_navigation_mesh()
\tvar _bake_ok = _nav.navigation_mesh != null
\t_mcp_output("baked", {"node": "${gdEscape(nodePath)}", "success": _bake_ok})
\t_mcp_done()
`;
}

export function genCreateAgentScript(nodeName, parentPath, targetPosition, pathDesiredDistance, targetDesiredDistance, avoidanceEnabled) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar parent = _mcp_get_node("${gdEscape(parentPath)}")
\tif parent == null:
\t\t_mcp_output("error", "Parent node not found: ${gdEscape(parentPath)}")
\t\t_mcp_done()
\t\treturn
\tvar _agent = NavigationAgent3D.new()
\t_agent.name = "${gdEscape(nodeName)}"
\tparent.add_child(_agent)
\tvar _root: Node = _mcp_get_root()
\tif _root != null:
\t\t_agent.set_owner(_root)
\t_agent.target_position = Vector3(${ff(targetPosition.x)}, ${ff(targetPosition.y)}, ${ff(targetPosition.z)})
\t_agent.path_desired_distance = ${ff(pathDesiredDistance)}
\t_agent.target_desired_distance = ${ff(targetDesiredDistance)}
\t_agent.avoidance_enabled = ${avoidanceEnabled}
\t_mcp_output("created", {"name": "${gdEscape(nodeName)}", "type": "NavigationAgent3D", "parent": "${gdEscape(parentPath)}"})
\t_mcp_done()
`;
}

const NAV_PARAM_KEYS = [
  "path_desired_distance", "target_desired_distance", "radius", "height",
  "max_speed", "avoidance_enabled", "neighbor_distance", "max_neighbors",
  "time_horizon_agents", "time_horizon_obstacles",
];

export function genSetParamsScript(nodePath, params) {
  const paramLines = [];
  for (const key of NAV_PARAM_KEYS) {
    if (params[key] === undefined) continue;
    const v = params[key];
    paramLines.push(`\t_agent.${key} = ${typeof v === "boolean" ? v : ff(v)}`);
  }
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar _agent = _mcp_get_node("${gdEscape(nodePath)}")
\tif _agent == null:
\t\t_mcp_output("error", "NavigationAgent3D not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif not (_agent is NavigationAgent3D):
\t\t_mcp_output("error", "Node is not a NavigationAgent3D: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
${paramLines.join("\n")}
\t_mcp_output("updated", {"node": "${gdEscape(nodePath)}"})
\t_mcp_done()
`;
}

export function genCreateLinkScript(nodeName, parentPath, startPosition, endPosition, bidirectional) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar parent = _mcp_get_node("${gdEscape(parentPath)}")
\tif parent == null:
\t\t_mcp_output("error", "Parent node not found: ${gdEscape(parentPath)}")
\t\t_mcp_done()
\t\treturn
\tvar _link = NavigationLink3D.new()
\t_link.name = "${gdEscape(nodeName)}"
\tparent.add_child(_link)
\tvar _root: Node = _mcp_get_root()
\tif _root != null:
\t\t_link.set_owner(_root)
\t_link.start_position = Vector3(${ff(startPosition.x)}, ${ff(startPosition.y)}, ${ff(startPosition.z)})
\t_link.end_position = Vector3(${ff(endPosition.x)}, ${ff(endPosition.y)}, ${ff(endPosition.z)})
\t_link.bidirectional = ${bidirectional}
\t_mcp_output("created", {"name": "${gdEscape(nodeName)}", "type": "NavigationLink3D", "parent": "${gdEscape(parentPath)}", "bidirectional": ${bidirectional}})
\t_mcp_done()
`;
}

export function genNavQueryScript(startPos, endPos, navigationRegion) {
  let regionBlock;
  if (navigationRegion) {
    regionBlock = `\tvar region_node = _mcp_get_node("${gdEscape(navigationRegion)}")
\tif region_node and region_node is NavigationRegion3D:
\t\tmap_rid = NavigationServer3D.region_get_map(region_node.get_region_rid())
\telse:
\t\tvar maps = NavigationServer3D.get_maps()
\t\tif maps.is_empty():
\t\t\t_mcp_output("path", [])
\t\t\t_mcp_output("path_length", 0)
\t\t\t_mcp_output("warning", "No navigation data available")
\t\t\t_mcp_done()
\t\t\treturn
\t\tmap_rid = maps[0]`;
  } else {
    regionBlock = `\tvar maps = NavigationServer3D.get_maps()
\tif maps.is_empty():
\t\t_mcp_output("path", [])
\t\t_mcp_output("path_length", 0)
\t\t_mcp_output("warning", "No navigation data available")
\t\t_mcp_done()
\t\treturn
\tmap_rid = maps[0]`;
  }

  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar map_rid: RID
${regionBlock}
\tvar start = Vector3(${ff(startPos.x)}, ${ff(startPos.y)}, ${ff(startPos.z)})
\tvar end = Vector3(${ff(endPos.x)}, ${ff(endPos.y)}, ${ff(endPos.z)})
\tvar path = NavigationServer3D.map_get_path(map_rid, start, end, true)
\tvar path_data = []
\tfor p in path:
\t\tpath_data.append({"x": p.x, "y": p.y, "z": p.z})
\t_mcp_output("path", path_data)
\t_mcp_output("path_length", path_data.size())
\tif path_data.is_empty():
\t\t_mcp_output("warning", "No path found")
\t_mcp_done()
`;
}

const VEC3_SCHEMA = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
  required: ["x", "y", "z"],
};

export const tools = [
  {
    name: "nav_create_region",
    description: `Create a NavigationRegion3D node (optionally baking the nav mesh immediately) via headless Godot.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        name: { type: "string", description: "Node name for the new region" },
        parent: { type: "string", description: "Parent node path (default: root)", default: "root" },
        position: { ...VEC3_SCHEMA, description: "Region position {x,y,z} (default: origin)" },
        bake: { type: "boolean", description: "Bake the navigation mesh immediately (default: false)", default: false },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "name"],
    },
  },
  {
    name: "nav_bake_mesh",
    description: `Bake the navigation mesh of an existing NavigationRegion3D. May take a while for large geometry.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "NavigationRegion3D node path" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path"],
    },
  },
  {
    name: "nav_create_agent",
    description: `Create a NavigationAgent3D node with optional target and distance settings.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        name: { type: "string", description: "Node name for the new agent" },
        parent: { type: "string", description: "Parent node path (default: root)", default: "root" },
        target_position: { ...VEC3_SCHEMA, description: "Initial target position {x,y,z}" },
        path_desired_distance: { type: "number", description: "Path desired distance (default 0.5)" },
        target_desired_distance: { type: "number", description: "Target desired distance (default 1.0)" },
        avoidance_enabled: { type: "boolean", description: "Enable avoidance (default false)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "name"],
    },
  },
  {
    name: "nav_set_params",
    description: `Set parameters on an existing NavigationAgent3D (only provided fields are changed).${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "NavigationAgent3D node path" },
        params: {
          type: "object",
          description: "Navigation params to change",
          properties: {
            path_desired_distance: { type: "number" },
            target_desired_distance: { type: "number" },
            radius: { type: "number" },
            height: { type: "number" },
            max_speed: { type: "number" },
            avoidance_enabled: { type: "boolean" },
            neighbor_distance: { type: "number" },
            max_neighbors: { type: "integer" },
            time_horizon_agents: { type: "number" },
            time_horizon_obstacles: { type: "number" },
          },
        },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path", "params"],
    },
  },
  {
    name: "nav_create_link",
    description: `Create a NavigationLink3D between two positions (one-way or bidirectional).${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        name: { type: "string", description: "Node name for the new link" },
        parent: { type: "string", description: "Parent node path (default: root)", default: "root" },
        start_position: { ...VEC3_SCHEMA, description: "Link start position {x,y,z}" },
        end_position: { ...VEC3_SCHEMA, description: "Link end position {x,y,z}" },
        bidirectional: { type: "boolean", description: "Allow travel in both directions (default true)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "name", "start_position", "end_position"],
    },
  },
  {
    name: "nav_query_path",
    description: "Query a 3D navigation path between two positions via NavigationServer3D.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        start_pos: { ...VEC3_SCHEMA, description: "Start position {x,y,z}" },
        end_pos: { ...VEC3_SCHEMA, description: "End position {x,y,z}" },
        navigation_region: { type: "string", description: "Optional NavigationRegion3D node path to query against" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "start_pos", "end_pos"],
    },
  },
];

function validNodeName(name) {
  return typeof name === "string" && /^[A-Za-z0-9_]+$/.test(name);
}

async function runScript(script, args, ctx, { timeout = 30, mapError } = {}) {
  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
  const result = await executeGdscript({ godotPath: godot, projectPath, code: script, timeout, trusted: true });
  return parseGdscriptResult(result, {
    mapError: mapError ?? ((msg) => {
      if (msg.includes("not found")) return "NODE_NOT_FOUND";
      if (msg.includes("not a Navigation")) return "INVALID_PARAMS";
      if (msg.includes("bake")) return "BAKE_FAILED";
      return "SCRIPT_EXEC_FAILED";
    }),
  });
}

export async function handle(toolName, args, ctx) {
  try {
    switch (toolName) {
      case "nav_create_region": {
        if (!validNodeName(args.name)) {
          return opsErrorResult("INVALID_PARAMS", 'name must be a safe identifier (letters/digits/_ only, no "/")');
        }
        const parentPath = normalizeNodePath(args.parent || "root");
        const position = args.position ? validateVector3(args.position, "position") : { x: 0, y: 0, z: 0 };
        const bake = args.bake === true;
        return runScript(genCreateRegionScript(String(args.name), parentPath, position, bake), args, ctx, { timeout: bake ? 120 : 30 });
      }
      case "nav_bake_mesh": {
        const nodePath = normalizeNodePath(args.node_path);
        return runScript(genBakeMeshScript(nodePath), args, ctx, { timeout: 120 });
      }
      case "nav_create_agent": {
        if (!validNodeName(args.name)) {
          return opsErrorResult("INVALID_PARAMS", 'name must be a safe identifier (letters/digits/_ only, no "/")');
        }
        const parentPath = normalizeNodePath(args.parent || "root");
        const targetPosition = args.target_position ? validateVector3(args.target_position, "target_position") : { x: 0, y: 0, z: 0 };
        const pdd = typeof args.path_desired_distance === "number" ? args.path_desired_distance : 0.5;
        const tdd = typeof args.target_desired_distance === "number" ? args.target_desired_distance : 1.0;
        const avoidance = args.avoidance_enabled === true;
        return runScript(genCreateAgentScript(String(args.name), parentPath, targetPosition, pdd, tdd, avoidance), args, ctx);
      }
      case "nav_set_params": {
        const nodePath = normalizeNodePath(args.node_path);
        const rawParams = args.params;
        if (!rawParams || typeof rawParams !== "object" || Array.isArray(rawParams)) {
          return opsErrorResult("INVALID_PARAMS", "params must be a non-empty object");
        }
        const warnings = [];
        const filtered = {};
        for (const [key, value] of Object.entries(rawParams)) {
          if (!NAV_PARAM_KEYS.includes(key)) { warnings.push(`Unknown param "${key}" ignored`); continue; }
          if (key === "avoidance_enabled") {
            if (typeof value !== "boolean") { warnings.push(`Param "${key}" must be boolean, skipped`); continue; }
          } else if (key === "max_neighbors") {
            if (typeof value !== "number" || !Number.isInteger(value)) { warnings.push(`Param "${key}" must be an integer, skipped`); continue; }
          } else {
            if (typeof value !== "number" || !Number.isFinite(value)) { warnings.push(`Param "${key}" must be a finite number, skipped`); continue; }
            if (value < 0) { warnings.push(`Param "${key}" must be >= 0, got ${value}, skipped`); continue; }
          }
          filtered[key] = value;
        }
        if (Object.keys(filtered).length === 0) {
          return opsErrorResult("INVALID_PARAMS", "No valid params provided");
        }
        return runScript(genSetParamsScript(nodePath, filtered), args, ctx);
      }
      case "nav_create_link": {
        if (!validNodeName(args.name)) {
          return opsErrorResult("INVALID_PARAMS", 'name must be a safe identifier (letters/digits/_ only, no "/")');
        }
        const parentPath = normalizeNodePath(args.parent || "root");
        const startPosition = validateVector3(args.start_position, "start_position");
        const endPosition = validateVector3(args.end_position, "end_position");
        const bidirectional = args.bidirectional !== false;
        return runScript(genCreateLinkScript(String(args.name), parentPath, startPosition, endPosition, bidirectional), args, ctx);
      }
      case "nav_query_path": {
        const startPos = validateVector3(args.start_pos, "start_pos");
        const endPos = validateVector3(args.end_pos, "end_pos");
        const region = args.navigation_region ? normalizeNodePath(args.navigation_region) : undefined;
        return runScript(genNavQueryScript(startPos, endPos, region), args, ctx);
      }
      default:
        return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
    }
  } catch (err) {
    const msg = err.message;
    if (msg.includes("Vector3") || msg.includes("_pos") || msg.includes("position")) return opsErrorResult("INVALID_VECTOR", msg);
    if (msg.includes("project_path") || msg.includes("project.godot")) return opsErrorResult("INVALID_PATH", msg);
    return opsErrorResult("INVALID_PARAMS", msg);
  }
}
