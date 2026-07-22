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

export function genRaycastScript({ from, to, collisionMask, excludePaths }) {
  let maskLine = "";
  if (collisionMask !== undefined) maskLine = `\n\tquery.collision_mask = ${collisionMask}`;
  let excludeBlock = "";
  if (excludePaths && excludePaths.length > 0) {
    const pathsStr = excludePaths.map((p) => `"${gdEscape(p)}"`).join(", ");
    excludeBlock = `
\tvar exclude_bodies = []
\tfor ep in [${pathsStr}]:
\t\tvar n = _mcp_get_node(ep)
\t\tif n:
\t\t\texclude_bodies.append(n.get_rid())
\tquery.exclude = exclude_bodies`;
  }
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar _world = root.get_world_3d()
\tif _world == null:
\t\t_mcp_output("error", "No World3D available (scene may not have 3D content)")
\t\t_mcp_done()
\t\treturn
\tvar space_state = _world.direct_space_state
\tvar query = PhysicsRayQueryParameters3D.create(Vector3(${from.x}, ${from.y}, ${from.z}), Vector3(${to.x}, ${to.y}, ${to.z}))${maskLine}${excludeBlock}
\tvar result = space_state.intersect_ray(query)
\tif result.is_empty():
\t\t_mcp_output("hit", false)
\telse:
\t\t_mcp_output("hit", true)
\t\t_mcp_output("position", {"x": result["position"].x, "y": result["position"].y, "z": result["position"].z})
\t\t_mcp_output("normal", {"x": result["normal"].x, "y": result["normal"].y, "z": result["normal"].z})
\t\t_mcp_output("collider", str(result["collider"]))
\t\t_mcp_output("rid", str(result["rid"]))
\t_mcp_done()
`;
}

export function genBodyInfoScript(bodyPath) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar body = _mcp_get_node("${gdEscape(bodyPath)}")
\tif body == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(bodyPath)}")
\t\t_mcp_done()
\t\treturn
\tvar shapes = []
\tfor child in body.get_children():
\t\tif child is CollisionShape3D:
\t\t\tvar shape_res = child.shape
\t\t\tvar info = {}
\t\t\tif shape_res:
\t\t\t\tinfo["shape_type"] = shape_res.get_class()
\t\t\t\tvar aabb = shape_res.get_debug_mesh().get_aabb()
\t\t\t\tinfo["aabb_size"] = {"x": aabb.size.x, "y": aabb.size.y, "z": aabb.size.z}
\t\t\telse:
\t\t\t\tinfo["shape_type"] = "None"
\t\t\tinfo["disabled"] = child.disabled
\t\t\tshapes.append(info)
\tif shapes.is_empty():
\t\t_mcp_output("has_collision", false)
\telse:
\t\t_mcp_output("has_collision", true)
\t\t_mcp_output("shapes", shapes)
\t_mcp_output("collision_layer", body.collision_layer)
\t_mcp_output("collision_mask", body.collision_mask)
\t_mcp_done()
`;
}

