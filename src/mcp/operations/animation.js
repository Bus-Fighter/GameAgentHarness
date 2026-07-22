import { opsErrorResult, gdEscape, normalizeNodePath, CLASS_NAME_RE } from "../util.js";
import { requireProjectPath } from "../path-utils.js";
import { resolveGodotPath } from "../godot-process.js";
import { executeGdscript, parseGdscriptResult } from "../gdscript.js";
import { HEADER, ensureNumber } from "./navigation.js";

const NON_PERSIST = " Runtime effect only: changes do NOT persist to .tscn files (edit the scene file to persist).";

export const TRACK_TYPES = ["value", "position_3d", "rotation_3d", "scale_3d", "blend_shape", "method", "bezier", "audio", "animation"];
export const LOOP_MODES = ["none", "linear", "pingpong"];

const ACTIONS = [
  "list_players", "get_info", "get_details", "get_keyframes", "play", "stop", "seek",
  "create", "delete", "update_props", "add_track", "remove_track",
  "add_keyframe", "remove_keyframe", "update_keyframe",
];

export function valueToGd(v, trackType) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Non-finite number not supported: ${v}`);
    return String(v);
  }
  if (typeof v === "string") return `"${gdEscape(v)}"`;
  if (Array.isArray(v)) {
    if (v.length === 2 && v.every((e) => typeof e === "number" && Number.isFinite(e))) {
      return `Vector2(${v[0]}, ${v[1]})`;
    }
    if (v.length === 3 && v.every((e) => typeof e === "number" && Number.isFinite(e))) {
      if (trackType === "rotation_3d") return `Quaternion.from_euler(Vector3(${v[0]}, ${v[1]}, ${v[2]}))`;
      return `Vector3(${v[0]}, ${v[1]}, ${v[2]})`;
    }
    if (v.length === 4 && v.every((e) => typeof e === "number" && Number.isFinite(e))) {
      return `Color(${v[0]}, ${v[1]}, ${v[2]}, ${v[3]})`;
    }
    return `[${v.map((el) => valueToGd(el)).join(", ")}]`;
  }
  if (typeof v === "object") {
    const keys = Object.keys(v);
    if (typeof v.x === "number" && typeof v.y === "number") {
      if (typeof v.z === "number") return `Vector3(${v.x}, ${v.y}, ${v.z})`;
      return `Vector2(${v.x}, ${v.y})`;
    }
    if (typeof v.r === "number" && typeof v.g === "number" && typeof v.b === "number") {
      const a = typeof v.a === "number" ? v.a : 1.0;
      return `Color(${v.r}, ${v.g}, ${v.b}, ${a})`;
    }
    throw new Error(`Unsupported object keys: ${keys.join(", ")}`);
  }
  throw new Error(`Cannot convert value to GDScript literal: ${typeof v}`);
}

export function argsToGd(args) {
  if (!args || args.length === 0) return "[]";
  return `[${args.map((a) => valueToGd(a)).join(", ")}]`;
}

export function genListPlayers(rootPath) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar _root: Node = _mcp_get_root()
\tif _root == null:
\t\t_mcp_output("error", "Scene root not found")
\t\t_mcp_done()
\t\treturn
\tvar _search_root: Node = _root
\tif "${gdEscape(rootPath)}" != "":
\t\t_search_root = _mcp_get_node("${gdEscape(rootPath)}")
\t\tif _search_root == null:
\t\t\t_mcp_output("error", "Node not found: ${gdEscape(rootPath)}")
\t\t\t_mcp_done()
\t\t\treturn
\tvar _players: Array = []
\tvar _stack: Array = [_search_root]
\twhile _stack.size() > 0:
\t\tvar _n: Node = _stack.pop_back()
\t\tif _n is AnimationPlayer:
\t\t\t_players.append({"path": str(_n.get_path()).trim_prefix("/root/"), "name": _n.name})
\t\tfor _c in _n.get_children():
\t\t\t_stack.append(_c)
\t_mcp_output("animation_players", _players)
\t_mcp_done()
`;
}

