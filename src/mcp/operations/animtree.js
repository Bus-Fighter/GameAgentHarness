import { opsErrorResult, gdEscape, normalizeNodePath } from "../util.js";
import { requireProjectPath } from "../path-utils.js";
import { resolveGodotPath } from "../godot-process.js";
import { executeGdscript, parseGdscriptResult } from "../gdscript.js";
import { HEADER, ensureNumber } from "./navigation.js";

const NON_PERSIST = " Runtime effect only: changes do NOT persist to .tscn files (edit the scene file to persist).";

export const TREE_ROOT_TYPES = ["AnimationNodeStateMachine", "AnimationNodeBlendTree", "AnimationNodeBlendSpace2D"];

export function genCreate(nodeName, parentPath, animPlayerPath, treeRootType) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar _parent: Node = _mcp_get_node("${gdEscape(parentPath)}")
\tif _parent == null:
\t\t_mcp_output("error", "Parent node not found: ${gdEscape(parentPath)}")
\t\t_mcp_done()
\t\treturn
\tvar _tree = AnimationTree.new()
\t_tree.name = "${gdEscape(nodeName)}"
\t_tree.anim_player = NodePath("${gdEscape(animPlayerPath)}")
\tvar _root_node
\tmatch "${gdEscape(treeRootType)}":
\t\t"AnimationNodeStateMachine":
\t\t\t_root_node = AnimationNodeStateMachine.new()
\t\t"AnimationNodeBlendTree":
\t\t\t_root_node = AnimationNodeBlendTree.new()
\t\t"AnimationNodeBlendSpace2D":
\t\t\t_root_node = AnimationNodeBlendSpace2D.new()
\t\t_:
\t\t\t_root_node = AnimationNodeStateMachine.new()
\t_tree.tree_root = _root_node
\t_tree.active = true
\t_parent.add_child(_tree)
\t_mcp_output("created", {"name": "${gdEscape(nodeName)}", "parent": "${gdEscape(parentPath)}", "root_type": "${gdEscape(treeRootType)}"})
\t_mcp_done()
`;
}

export function genAddState(nodePath, stateName, animation, posX, posY) {
  const posLine = (posX !== undefined && posY !== undefined)
    ? `\n\t_sm.set_node_position("${gdEscape(stateName)}", Vector2(${posX}, ${posY}))`
    : "";
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar _tree: AnimationTree = _mcp_get_node("${gdEscape(nodePath)}")
\tif _tree == null or not (_tree is AnimationTree):
\t\t_mcp_output("error", "AnimationTree not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar _sm: AnimationNodeStateMachine = _tree.tree_root
\tif _sm == null or not (_sm is AnimationNodeStateMachine):
\t\t_mcp_output("error", "Tree root is not a AnimationNodeStateMachine")
\t\t_mcp_done()
\t\treturn
\tvar _anim_node = AnimationNodeAnimation.new()
\t_anim_node.animation = "${gdEscape(animation)}"
\t_sm.add_node("${gdEscape(stateName)}", _anim_node)${posLine}
\t_mcp_output("added_state", {"state": "${gdEscape(stateName)}", "animation": "${gdEscape(animation)}"})
\t_mcp_done()
`;
}