export function genDiagnosePhysicsScript(bodyPath) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar body = _mcp_get_node("${gdEscape(bodyPath)}")
\tif body == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(bodyPath)}")
\t\t_mcp_done()
\t\treturn
\t_mcp_output("node_type", body.get_class())
\tif not body is Node3D:
\t\t_mcp_output("error", "Node is not a Node3D: " + body.get_class())
\t\t_mcp_done()
\t\treturn
\t_mcp_output("position", {"x": body.position.x, "y": body.position.y, "z": body.position.z})
\tif body is PhysicsBody3D:
\t\t_mcp_output("collision_layer", body.collision_layer)
\t\t_mcp_output("collision_mask", body.collision_mask)
\t\tvar vel = Vector3.ZERO
\t\tif body is CharacterBody3D:
\t\t\tvel = body.velocity
\t\telif body is RigidBody3D:
\t\t\tvel = body.linear_velocity
\t\t_mcp_output("velocity", {"x": vel.x, "y": vel.y, "z": vel.z})
\t\t_mcp_output("horizontal_speed", Vector2(vel.x, vel.z).length())
\telse:
\t\t_mcp_output("warning", "Node is not a PhysicsBody3D (" + body.get_class() + ") - velocity and collision diagnostics skipped")
\tvar shapes = []
\tvar has_concave = false
\tfor child in body.get_children():
\t\tif child is CollisionShape3D:
\t\t\tvar shape_res = child.shape
\t\t\tvar info = {}
\t\t\tif shape_res:
\t\t\t\tinfo["shape_type"] = shape_res.get_class()
\t\t\t\tinfo["disabled"] = child.disabled
\t\t\t\tif shape_res is ConcavePolygonShape3D:
\t\t\t\t\thas_concave = true
\t\t\t\tvar aabb = shape_res.get_debug_mesh().get_aabb()
\t\t\t\tinfo["aabb_size"] = {"x": aabb.size.x, "y": aabb.size.y, "z": aabb.size.z}
\t\t\telse:
\t\t\t\tinfo["shape_type"] = "None"
\t\t\t\tinfo["disabled"] = child.disabled
\t\t\tshapes.append(info)
\t_mcp_output("shapes", shapes)
\tif has_concave:
\t\t_mcp_output("warning", "ConcavePolygonShape3D detected - may cause ball trapping at internal faces. Consider using convex shapes (BoxShape3D, SphereShape3D) instead.")
\tvar collision = null
\tif body is PhysicsBody3D:
\t\tcollision = body.move_and_collide(Vector3.ZERO, true, 0.001, true)
\tif collision:
\t\tvar contacts = []
\t\tfor i in range(collision.get_collision_count()):
\t\t\tvar pos = collision.get_position(i)
\t\t\tvar norm = collision.get_normal(i)
\t\t\tcontacts.append({"position": {"x": pos.x, "y": pos.y, "z": pos.z}, "normal": {"x": norm.x, "y": norm.y, "z": norm.z}})
\t\t_mcp_output("contacts", contacts)
\t\tvar coll = collision.get_collider()
\t\tif coll:
\t\t\t_mcp_output("colliding_with", str(coll.get_path()) if coll is Node else str(coll))
\t\t\tvar collider_shapes = []
\t\t\tfor ch in coll.get_children():
\t\t\t\tif ch is CollisionShape3D and ch.shape:
\t\t\t\t\tvar sinfo = {"shape_type": ch.shape.get_class(), "disabled": ch.disabled}
\t\t\t\t\tif ch.shape is ConcavePolygonShape3D:
\t\t\t\t\t\tsinfo["warning"] = "ConcavePolygonShape3D - internal faces may trap small bodies"
\t\t\t\t\tcollider_shapes.append(sinfo)
\t\t\tif not collider_shapes.is_empty():
\t\t\t\t_mcp_output("collider_shapes", collider_shapes)
\t\t\t\tif collider_shapes.size() > 50:
\t\t\t\t\t_mcp_output("warning", "Collider has " + str(collider_shapes.size()) + " shapes - consider merging for performance")
\telse:
\t\t_mcp_output("contacts", [])
\t_mcp_done()
`;
}

export function genQuerySpatialScript({ center, radius, collisionMask }) {
  let maskLine = "";
  if (collisionMask !== undefined) maskLine = `\n\tquery.collision_mask = ${collisionMask}`;
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar world = root.get_world_3d()
\tif world == null:
\t\t_mcp_output("error", "No World3D available (scene may not be loaded)")
\t\t_mcp_done()
\t\treturn
\tvar space_state = world.direct_space_state
\tif space_state == null:
\t\t_mcp_output("error", "Physics space state not available (PhysicsServer may not be initialized in headless mode)")
\t\t_mcp_done()
\t\treturn
\tvar center_v = Vector3(${center.x}, ${center.y}, ${center.z})
\tvar sphere = SphereShape3D.new()
\tsphere.radius = ${radius}
\tvar query = PhysicsShapeQueryParameters3D.new()
\tquery.shape = sphere
\tquery.transform = Transform3D(Basis(), center_v)
\tquery.collide_with_areas = false
\tquery.collide_with_bodies = true${maskLine}
\tvar results = space_state.intersect_shape(query)
\tvar bodies = []
\tfor r in results:
\t\tvar collider = r["collider"]
\t\tif not (collider is Node):
\t\t\tcontinue
\t\tvar dist = center_v.distance_to(collider.global_position)
\t\tvar entry = {"path": str(collider.get_path()), "type": collider.get_class(), "distance": dist}
\t\tvar collider_shapes = []
\t\tfor ch in collider.get_children():
\t\t\tif ch is CollisionShape3D and ch.shape:
\t\t\t\tcollider_shapes.append({"shape_type": ch.shape.get_class(), "disabled": ch.disabled})
\t\tif not collider_shapes.is_empty():
\t\t\tentry["shapes"] = collider_shapes
\t\tbodies.append(entry)
\tbodies.sort_custom(func(a, b): return a["distance"] < b["distance"])
\t_mcp_output("center", {"x": ${center.x}, "y": ${center.y}, "z": ${center.z}})
\t_mcp_output("radius", ${radius})
\t_mcp_output("count", bodies.size())
\t_mcp_output("bodies", bodies)
\t_mcp_done()
`;
}

