import { opsErrorResult, gdEscape, CLASS_NAME_RE } from "../util.js";
import { resolveGodotPath } from "../godot-process.js";
import { requireProjectPath } from "../path-utils.js";
import { executeGdscript, parseGdscriptResult } from "../gdscript.js";

const NON_PERSIST = "Runtime operation: affects only the current headless execution context and is not persisted to .tscn files. To persist changes, edit the scene files instead.";

export const TYPE_WHITELIST = [
  "Node3D", "MeshInstance3D", "StaticBody3D", "RigidBody3D",
  "CharacterBody3D", "Camera3D", "Light3D", "DirectionalLight3D",
  "OmniLight3D", "SpotLight3D", "CollisionShape3D", "RayCast3D",
  "Area3D", "Marker3D", "PathFollow3D", "VisibleOnScreenNotifier3D",
];

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

export function genSpatialInfoScript(nodePath) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\t_mcp_output("node_type", node.get_class())
\t_mcp_output("path", str(node.get_path()))
\tif node is Node3D:
\t\t_mcp_output("position", {"x": node.position.x, "y": node.position.y, "z": node.position.z})
\t\t_mcp_output("rotation", {"x": node.rotation.x, "y": node.rotation.y, "z": node.rotation.z})
\t\t_mcp_output("scale", {"x": node.scale.x, "y": node.scale.y, "z": node.scale.z})
\t\tvar gt = node.global_transform
\t\t_mcp_output("global_origin", {"x": gt.origin.x, "y": gt.origin.y, "z": gt.origin.z})
\telse:
\t\t_mcp_output("warning", "Node is not a Node3D (" + node.get_class() + ") - transform and bounds skipped")
\t\t_mcp_done()
\t\treturn
\tvar has_aabb = false
\tvar gmin = Vector3(INF, INF, INF)
\tvar gmax = Vector3(-INF, -INF, -INF)
\tvar stack = [node]
\twhile stack.size() > 0:
\t\tvar n = stack.pop_back()
\t\tif n is VisualInstance3D:
\t\t\tvar la = n.get_aabb()
\t\t\tvar xf = n.global_transform
\t\t\tfor ci in range(8):
\t\t\t\tvar corner = la.position + Vector3(float(ci & 1) * la.size.x, float((ci >> 1) & 1) * la.size.y, float((ci >> 2) & 1) * la.size.z)
\t\t\t\tvar wc = xf * corner
\t\t\t\tgmin = gmin.min(wc)
\t\t\t\tgmax = gmax.max(wc)
\t\t\thas_aabb = true
\t\tfor ch in n.get_children():
\t\t\tstack.append(ch)
\t_mcp_output("has_aabb", has_aabb)
\tif has_aabb:
\t\t_mcp_output("aabb_min", {"x": gmin.x, "y": gmin.y, "z": gmin.z})
\t\t_mcp_output("aabb_max", {"x": gmax.x, "y": gmax.y, "z": gmax.z})
\t\tvar sz = gmax - gmin
\t\t_mcp_output("aabb_size", {"x": sz.x, "y": sz.y, "z": sz.z})
\t_mcp_done()
`;
}

export function genCreate3DScript({ nodeType, nodeName, parentPath, position, rotation, scale, properties }) {
  const posLine = position ? `\n\tnode.position = Vector3(${position.x}, ${position.y}, ${position.z})` : "";
  const rotLine = rotation ? `\n\tnode.rotation = Vector3(${rotation.x}, ${rotation.y}, ${rotation.z})` : "";
  const scaleLine = scale ? `\n\tnode.scale = Vector3(${scale.x}, ${scale.y}, ${scale.z})` : "";
  let propsLines = "";
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      if (!CLASS_NAME_RE.test(key)) throw new Error(`Invalid property name: "${key}"`);
      if (value === null || value === undefined) propsLines += `\n\tnode.${key} = null`;
      else if (typeof value === "number") propsLines += `\n\tnode.${key} = ${value}`;
      else if (typeof value === "boolean") propsLines += `\n\tnode.${key} = ${value}`;
      else if (typeof value === "string") propsLines += `\n\tnode.${key} = "${gdEscape(value)}"`;
      else throw new Error(`Property "${key}" only supports basic types (string/number/bool/null)`);
    }
  }
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar parent = _mcp_get_node("${gdEscape(parentPath)}")
\tif parent == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(parentPath)}")
\t\t_mcp_done()
\t\treturn
\tvar node = ${nodeType}.new()
\tnode.name = "${gdEscape(nodeName)}"${posLine}${rotLine}${scaleLine}${propsLines}
\tparent.add_child(node)
\tnode.owner = parent.owner if parent.owner != null else parent
\t_mcp_output("created", {"type": "${gdEscape(nodeType)}", "name": "${gdEscape(nodeName)}", "path": str(node.get_path()) if node.is_inside_tree() else "${gdEscape(nodeName)}"})
\t_mcp_done()
`;
}