export function genAddTransition(nodePath, fromState, toState, xfadeTime, conditions) {
  const condLines = conditions.map((c) => {
    const valStr = typeof c.value === "boolean" ? (c.value ? "true" : "false") : String(c.value);
    return `\t_transition.add_condition("${gdEscape(c.name)}", ${valStr})`;
  }).join("\n");

  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar _tree: AnimationTree = _mcp_get_node("${gdEscape(nodePath)}")
\tif _tree == null or not (_tree is AnimationTree):
\t\t_mcp_output("error", "AnimationTree not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar _sm: AnimationNodeStateMachine = _tree.tree_root
\tif _sm == null or not (_sm is AnimationNodeStateMachine):
\t\t_mcp_output("error", "Tree root is not a AnimationNodeStateMachine")
\t\t_mcp_done()
\t\treturn
\tvar _transition = AnimationNodeStateMachineTransition.new()
\t_transition.xfade_time = ${xfadeTime}
${condLines}
\t_sm.add_transition("${gdEscape(fromState)}", "${gdEscape(toState)}", _transition)
\t_mcp_output("added_transition", {"from": "${gdEscape(fromState)}", "to": "${gdEscape(toState)}", "xfade": ${xfadeTime}, "conditions": ${conditions.length}})
\t_mcp_done()
`;
}

export function genSetBlend(nodePath, paramName, valueSrc) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar _tree: AnimationTree = _mcp_get_node("${gdEscape(nodePath)}")
\tif _tree == null or not (_tree is AnimationTree):
\t\t_mcp_output("error", "AnimationTree not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\t_tree.set("${gdEscape(paramName)}", ${valueSrc})
\t_mcp_output("set_blend", {"parameter": "${gdEscape(paramName)}", "value": ${valueSrc}})
\t_mcp_done()
`;
}

export function genPlay(nodePath, stateName) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar _tree: AnimationTree = _mcp_get_node("${gdEscape(nodePath)}")
\tif _tree == null or not (_tree is AnimationTree):
\t\t_mcp_output("error", "AnimationTree not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar _playback = _tree["parameters/playback"]
\tif _playback == null:
\t\t_mcp_output("error", "Playback not available. Ensure tree_root is AnimationNodeStateMachine.")
\t\t_mcp_done()
\t\treturn
\t_playback.travel("${gdEscape(stateName)}")
\t_mcp_output("playing", {"state": "${gdEscape(stateName)}"})
\t_mcp_done()
`;
}

export const tools = [
  {
    name: "animtree_create",
    description: `Create an AnimationTree node with a chosen root type, wired to an AnimationPlayer.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        name: { type: "string", description: "AnimationTree node name" },
        parent: { type: "string", description: "Parent node path (default: root)", default: "root" },
        animation_player_path: { type: "string", description: "NodePath to the AnimationPlayer" },
        tree_root_type: { type: "string", enum: TREE_ROOT_TYPES, description: "Root node type (default: AnimationNodeStateMachine)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "name", "animation_player_path"],
    },
  },
  {
    name: "animtree_add_state",
    description: `Add a state (AnimationNodeAnimation) to an AnimationTree state machine.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "AnimationTree node path" },
        state_name: { type: "string", description: "State name" },
        animation: { type: "string", description: "Animation name to associate" },
        position: { type: "object", description: "Graph position {x, y}", properties: { x: { type: "number" }, y: { type: "number" } } },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path", "state_name", "animation"],
    },
  },
  {
    name: "animtree_add_transition",
    description: `Add a transition between two states in an AnimationTree state machine, with optional xfade and conditions.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "AnimationTree node path" },
        from_state: { type: "string", description: "Source state name" },
        to_state: { type: "string", description: "Target state name" },
        xfade_time: { type: "number", description: "Cross-fade time in seconds (default 0)" },
        conditions: {
          type: "array",
          description: "Transition conditions (number or boolean values)",
          items: {
            type: "object",
            properties: { name: { type: "string" }, value: {} },
            required: ["name", "value"],
          },
        },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path", "from_state", "to_state"],
    },
  },
  {
    name: "animtree_set_blend",
    description: `Set a blend parameter on an AnimationTree (float for blends, {x,y} for blend spaces).${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "AnimationTree node path" },
        parameter_name: { type: "string", description: "Parameter name" },
        value: { description: "Parameter value (number or {x, y} object)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path", "parameter_name", "value"],
    },
  },
  {
    name: "animtree_play",
    description: `Travel to a state in an AnimationTree state machine playback.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "AnimationTree node path" },
        state_name: { type: "string", description: "State name to travel to" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path", "state_name"],
    },
  },
];