export function genCollisionOverlayScript({ parentPath, colorOverride }) {
  const colorInit = colorOverride ? `var base_color = Color(${colorOverride})` : "var base_color = null";
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar parent = _mcp_get_node("${gdEscape(parentPath)}")
\tif parent == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(parentPath)}")
\t\t_mcp_done()
\t\treturn
\t${colorInit}
\tvar existing_overlay = parent.get_node_or_null("_MCP_CollisionOverlay")
\tif existing_overlay:
\t\tparent.remove_child(existing_overlay)
\t\texisting_overlay.queue_free()
\tvar overlay_parent = Node3D.new()
\toverlay_parent.name = "_MCP_CollisionOverlay"
\tparent.add_child(overlay_parent)
\tvar overlays = []
\tvar _collect_fn: Callable
\t_collect_fn = func(node: Node):
\t\tif node is CollisionShape3D and node.shape:
\t\t\tvar phys_parent = node.get_parent()
\t\t\tvar color: Color
\t\t\tif base_color != null:
\t\t\t\tcolor = base_color
\t\t\telif phys_parent is StaticBody3D:
\t\t\t\tcolor = Color(0.3, 0.5, 1.0, 0.5)
\t\t\telif phys_parent is CharacterBody3D:
\t\t\t\tcolor = Color(0.2, 0.9, 0.3, 0.5)
\t\t\telif phys_parent is RigidBody3D:
\t\t\t\tcolor = Color(1.0, 0.3, 0.3, 0.5)
\t\t\telif phys_parent is Area3D:
\t\t\t\tcolor = Color(1.0, 0.9, 0.2, 0.5)
\t\t\telse:
\t\t\t\tcolor = Color(1.0, 1.0, 1.0, 0.5)
\t\t\tvar debug_mesh = node.shape.get_debug_mesh()
\t\t\tvar mesh_inst = MeshInstance3D.new()
\t\t\tmesh_inst.mesh = debug_mesh
\t\t\tvar mat = StandardMaterial3D.new()
\t\t\tmat.albedo_color = color
\t\t\tmat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
\t\t\tmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
\t\t\tmesh_inst.material_override = mat
\t\t\tmesh_inst.global_transform = node.global_transform
\t\t\toverlay_parent.add_child(mesh_inst)
\t\t\tvar parent_type = phys_parent.get_class() if phys_parent else "Unknown"
\t\t\toverlays.append({"path": str(node.get_path()), "shape": node.shape.get_class(), "color": {"r": color.r, "g": color.g, "b": color.b, "a": color.a}, "parent_type": parent_type})
\t\tfor child in node.get_children():
\t\t\t_collect_fn.call(child)
\t_collect_fn.call(parent)
\t_mcp_output("overlay_count", overlays.size())
\t_mcp_output("overlays", overlays)
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
    if (typeof v[key] !== "number" || !Number.isFinite(v[key])) {
      return { error: `${label} field "${key}" must be a finite number` };
    }
  }
  return { vec: { x: v.x, y: v.y, z: v.z } };
}

function cleanMask(value) {
  if (value === undefined) return { mask: undefined };
  const n = Number(value);
  if (!Number.isFinite(n)) return { error: "collision_mask must be a number" };
  return { mask: Math.trunc(n) };
}

const VEC3_SCHEMA = {
  type: "object",
  description: "Vector3 {x,y,z}",
  properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
  required: ["x", "y", "z"],
};