function cleanNodePath(value, fallback = "root") {
  const raw = value == null || String(value).trim() === "" ? fallback : String(value).trim();
  if (raw.includes("..")) return { error: `node path must not contain "..": ${raw}` };
  return { path: raw.replace(/^\/+/, "") || "root" };
}

function cleanVector3(v, label) {
  if (typeof v !== "object" || v === null) return { error: `${label} must be an object with x, y, z number fields` };
  for (const key of ["x", "y", "z"]) {
    if (typeof v[key] !== "number" || !Number.isFinite(v[key])) return { error: `${label} field "${key}" must be a finite number` };
  }
  return { vec: { x: v.x, y: v.y, z: v.z } };
}

const VEC3_SCHEMA = {
  type: "object",
  description: "Vector3 {x,y,z}",
  properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
  required: ["x", "y", "z"],
};

export const tools = [
  {
    name: "spatial_info",
    description: `Report spatial information for a node: type, transform (position/rotation/scale), global origin, and a merged world-space AABB computed from VisualInstance3D descendants. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "Node path (default root)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "node_create_3d",
    description: `Create a 3D node of a whitelisted type (${TYPE_WHITELIST.join(", ")}) under a parent node, with optional transform and basic-type properties. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        type: { type: "string", description: `Node type (whitelist: ${TYPE_WHITELIST.join(", ")})` },
        name: { type: "string", description: "Node name" },
        parent: { type: "string", description: "Parent node path (default root)" },
        transform: {
          type: "object",
          description: "Optional transform {position, rotation, scale}, each a Vector3 {x,y,z}",
          properties: { position: VEC3_SCHEMA, rotation: VEC3_SCHEMA, scale: VEC3_SCHEMA },
        },
        properties: { type: "object", description: "Custom properties (basic-type values only)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "type", "name"],
    },
  },
];

async function runTrusted(args, ctx, code) {
  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path ?? ctx?.godotPath);
  const result = await executeGdscript({ godotPath: godot, projectPath, code, timeout: 30, trusted: true });
  return parseGdscriptResult(result, {
    mapError: (msg) => (msg.includes("not found") ? "NODE_NOT_FOUND" : "SCRIPT_EXEC_FAILED"),
  });
}

export async function handle(toolName, args, ctx) {
  switch (toolName) {
    case "spatial_info": {
      const node = cleanNodePath(args.node_path);
      if (node.error) return opsErrorResult("INVALID_PATH", node.error);
      return runTrusted(args, ctx, genSpatialInfoScript(node.path));
    }

    case "node_create_3d": {
      const nodeType = typeof args.type === "string" ? args.type : "";
      if (!TYPE_WHITELIST.includes(nodeType)) {
        return opsErrorResult("INVALID_TYPE", `Node type "${nodeType}" not in whitelist. Allowed: ${TYPE_WHITELIST.join(", ")}`);
      }
      const nodeName = typeof args.name === "string" ? args.name : "";
      if (!CLASS_NAME_RE.test(nodeName) || nodeName.length > 64) {
        return opsErrorResult("INVALID_TYPE", `Node name "${nodeName}" is not a valid GDScript identifier (1-64 chars)`);
      }
      const parent = cleanNodePath(args.parent);
      if (parent.error) return opsErrorResult("INVALID_PATH", parent.error);
      const transform = args.transform != null ? args.transform : {};
      if (typeof transform !== "object") return opsErrorResult("INVALID_VECTOR", "transform must be an object with position/rotation/scale Vector3 fields");
      let position; let rotation; let scale;
      for (const [key, target] of [["position", "position"], ["rotation", "rotation"], ["scale", "scale"]]) {
        if (transform[key] !== undefined) {
          const v = cleanVector3(transform[key], `transform.${key}`);
          if (v.error) return opsErrorResult("INVALID_VECTOR", v.error);
          if (target === "position") position = v.vec;
          else if (target === "rotation") rotation = v.vec;
          else scale = v.vec;
        }
      }
      const properties = args.properties;
      if (properties !== undefined && (typeof properties !== "object" || properties === null || Array.isArray(properties))) {
        return opsErrorResult("INVALID_TYPE", "properties must be an object with basic-type values");
      }
      let code;
      try {
        code = genCreate3DScript({ nodeType, nodeName, parentPath: parent.path, position, rotation, scale, properties });
      } catch (err) {
        return opsErrorResult("INVALID_TYPE", err.message);
      }
      return runTrusted(args, ctx, code);
    }

    default:
      return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  }
}