const GD_FIND_ANIM = `\tvar _anim: Animation = null
\tfor _lib_name in _ap.get_animation_library_list():
\t\tvar _lib: AnimationLibrary = _ap.get_animation_library(_lib_name)
\t\tif _lib.has_animation("__ANIM__"):
\t\t\t_anim = _lib.get_animation("__ANIM__")
\t\t\tbreak
\tif _anim == null and _ap.has_animation("__ANIM__"):
\t\t_anim = _ap.get_animation("__ANIM__")
\tif _anim == null:
\t\t_mcp_output("error", "Animation not found: __ANIM__")
\t\t_mcp_done()
\t\treturn`;

const GD_PLAYER_GUARD = `\tvar _ap: AnimationPlayer = _mcp_get_node("__PATH__")
\tif _ap == null or not (_ap is AnimationPlayer):
\t\t_mcp_output("error", "AnimationPlayer not found: __PATH__")
\t\t_mcp_done()
\t\treturn`;

export function genGetInfo(nodePath) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
\tvar _info: Dictionary = {}
\t_info["current_animation"] = _ap.current_animation
\t_info["is_playing"] = _ap.is_playing()
\t_info["current_position"] = _ap.current_animation_position
\t_info["speed_scale"] = _ap.speed_scale
\t_info["autoplay"] = _ap.autoplay
\tvar _libs: Dictionary = {}
\tfor _lib_name in _ap.get_animation_library_list():
\t\tvar _lib: AnimationLibrary = _ap.get_animation_library(_lib_name)
\t\t_libs[_lib_name] = _lib.get_animation_list()
\t_info["libraries"] = _libs
\t_info["animation_count"] = _ap.get_animation_list().size()
\t_mcp_output("player_info", _info)
\t_mcp_done()
`;
}

export function genGetDetails(nodePath, animName) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
${GD_FIND_ANIM.replaceAll("__ANIM__", gdEscape(animName))}
\tvar _details: Dictionary = {}
\t_details["name"] = "${gdEscape(animName)}"
\t_details["length"] = _anim.length
\t_details["loop_mode"] = _anim.loop_mode
\t_details["step"] = _anim.step
\t_details["track_count"] = _anim.get_track_count()
\tvar _tracks: Array = []
\tfor _i in range(_anim.get_track_count()):
\t\tvar _td: Dictionary = {}
\t\t_td["index"] = _i
\t\t_td["type"] = _anim.track_get_type(_i)
\t\t_td["path"] = str(_anim.track_get_path(_i))
\t\t_td["interpolation"] = _anim.track_get_interpolation_type(_i)
\t\t_td["keyframe_count"] = _anim.track_get_key_count(_i)
\t\t_tracks.append(_td)
\t_details["tracks"] = _tracks
\t_mcp_output("animation_details", _details)
\t_mcp_done()
`;
}

export function genGetKeyframes(nodePath, animName, trackIdx) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
${GD_FIND_ANIM.replaceAll("__ANIM__", gdEscape(animName))}
\tif ${trackIdx} < 0 or ${trackIdx} >= _anim.get_track_count():
\t\t_mcp_output("error", "Track index out of range: ${trackIdx}")
\t\t_mcp_done()
\t\treturn
\tvar _kf_count: int = _anim.track_get_key_count(${trackIdx})
\tvar _keyframes: Array = []
\tfor _i in range(_kf_count):
\t\tvar _kd: Dictionary = {}
\t\t_kd["time"] = _anim.track_get_key_time(${trackIdx}, _i)
\t\t_kd["transition"] = _anim.track_get_key_transition(${trackIdx}, _i)
\t\tvar _tt: int = _anim.track_get_type(${trackIdx})
\t\tif _tt == Animation.TYPE_VALUE or _tt == Animation.TYPE_BEZIER:
\t\t\t_kd["value"] = var_to_str(_anim.track_get_key_value(${trackIdx}, _i))
\t\telif _tt == Animation.TYPE_METHOD:
\t\t\tvar _md: Dictionary = _anim.track_get_key_value(${trackIdx}, _i)
\t\t\t_kd["method"] = _md.get("method", "")
\t\t\t_kd["args"] = _md.get("args", [])
\t\t_keyframes.append(_kd)
\t_mcp_output("keyframes", {"track_index": ${trackIdx}, "track_path": str(_anim.track_get_path(${trackIdx})), "track_type": _anim.track_get_type(${trackIdx}), "keyframes": _keyframes})
\t_mcp_done()
`;
}

export function genPlay(nodePath, animName, customBlend, customSpeed, fromEnd) {
  const blendLine = customBlend !== undefined
    ? `_ap.play("${gdEscape(animName)}", ${customBlend < 0 ? "-1.0" : customBlend}, ${customSpeed ?? 1.0}, ${fromEnd ? "true" : "false"})`
    : `_ap.play("${gdEscape(animName)}")`;
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
\t${blendLine}
\t_mcp_output("result", {"playing": "${gdEscape(animName)}", "from_position": _ap.current_animation_position})
\t_mcp_done()
`;
}