async function runScript(code, args, ctx) {
  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
  const result = await executeGdscript({ godotPath: godot, projectPath, code, timeout: 30, trusted: true });
  return parseGdscriptResult(result, {
    mapError: (msg) => (msg.includes("not found") ? "NODE_NOT_FOUND" : "SCRIPT_EXEC_FAILED"),
  });
}

export async function handle(toolName, args, ctx) {
  try {
    switch (toolName) {
      case "animtree_create": {
        const nodeName = args.name;
        const animPlayerPath = args.animation_player_path;
        if (!nodeName || !animPlayerPath) {
          return opsErrorResult("INVALID_PARAMS", "name and animation_player_path are required");
        }
        const parent = normalizeNodePath(args.parent || "root");
        const treeRootType = args.tree_root_type || "AnimationNodeStateMachine";
        if (!TREE_ROOT_TYPES.includes(treeRootType)) {
          return opsErrorResult("INVALID_PARAMS", `tree_root_type must be one of: ${TREE_ROOT_TYPES.join(", ")}`);
        }
        return runScript(genCreate(String(nodeName), parent, String(animPlayerPath), treeRootType), args, ctx);
      }
      case "animtree_add_state": {
        const nodePath = normalizeNodePath(args.node_path);
        if (!args.state_name || !args.animation) {
          return opsErrorResult("INVALID_PARAMS", "state_name and animation are required");
        }
        const pos = args.position;
        const posX = pos?.x !== undefined ? ensureNumber(pos.x, "position.x") : undefined;
        const posY = pos?.y !== undefined ? ensureNumber(pos.y, "position.y") : undefined;
        return runScript(genAddState(nodePath, String(args.state_name), String(args.animation), posX, posY), args, ctx);
      }
      case "animtree_add_transition": {
        const nodePath = normalizeNodePath(args.node_path);
        if (!args.from_state || !args.to_state) {
          return opsErrorResult("INVALID_PARAMS", "from_state and to_state are required");
        }
        const xfadeTime = args.xfade_time !== undefined ? ensureNumber(args.xfade_time, "xfade_time") : 0.0;
        const rawConditions = Array.isArray(args.conditions) ? args.conditions : [];
        const conditions = rawConditions
          .filter((c) => c && c.name && c.value !== undefined && c.value !== null)
          .map((c) => ({
            name: String(c.name),
            value: typeof c.value === "boolean" ? c.value : ensureNumber(c.value, "condition value"),
          }));
        return runScript(genAddTransition(nodePath, String(args.from_state), String(args.to_state), xfadeTime, conditions), args, ctx);
      }
      case "animtree_set_blend": {
        const nodePath = normalizeNodePath(args.node_path);
        const paramName = args.parameter_name;
        const value = args.value;
        if (!paramName || value === undefined) {
          return opsErrorResult("INVALID_PARAMS", "parameter_name and value are required");
        }
        let valueSrc;
        if (typeof value === "number") {
          if (!Number.isFinite(value)) return opsErrorResult("INVALID_PARAMS", "value must be finite");
          valueSrc = String(value);
        } else if (typeof value === "object" && value !== null) {
          valueSrc = `Vector2(${ensureNumber(value.x, "value.x")}, ${ensureNumber(value.y, "value.y")})`;
        } else {
          return opsErrorResult("INVALID_PARAMS", "value must be a number or {x, y} object");
        }
        return runScript(genSetBlend(nodePath, String(paramName), valueSrc), args, ctx);
      }
      case "animtree_play": {
        const nodePath = normalizeNodePath(args.node_path);
        if (!args.state_name) return opsErrorResult("INVALID_PARAMS", "state_name is required");
        return runScript(genPlay(nodePath, String(args.state_name)), args, ctx);
      }
      default:
        return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
    }
  } catch (err) {
    return opsErrorResult("INVALID_PARAMS", err.message);
  }
}