export const tools = [
  {
    name: "physics_raycast",
    description: `Cast a 3D ray in the running scene's physics space and report hit position, normal and collider. Supports optional collision mask and node exclusion list. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        from: { ...VEC3_SCHEMA, description: "Ray origin {x,y,z}" },
        to: { ...VEC3_SCHEMA, description: "Ray end {x,y,z}" },
        collision_mask: { type: "number", description: "Optional collision mask" },
        exclude_paths: { type: "array", description: "Optional node paths to exclude", items: { type: "string" } },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "from", "to"],
    },
  },
  {
    name: "physics_body_info",
    description: `Report collision layer/mask and CollisionShape3D details (shape type, AABB size, disabled) for a physics body node. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "Physics body node path" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path"],
    },
  },
  {
    name: "diagnose_physics",
    description: `Physics diagnostics for a body node: velocity, contacts via move_and_collide probe, collision shapes, and ConcavePolygonShape3D warnings. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "Body node path to diagnose" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path"],
    },
  },
  {
    name: "query_spatial",
    description: `Query physics bodies within a sphere around an origin point, sorted by distance, with per-collider shape details. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        origin: { ...VEC3_SCHEMA, description: "Query center {x,y,z}" },
        radius: { type: "number", description: "Query radius (default 10.0)", default: 10.0 },
        collision_mask: { type: "number", description: "Optional collision mask" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "origin"],
    },
  },
  {
    name: "collision_overlay",
    description: `Spawn a temporary debug overlay visualizing every CollisionShape3D under a node, color-coded by body type (StaticBody3D blue, CharacterBody3D green, RigidBody3D red, Area3D yellow) or a uniform override color. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "Parent node path to overlay (default root)" },
        color_override: { type: "string", description: "Uniform color as 3-4 comma-separated numbers, e.g. \"1,0,0,0.5\"" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path"],
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
    case "physics_raycast": {
      const from = cleanVector3(args.from, "from");
      if (from.error) return opsErrorResult("INVALID_VECTOR", from.error);
      const to = cleanVector3(args.to, "to");
      if (to.error) return opsErrorResult("INVALID_VECTOR", to.error);
      const mask = cleanMask(args.collision_mask);
      if (mask.error) return opsErrorResult("INVALID_VECTOR", mask.error);
      let excludePaths;
      if (args.exclude_paths !== undefined) {
        if (!Array.isArray(args.exclude_paths)) return opsErrorResult("INVALID_PATH", "exclude_paths must be an array of node paths");
        excludePaths = [];
        for (const p of args.exclude_paths) {
          const cleaned = cleanNodePath(p, "");
          if (cleaned.error) return opsErrorResult("INVALID_PATH", cleaned.error);
          excludePaths.push(cleaned.path);
        }
      }
      const code = genRaycastScript({ from: from.vec, to: to.vec, collisionMask: mask.mask, excludePaths });
      return runTrusted(args, ctx, code);
    }

    case "physics_body_info": {
      const node = cleanNodePath(args.node_path, "");
      if (node.error || !args.node_path) return opsErrorResult("INVALID_PATH", node.error || "node_path is required");
      return runTrusted(args, ctx, genBodyInfoScript(node.path));
    }

    case "diagnose_physics": {
      const node = cleanNodePath(args.node_path, "");
      if (node.error || !args.node_path) return opsErrorResult("INVALID_PATH", node.error || "node_path is required");
      return runTrusted(args, ctx, genDiagnosePhysicsScript(node.path));
    }

    case "query_spatial": {
      const center = cleanVector3(args.origin, "origin");
      if (center.error) return opsErrorResult("INVALID_VECTOR", center.error);
      let radius = 10.0;
      if (args.radius !== undefined) {
        const r = Number(args.radius);
        if (!Number.isFinite(r)) return opsErrorResult("INVALID_VECTOR", "radius must be a finite number");
        radius = Math.max(0.1, r);
      }
      const mask = cleanMask(args.collision_mask);
      if (mask.error) return opsErrorResult("INVALID_VECTOR", mask.error);
      return runTrusted(args, ctx, genQuerySpatialScript({ center: center.vec, radius, collisionMask: mask.mask }));
    }

    case "collision_overlay": {
      const parent = cleanNodePath(args.node_path);
      if (parent.error) return opsErrorResult("INVALID_PATH", parent.error);
      let safeColor;
      const rawColor = args.color_override;
      if (rawColor != null && rawColor !== "") {
        const parts = String(rawColor).split(",").map((p) => p.trim());
        if (parts.length < 3 || parts.length > 4 || !parts.every((p) => /^\d+(\.\d+)?$/.test(p) && Number.isFinite(Number(p)))) {
          return opsErrorResult("INVALID_VECTOR", 'color_override must be 3-4 comma-separated finite numbers (e.g. "1,0,0,0.5")');
        }
        safeColor = parts.map((p) => String(Number(p))).join(", ");
      }
      return runTrusted(args, ctx, genCollisionOverlayScript({ parentPath: parent.path, colorOverride: safeColor }));
    }

    default:
      return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  }
}