export function genStop(nodePath, keepState) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
\t_ap.stop(${keepState ? "true" : "false"})
\t_mcp_output("result", {"stopped": true})
\t_mcp_done()
`;
}

export function genSeek(nodePath, seconds, update) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
\t_ap.seek(${seconds}, ${update ? "true" : "false"})
\t_mcp_output("result", {"position": ${seconds}})
\t_mcp_done()
`;
}

export function genCreate(nodePath, animName, libraryName, length, loopMode, step) {
  const loopMap = { none: 0, linear: 1, pingpong: 2 };
  const loopVal = loopMode ? (loopMap[loopMode] ?? 0) : 0;
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
\tvar _new_anim: Animation = Animation.new()
\t_new_anim.length = ${length ?? 1.0}
\t_new_anim.loop_mode = ${loopVal}
\t_new_anim.step = ${step ?? 0.1}
\tvar _lib_name: String = "${gdEscape(libraryName ?? "")}"
\tif _lib_name != "" and _ap.has_animation_library(_lib_name):
\t\tvar _lib: AnimationLibrary = _ap.get_animation_library(_lib_name)
\t\t_lib.add_animation("${gdEscape(animName)}", _new_anim)
\telse:
\t\tif not _ap.has_animation_library(""):
\t\t\t_ap.add_animation_library("", AnimationLibrary.new())
\t\tvar _default_lib: AnimationLibrary = _ap.get_animation_library("")
\t\t_default_lib.add_animation("${gdEscape(animName)}", _new_anim)
\t_mcp_output("result", {"created": "${gdEscape(animName)}", "library": _lib_name})
\t_mcp_done()
`;
}

export function genDelete(nodePath, animName, libraryName) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
\tvar _lib_name: String = "${gdEscape(libraryName ?? "")}"
\tif _lib_name != "" and _ap.has_animation_library(_lib_name):
\t\tvar _lib: AnimationLibrary = _ap.get_animation_library(_lib_name)
\t\t_lib.remove_animation("${gdEscape(animName)}")
\telif _ap.has_animation("${gdEscape(animName)}"):
\t\t_ap.remove_animation("${gdEscape(animName)}")
\telse:
\t\t_mcp_output("error", "Animation not found: ${gdEscape(animName)}")
\t\t_mcp_done()
\t\treturn
\t_mcp_output("result", {"deleted": "${gdEscape(animName)}"})
\t_mcp_done()
`;
}

