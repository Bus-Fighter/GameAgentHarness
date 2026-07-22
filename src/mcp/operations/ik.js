import { opsErrorResult, gdEscape, normalizeNodePath, CLASS_NAME_RE } from "../util.js";
import { requireProjectPath } from "../path-utils.js";
import { resolveGodotPath } from "../godot-process.js";
import { executeGdscript, parseGdscriptResult } from "../gdscript.js";
import { HEADER, validateVector3 } from "./navigation.js";

const NON_PERSIST = " Runtime effect only: changes do NOT persist to .tscn files (edit the scene file to persist).";

export const IK_TYPE_WHITELIST = ["TwoBoneIK3D", "FABRIK3D", "CCDIK3D", "SplineIK3D", "JacobianIK3D"];
export const IK_SETTABLE_PROPS = ["active", "influence", "bone_name", "target_nodepath", "use_magnet", "magnet_position"];

export function genIkCreateScript(type, name, parent, position, boneName, targetNodepath) {
  const posLine = position ? `\n\tik_node.position = Vector3(${position.x}, ${position.y}, ${position.z})` : "";
  const boneLine = boneName ? `\n\tik_node.bone_name = "${gdEscape(boneName)}"` : "";
  const targetLine = targetNodepath ? `\n\tik_node.target_nodepath = NodePath("${gdEscape(targetNodepath)}")` : "";

  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar ik_node = ${type}.new()
\tik_node.name = "${gdEscape(name)}"${posLine}${boneLine}${targetLine}
\tvar parent_node = _mcp_get_node("${gdEscape(parent)}")
\tif parent_node == null:
\t\t_mcp_output("error", "Parent not found: ${gdEscape(parent)}")
\t\t_mcp_done()
\t\treturn
\tparent_node.add_child(ik_node)
\tvar _root_node = _mcp_get_root()
\tif _root_node != null:
\t\tik_node.owner = _root_node
\t_mcp_output("created", true)
\t_mcp_output("path", str(ik_node.get_path()))
\t_mcp_output("type", "${type}")
\t_mcp_done()
`;
}

export function genIkGetScript(nodePath) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar ik_node = _mcp_get_node("${gdEscape(nodePath)}")
\tif ik_node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar ik_class = ik_node.get_class()
\t_mcp_output("type", ik_class)
\t_mcp_output("active", ik_node.active)
\t_mcp_output("influence", ik_node.influence)
\tif ik_class == "TwoBoneIK3D":
\t\t_mcp_output("bone_name", str(ik_node.bone_name))
\t\t_mcp_output("target_nodepath", str(ik_node.target_nodepath))
\t\t_mcp_output("use_magnet", ik_node.use_magnet)
\t\tvar mag = ik_node.magnet_position
\t\t_mcp_output("magnet_position", {"x": mag.x, "y": mag.y, "z": mag.z})
\tvar skeleton = ik_node.get_parent()
\tif skeleton is Skeleton3D:
\t\t_mcp_output("skeleton_path", str(skeleton.get_path()))
\t_mcp_done()
`;
}

export function genIkSetScript(nodePath, props) {
  const lines = [];
  lines.push(HEADER);
  lines.push("func _initialize():");
  lines.push("\t_mcp_load_main_scene()");
  lines.push(`\tvar ik_node = _mcp_get_node("${gdEscape(nodePath)}")`);
  lines.push("\tif ik_node == null:");
  lines.push(`\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")`);
  lines.push("\t\t_mcp_done()");
  lines.push("\t\treturn");

  for (const [key, val] of Object.entries(props)) {
    if (key === "active") lines.push(`\tik_node.active = ${val}`);
    else if (key === "influence") lines.push(`\tik_node.influence = ${Number(val)}`);
    else if (key === "bone_name") lines.push(`\tik_node.bone_name = "${gdEscape(String(val))}"`);
    else if (key === "target_nodepath") lines.push(`\tik_node.target_nodepath = NodePath("${gdEscape(String(val))}")`);
    else if (key === "use_magnet") lines.push(`\tik_node.use_magnet = ${val}`);
    else if (key === "magnet_position") lines.push(`\tik_node.magnet_position = Vector3(${val.x}, ${val.y}, ${val.z})`);
  }

  lines.push("\t_mcp_output(\"updated\", true)");
  lines.push("\t_mcp_output(\"path\", str(ik_node.get_path()))");
  lines.push("\t_mcp_done()");
  return lines.join("\n") + "\n";
}