export function genUpdateProps(nodePath, animName, length, loopMode, step) {
  const loopMap = { none: 0, linear: 1, pingpong: 2 };
  const loopVal = loopMode !== undefined ? (loopMap[loopMode] ?? 0) : -1;
  const lengthLine = length !== undefined ? `\t_anim.length = ${length}` : "";
  const loopLine = loopMode !== undefined ? `\t_anim.loop_mode = ${loopVal}` : "";
  const stepLine = step !== undefined ? `\t_anim.step = ${step}` : "";
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
\tif not _ap.has_animation("${gdEscape(animName)}"):
\t\t_mcp_output("error", "Animation not found: ${gdEscape(animName)}")
\t\t_mcp_done()
\t\treturn
\tvar _anim: Animation = _ap.get_animation("${gdEscape(animName)}")
${lengthLine}
${loopLine}
${stepLine}
\t_mcp_output("result", {"updated": "${gdEscape(animName)}", "length": _anim.length, "loop_mode": _anim.loop_mode, "step": _anim.step})
\t_mcp_done()
`;
}

export function genAddTrack(nodePath, animName, trackType, trackPath, insertAt) {
  const typeMap = {
    value: 0, position_3d: 1, rotation_3d: 2, scale_3d: 3,
    blend_shape: 4, method: 5, bezier: 6, audio: 7, animation: 8,
  };
  const typeVal = typeMap[trackType] ?? 0;
  const insertLine = insertAt !== undefined && insertAt >= 0
    ? `_anim.add_track(${typeVal}, ${insertAt})`
    : `_anim.add_track(${typeVal})`;
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
\tif not _ap.has_animation("${gdEscape(animName)}"):
\t\t_mcp_output("error", "Animation not found")
\t\t_mcp_done()
\t\treturn
\tvar _anim: Animation = _ap.get_animation("${gdEscape(animName)}")
\t${insertLine}
\tvar _idx: int = _anim.get_track_count() - 1
\t_anim.track_set_path(_idx, NodePath("${gdEscape(trackPath)}"))
\t_mcp_output("result", {"track_index": _idx, "track_path": "${gdEscape(trackPath)}", "track_type": "${gdEscape(trackType)}"})
\t_mcp_done()
`;
}

export function genRemoveTrack(nodePath, animName, trackIdx) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
\tif not _ap.has_animation("${gdEscape(animName)}"):
\t\t_mcp_output("error", "Animation not found")
\t\t_mcp_done()
\t\treturn
\tvar _anim: Animation = _ap.get_animation("${gdEscape(animName)}")
\tif ${trackIdx} < 0 or ${trackIdx} >= _anim.get_track_count():
\t\t_mcp_output("error", "Track index out of range")
\t\t_mcp_done()
\t\treturn
\t_anim.remove_track(${trackIdx})
\t_mcp_output("result", {"removed_track": ${trackIdx}})
\t_mcp_done()
`;
}

export function genAddKeyframe(nodePath, animName, trackIdx, time, value, transition, methodName, margs) {
  if (methodName && !CLASS_NAME_RE.test(methodName)) {
    throw new Error(`method_name "${methodName}" is not a valid GDScript identifier`);
  }
  const transStr = transition ?? 1.0;
  const valueStr = value !== undefined ? valueToGd(value) : "null";
  const rotValueStr = value !== undefined && Array.isArray(value) && value.length === 3
    ? `Quaternion.from_euler(Vector3(${Number(value[0])}, ${Number(value[1])}, ${Number(value[2])}))`
    : valueStr;
  const methodBlock = methodName
    ? `\telif _anim.track_get_type(${trackIdx}) == Animation.TYPE_METHOD:\n\t\tvar _md: Dictionary = {"method": "${gdEscape(methodName)}", "args": ${argsToGd(margs)}}\n\t\t_anim.track_insert_key(${trackIdx}, ${time}, _md, ${transStr})`
    : "";
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
\tif not _ap.has_animation("${gdEscape(animName)}"):
\t\t_mcp_output("error", "Animation not found")
\t\t_mcp_done()
\t\treturn
\tvar _anim: Animation = _ap.get_animation("${gdEscape(animName)}")
\tif ${trackIdx} < 0 or ${trackIdx} >= _anim.get_track_count():
\t\t_mcp_output("error", "Track index out of range")
\t\t_mcp_done()
\t\treturn
\tvar _kf_idx: int = -1
\tif _anim.track_get_type(${trackIdx}) == Animation.TYPE_VALUE or _anim.track_get_type(${trackIdx}) == Animation.TYPE_BEZIER:
\t\t_kf_idx = _anim.track_insert_key(${trackIdx}, ${time}, ${valueStr}, ${transStr})
\telif _anim.track_get_type(${trackIdx}) == Animation.TYPE_POSITION_3D:
\t\t_kf_idx = _anim.position_track_insert_key(${trackIdx}, ${time}, ${valueStr})
\telif _anim.track_get_type(${trackIdx}) == Animation.TYPE_ROTATION_3D:
\t\t_kf_idx = _anim.rotation_track_insert_key(${trackIdx}, ${time}, ${rotValueStr})
\telif _anim.track_get_type(${trackIdx}) == Animation.TYPE_SCALE_3D:
\t\t_kf_idx = _anim.scale_track_insert_key(${trackIdx}, ${time}, ${valueStr})
${methodBlock}
\t_mcp_output("result", {"keyframe_index": _kf_idx, "time": ${time}})
\t_mcp_done()
`;
}

export function genRemoveKeyframe(nodePath, animName, trackIdx, kfIdx) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
\tif not _ap.has_animation("${gdEscape(animName)}"):
\t\t_mcp_output("error", "Animation not found")
\t\t_mcp_done()
\t\treturn
\tvar _anim: Animation = _ap.get_animation("${gdEscape(animName)}")
\tif ${trackIdx} < 0 or ${trackIdx} >= _anim.get_track_count():
\t\t_mcp_output("error", "Track index out of range")
\t\t_mcp_done()
\t\treturn
\tif ${kfIdx} < 0 or ${kfIdx} >= _anim.track_get_key_count(${trackIdx}):
\t\t_mcp_output("error", "Keyframe index out of range")
\t\t_mcp_done()
\t\treturn
\t_anim.track_remove_key(${trackIdx}, ${kfIdx})
\t_mcp_output("result", {"removed_keyframe": ${kfIdx}, "track_index": ${trackIdx}})
\t_mcp_done()
`;
}

export function genUpdateKeyframe(nodePath, animName, trackIdx, kfIdx, time, value, transition) {
  const timeLine = time !== undefined ? `\t_anim.track_set_key_time(${trackIdx}, ${kfIdx}, ${time})` : "";
  const valueLine = value !== undefined
    ? `\tvar _tt: int = _anim.track_get_type(${trackIdx})
\tif _tt == Animation.TYPE_ROTATION_3D:
\t\t_anim.track_set_key_value(${trackIdx}, ${kfIdx}, ${valueToGd(value, "rotation_3d")})
\telse:
\t\t_anim.track_set_key_value(${trackIdx}, ${kfIdx}, ${valueToGd(value)})`
    : "";
  const transLine = transition !== undefined ? `\t_anim.track_set_key_transition(${trackIdx}, ${kfIdx}, ${transition})` : "";
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
${GD_PLAYER_GUARD.replaceAll("__PATH__", gdEscape(nodePath))}
\tif not _ap.has_animation("${gdEscape(animName)}"):
\t\t_mcp_output("error", "Animation not found")
\t\t_mcp_done()
\t\treturn
\tvar _anim: Animation = _ap.get_animation("${gdEscape(animName)}")
\tif ${trackIdx} < 0 or ${trackIdx} >= _anim.get_track_count():
\t\t_mcp_output("error", "Track index out of range")
\t\t_mcp_done()
\t\treturn
\tif ${kfIdx} < 0 or ${kfIdx} >= _anim.track_get_key_count(${trackIdx}):
\t\t_mcp_output("error", "Keyframe index out of range")
\t\t_mcp_done()
\t\treturn
${timeLine}
${valueLine}
${transLine}
\t_mcp_output("result", {"updated_keyframe": ${kfIdx}, "track_index": ${trackIdx}})
\t_mcp_done()
`;
}

export function animErrorMapper(msg) {
  if (msg.includes("not found")) {
    if (msg.includes("AnimationPlayer")) return "NODE_NOT_FOUND";
    if (msg.includes("Animation not found")) return "ANIM_NOT_FOUND";
    if (msg.includes("Track index")) return "TRACK_NOT_FOUND";
    if (msg.includes("Keyframe")) return "KEYFRAME_NOT_FOUND";
  }
  return "SCRIPT_EXEC_FAILED";
}