export function genListBonesScript(nodePath, limit) {
  const limitLine = limit ? `\n\tif bones.size() > ${limit}:\n\t\tbones = bones.slice(0, ${limit})` : "";

  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif not node is Skeleton3D:
\t\t_mcp_output("error", "Node is not a Skeleton3D: " + node.get_class())
\t\t_mcp_done()
\t\treturn
\tvar bones = []
\tfor i in range(node.get_bone_count()):
\t\tvar bname = node.get_bone_name(i)
\t\tvar rest = node.get_bone_rest(i)
\t\tbones.append({"index": i, "name": bname, "rest_position": {"x": rest.origin.x, "y": rest.origin.y, "z": rest.origin.z}})${limitLine}
\t_mcp_output("bone_count", node.get_bone_count())
\t_mcp_output("bones", bones)
\t_mcp_done()
`;
}

export const tools = [
  {
    name: "ik_modifier_create",
    description: `Create an IK modifier node (TwoBoneIK3D/FABRIK3D/CCDIK3D/SplineIK3D/JacobianIK3D) under a parent (typically a Skeleton3D).${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        type: { type: "string", enum: IK_TYPE_WHITELIST, description: "IK modifier type" },
        name: { type: "string", description: "Node name" },
        parent: { type: "string", description: "Parent node path (default: root)", default: "root" },
        position: { type: "object", description: "Position {x,y,z}", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        bone_name: { type: "string", description: "Bone to control (TwoBoneIK3D)" },
        target_nodepath: { type: "string", description: "IK target node path" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "type", "name"],
    },
  },
  {
    name: "ik_modifier_get",
    description: "Read properties of an IK modifier node.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "IK modifier node path" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path"],
    },
  },
  {
    name: "ik_modifier_set",
    description: `Set properties on an IK modifier node (active, influence, bone_name, target_nodepath, use_magnet, magnet_position).${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "IK modifier node path" },
        properties: { type: "object", description: `Property key/value pairs. Allowed: ${IK_SETTABLE_PROPS.join(", ")}` },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path", "properties"],
    },
  },
  {
    name: "ik_list_bones",
    description: "List bones of a Skeleton3D node (index, name, rest position).",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "Skeleton3D node path" },
        limit: { type: "number", description: "Maximum number of bones to return" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path"],
    },
  },
];

async function runScript(script, args, ctx) {
  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
  const result = await executeGdscript({ godotPath: godot, projectPath, code: script, timeout: 30, trusted: true });
  return parseGdscriptResult(result, {
    mapError: (msg) =>
      msg.includes("not found") ? "NODE_NOT_FOUND"
        : msg.includes("not a Skeleton3D") ? "INVALID_TYPE"
          : "SCRIPT_EXEC_FAILED",
  });
}

export async function handle(toolName, args, ctx) {
  try {
    switch (toolName) {
      case "ik_modifier_create": {
        const ikType = String(args.type ?? "");
        if (!IK_TYPE_WHITELIST.includes(ikType)) {
          return opsErrorResult("INVALID_TYPE", `Invalid IK type: "${ikType}". Must be one of: ${IK_TYPE_WHITELIST.join(", ")}`);
        }
        const nodeName = String(args.name ?? "");
        if (!CLASS_NAME_RE.test(nodeName)) {
          return opsErrorResult("INVALID_PROPERTY", `name "${nodeName}" is not a valid identifier`);
        }
        const parent = normalizeNodePath(args.parent || "root");
        const position = args.position ? validateVector3(args.position, "position") : undefined;
        return runScript(genIkCreateScript(ikType, nodeName, parent, position, args.bone_name, args.target_nodepath), args, ctx);
      }
      case "ik_modifier_get": {
        const nodePath = normalizeNodePath(args.node_path);
        return runScript(genIkGetScript(nodePath), args, ctx);
      }
      case "ik_modifier_set": {
        const nodePath = normalizeNodePath(args.node_path);
        const props = args.properties;
        if (!props || typeof props !== "object" || Array.isArray(props)) {
          return opsErrorResult("INVALID_PROPERTY", "properties must be an object");
        }
        for (const key of Object.keys(props)) {
          if (!IK_SETTABLE_PROPS.includes(key)) {
            return opsErrorResult("INVALID_PROPERTY", `Unknown property: "${key}". Allowed: ${IK_SETTABLE_PROPS.join(", ")}`);
          }
        }
        if ("bone_name" in props && (!props.bone_name || String(props.bone_name).trim() === "")) {
          return opsErrorResult("INVALID_PROPERTY", "bone_name must be non-empty");
        }
        if ("active" in props && typeof props.active !== "boolean") {
          return opsErrorResult("INVALID_PROPERTY", "active must be a boolean");
        }
        if ("influence" in props) {
          const inf = Number(props.influence);
          if (!Number.isFinite(inf) || inf < 0 || inf > 1) {
            return opsErrorResult("INVALID_PROPERTY", "influence must be a number in [0, 1]");
          }
        }
        if ("use_magnet" in props && typeof props.use_magnet !== "boolean") {
          return opsErrorResult("INVALID_PROPERTY", "use_magnet must be a boolean");
        }
        if ("magnet_position" in props) {
          props.magnet_position = validateVector3(props.magnet_position, "magnet_position");
        }
        return runScript(genIkSetScript(nodePath, props), args, ctx);
      }
      case "ik_list_bones": {
        const nodePath = normalizeNodePath(args.node_path);
        const limit = args.limit;
        if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
          return opsErrorResult("INVALID_PROPERTY", "limit must be a positive integer");
        }
        return runScript(genListBonesScript(nodePath, limit), args, ctx);
      }
      default:
        return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
    }
  } catch (err) {
    return opsErrorResult("INVALID_PARAMS", err.message);
  }
}