export const tools = [
  {
    name: "animation",
    description: `Query, control and edit animations on AnimationPlayer nodes. Query: list_players, get_info, get_details, get_keyframes. Playback: play, stop, seek. Edit: create, delete, update_props, add_track, remove_track, add_keyframe, remove_keyframe, update_keyframe.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        action: { type: "string", enum: ACTIONS, description: "Operation type" },
        root_path: { type: "string", description: "Search root node path (list_players)" },
        node_path: { type: "string", description: "AnimationPlayer node path (all actions except list_players)" },
        animation_name: { type: "string", description: "Animation name" },
        library_name: { type: "string", description: "Animation library name (create/delete)" },
        track_index: { type: "number", description: "Track index" },
        track_type: { type: "string", enum: TRACK_TYPES, description: "Track type (add_track)" },
        track_path: { type: "string", description: 'Track path, e.g. "Sprite2D:frame" (add_track)' },
        insert_at: { type: "number", description: "Track insert position, -1 for end (add_track)" },
        keyframe_index: { type: "number", description: "Keyframe index" },
        time: { type: "number", description: "Keyframe time in seconds" },
        value: { description: "Keyframe value" },
        transition: { type: "number", description: "Transition curve, 1.0 = linear" },
        method_name: { type: "string", description: "Method name (method tracks)" },
        args: { type: "array", items: {}, description: "Method arguments" },
        length: { type: "number", description: "Animation length in seconds" },
        loop_mode: { type: "string", enum: LOOP_MODES, description: "Loop mode" },
        step: { type: "number", description: "Keyframe snap step" },
        custom_blend: { type: "number", description: "Custom blend time, -1 for default (play)" },
        custom_speed: { type: "number", description: "Playback speed, default 1.0 (play)" },
        from_end: { type: "boolean", description: "Play from the end (play)" },
        keep_state: { type: "boolean", description: "Keep state when stopping (stop)" },
        seconds: { type: "number", description: "Seek position in seconds (seek)" },
        update: { type: "boolean", description: "Update nodes immediately after seek (seek)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "action"],
    },
  },
];

export async function handle(toolName, args, ctx) {
  if (toolName !== "animation") return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  const action = String(args.action ?? "");
  if (!ACTIONS.includes(action)) {
    return opsErrorResult("INVALID_PARAMS", `Invalid or missing action. Must be one of: ${ACTIONS.join(", ")}`);
  }
  try {
    const projectPath = requireProjectPath(args);
    const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
    const nodePath = args.node_path ? normalizeNodePath(args.node_path) : "";
    const animName = args.animation_name ?? "";
    let code;

    switch (action) {
      case "list_players":
        code = genListPlayers(args.root_path ?? "");
        break;
      case "get_info":
        if (!nodePath) return opsErrorResult("INVALID_PARAMS", "node_path required for get_info");
        code = genGetInfo(nodePath);
        break;
      case "get_details":
        if (!nodePath || !animName) return opsErrorResult("INVALID_PARAMS", "node_path and animation_name required");
        code = genGetDetails(nodePath, animName);
        break;
      case "get_keyframes":
        if (!nodePath || !animName || args.track_index === undefined) return opsErrorResult("INVALID_PARAMS", "node_path, animation_name, track_index required");
        code = genGetKeyframes(nodePath, animName, ensureNumber(args.track_index, "track_index"));
        break;
      case "play":
        if (!nodePath || !animName) return opsErrorResult("INVALID_PARAMS", "node_path and animation_name required");
        code = genPlay(nodePath, animName,
          args.custom_blend !== undefined ? ensureNumber(args.custom_blend, "custom_blend") : undefined,
          args.custom_speed !== undefined ? ensureNumber(args.custom_speed, "custom_speed") : undefined,
          args.from_end);
        break;
      case "stop":
        if (!nodePath) return opsErrorResult("INVALID_PARAMS", "node_path required for stop");
        code = genStop(nodePath, args.keep_state);
        break;
      case "seek":
        if (!nodePath || args.seconds === undefined) return opsErrorResult("INVALID_PARAMS", "node_path and seconds required");
        code = genSeek(nodePath, ensureNumber(args.seconds, "seconds"), args.update);
        break;
      case "create":
        if (!nodePath || !animName) return opsErrorResult("INVALID_PARAMS", "node_path and animation_name required");
        if (args.loop_mode !== undefined && !LOOP_MODES.includes(args.loop_mode)) {
          return opsErrorResult("INVALID_PARAMS", `loop_mode must be one of: ${LOOP_MODES.join(", ")}`);
        }
        code = genCreate(nodePath, animName, args.library_name,
          args.length !== undefined ? ensureNumber(args.length, "length") : undefined,
          args.loop_mode,
          args.step !== undefined ? ensureNumber(args.step, "step") : undefined);
        break;
      case "delete":
        if (!nodePath || !animName) return opsErrorResult("INVALID_PARAMS", "node_path and animation_name required");
        code = genDelete(nodePath, animName, args.library_name);
        break;
      case "update_props":
        if (!nodePath || !animName) return opsErrorResult("INVALID_PARAMS", "node_path and animation_name required");
        code = genUpdateProps(nodePath, animName,
          args.length !== undefined ? ensureNumber(args.length, "length") : undefined,
          args.loop_mode,
          args.step !== undefined ? ensureNumber(args.step, "step") : undefined);
        break;
      case "add_track":
        if (!nodePath || !animName || !args.track_type || !args.track_path) return opsErrorResult("INVALID_PARAMS", "node_path, animation_name, track_type, track_path required");
        if (!TRACK_TYPES.includes(args.track_type)) return opsErrorResult("INVALID_PARAMS", `track_type must be one of: ${TRACK_TYPES.join(", ")}`);
        code = genAddTrack(nodePath, animName, args.track_type, args.track_path,
          args.insert_at !== undefined ? ensureNumber(args.insert_at, "insert_at") : undefined);
        break;
      case "remove_track":
        if (!nodePath || !animName || args.track_index === undefined) return opsErrorResult("INVALID_PARAMS", "node_path, animation_name, track_index required");
        code = genRemoveTrack(nodePath, animName, ensureNumber(args.track_index, "track_index"));
        break;
      case "add_keyframe":
        if (!nodePath || !animName || args.track_index === undefined || args.time === undefined) return opsErrorResult("INVALID_PARAMS", "node_path, animation_name, track_index, time required");
        code = genAddKeyframe(nodePath, animName, ensureNumber(args.track_index, "track_index"), ensureNumber(args.time, "time"), args.value,
          args.transition !== undefined ? ensureNumber(args.transition, "transition") : undefined,
          args.method_name, args.args);
        break;
      case "remove_keyframe":
        if (!nodePath || !animName || args.track_index === undefined || args.keyframe_index === undefined) return opsErrorResult("INVALID_PARAMS", "node_path, animation_name, track_index, keyframe_index required");
        code = genRemoveKeyframe(nodePath, animName, ensureNumber(args.track_index, "track_index"), ensureNumber(args.keyframe_index, "keyframe_index"));
        break;
      case "update_keyframe":
        if (!nodePath || !animName || args.track_index === undefined || args.keyframe_index === undefined) return opsErrorResult("INVALID_PARAMS", "node_path, animation_name, track_index, keyframe_index required");
        code = genUpdateKeyframe(nodePath, animName, ensureNumber(args.track_index, "track_index"), ensureNumber(args.keyframe_index, "keyframe_index"),
          args.time !== undefined ? ensureNumber(args.time, "time") : undefined,
          args.value,
          args.transition !== undefined ? ensureNumber(args.transition, "transition") : undefined);
        break;
      default:
        return opsErrorResult("INVALID_ACTION", `Unknown action: ${action}`);
    }

    const result = await executeGdscript({ godotPath: godot, projectPath, code, timeout: 30, trusted: true });
    return parseGdscriptResult(result, { mapError: animErrorMapper });
  } catch (err) {
    return opsErrorResult("INVALID_PARAMS", err.message);
  }
}
