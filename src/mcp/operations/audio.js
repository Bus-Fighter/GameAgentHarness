import { opsErrorResult, gdEscape } from "../util.js";
import { resolveGodotPath } from "../godot-process.js";
import { requireProjectPath, normalizeUserProjectPath, iterativeDecode } from "../path-utils.js";
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

const TYPE_GUARD = "\tif not (node is AudioStreamPlayer or node is AudioStreamPlayer2D or node is AudioStreamPlayer3D):\n\t\t_mcp_output(\"error\", \"Node is not an AudioStreamPlayer type: \" + node.get_class())\n\t\t_mcp_done()\n\t\treturn";

const fmtNum = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

export function genAudioPlayScript({ nodePath, streamPath, volumeDb, pitchScale, bus, fromPosition }) {
  const streamLine = streamPath
    ? `\n\tvar stream_res = load("${gdEscape(streamPath)}")\n\tif stream_res:\n\t\tnode.stream = stream_res\n\telse:\n\t\t_mcp_output("error", "Failed to load audio stream: ${gdEscape(streamPath)}")\n\t\t_mcp_done()\n\t\treturn`
    : "";
  const volLine = volumeDb !== undefined ? `\n\tnode.volume_db = ${fmtNum(volumeDb)}` : "";
  const pitchLine = pitchScale !== undefined ? `\n\tnode.pitch_scale = ${fmtNum(pitchScale)}` : "";
  const busLine = bus ? `\n\tnode.bus = "${gdEscape(bus)}"` : "";
  const playArg = fromPosition !== undefined ? `(${fmtNum(fromPosition)})` : "()";

  if (!nodePath) {
    return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = AudioStreamPlayer.new()
\tnode.name = "_MCP_AudioPlay"
\t_mcp_get_root().add_child(node)${streamLine}${volLine}${pitchLine}${busLine}
\tnode.play${playArg}
\t_mcp_output("playing", {"node": str(node.get_path()), "stream": str(node.stream) if node.stream else "None"})
\t_mcp_done()
`;
  }
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
${TYPE_GUARD}${streamLine}${volLine}${pitchLine}${busLine}
\tnode.play${playArg}
\t_mcp_output("playing", {"node": "${gdEscape(nodePath)}", "stream": str(node.stream) if node.stream else "None"})
\t_mcp_done()
`;
}

export function genAudioStopScript(nodePath) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
${TYPE_GUARD}
\tnode.stop()
\t_mcp_output("stopped", {"node": "${gdEscape(nodePath)}"})
\t_mcp_done()
`;
}

export function genAudioSetParamScript({ nodePath, volumeDb, pitchScale, bus }) {
  const lines = [];
  if (volumeDb !== undefined) lines.push(`\tnode.volume_db = ${fmtNum(volumeDb)}`);
  if (pitchScale !== undefined) lines.push(`\tnode.pitch_scale = ${fmtNum(pitchScale)}`);
  if (bus !== undefined) lines.push(`\tnode.bus = "${gdEscape(bus)}"`);
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
${TYPE_GUARD}
${lines.join("\n")}
\t_mcp_output("param_set", {"node": "${gdEscape(nodePath)}", "volume_db": node.volume_db, "pitch_scale": node.pitch_scale, "bus": node.bus})
\t_mcp_done()
`;
}

export function genAudioQueryScript(nodePath) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar node = _mcp_get_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
${TYPE_GUARD}
\tvar info = {}
\tinfo["playing"] = node.playing
\tinfo["volume_db"] = node.volume_db
\tinfo["pitch_scale"] = node.pitch_scale
\tinfo["bus"] = node.bus
\tinfo["stream"] = str(node.stream.resource_path) if node.stream else "None"
\tinfo["playback_position"] = node.get_playback_position() if node.playing else 0.0
\tinfo["stream_length"] = node.stream.get_length() if node.stream else 0.0
\tinfo["node_type"] = node.get_class()
\t_mcp_output("audio_info", info)
\t_mcp_done()
`;
}

function cleanNodePath(value, fallback = "root") {
  const raw = value == null || String(value).trim() === "" ? fallback : String(value).trim();
  if (raw.includes("..")) return { error: `node path must not contain "..": ${raw}` };
  return { path: raw.replace(/^\/+/, "") || "root" };
}

function cleanResPath(value) {
  if (value == null || String(value).trim() === "") return { resPath: undefined };
  let rel;
  try {
    rel = iterativeDecode(normalizeUserProjectPath(String(value)));
  } catch {
    return { error: "stream_path contains invalid encoding" };
  }
  if (!rel || rel.includes("..") || rel.includes("\\")) {
    return { error: "stream_path must be a project-relative res path (no traversal / encoding tricks)" };
  }
  return { resPath: `res://${rel}` };
}

function cleanNumber(value, label, min, max) {
  if (value === undefined) return { num: undefined };
  const n = Number(value);
  if (!Number.isFinite(n)) return { error: `${label} must be a finite number` };
  return { num: Math.min(max, Math.max(min, n)) };
}

export const tools = [
  {
    name: "audio_play",
    description: `Play audio on an AudioStreamPlayer/2D/3D node (node_path), or from a standalone stream resource (stream_path) via a temporary player. Optionally sets volume_db, pitch_scale, bus and start position before playing. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "AudioStreamPlayer node path (omit to play stream_path on a temporary player)" },
        stream_path: { type: "string", description: "Audio stream resource path (res:// or project-relative); plays the node's configured stream when omitted" },
        volume_db: { type: "number", description: "Volume in dB (-80 to 24)" },
        pitch_scale: { type: "number", description: "Pitch scale (0.01 to 100)" },
        bus: { type: "string", description: "Audio bus name" },
        from_position: { type: "number", description: "Start position in seconds (>= 0)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "audio_stop",
    description: `Stop playback on an AudioStreamPlayer/2D/3D node. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "AudioStreamPlayer node path" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path"],
    },
  },
  {
    name: "audio_set_param",
    description: `Set one or more parameters (volume_db, pitch_scale, bus) on an AudioStreamPlayer/2D/3D node. At least one parameter is required. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "AudioStreamPlayer node path" },
        volume_db: { type: "number", description: "Volume in dB (-80 to 24)" },
        pitch_scale: { type: "number", description: "Pitch scale (0.01 to 100)" },
        bus: { type: "string", description: "Audio bus name" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path"],
    },
  },
  {
    name: "audio_query",
    description: `Query playback state of an AudioStreamPlayer/2D/3D node: playing, volume_db, pitch_scale, bus, stream, playback position and stream length. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "AudioStreamPlayer node path" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "node_path"],
    },
  },
];

async function runTrusted(args, ctx, code) {
  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path ?? ctx?.godotPath);
  const result = await executeGdscript({ godotPath: godot, projectPath, code, timeout: 30, trusted: true });
  return parseGdscriptResult(result, {
    mapError: (msg) => (msg.includes("not found") || msg.includes("not an Audio") ? "AUDIO_NOT_FOUND" : "SCRIPT_EXEC_FAILED"),
  });
}

export async function handle(toolName, args, ctx) {
  switch (toolName) {
    case "audio_play": {
      let nodePath;
      if (args.node_path != null && String(args.node_path).trim() !== "") {
        const node = cleanNodePath(args.node_path);
        if (node.error) return opsErrorResult("INVALID_PATH", node.error);
        nodePath = node.path;
      }
      const sp = cleanResPath(args.stream_path);
      if (sp.error) return opsErrorResult("INVALID_PATH", sp.error);
      if (!nodePath && !sp.resPath) {
        return opsErrorResult("INVALID_PARAMS", "audio_play requires node_path or stream_path");
      }
      const vol = cleanNumber(args.volume_db, "volume_db", -80, 24);
      if (vol.error) return opsErrorResult("INVALID_TYPE", vol.error);
      const pitch = cleanNumber(args.pitch_scale, "pitch_scale", 0.01, 100);
      if (pitch.error) return opsErrorResult("INVALID_TYPE", pitch.error);
      let fromPosition;
      if (args.from_position !== undefined) {
        const fp = Number(args.from_position);
        if (!Number.isFinite(fp) || fp < 0) return opsErrorResult("INVALID_TYPE", "from_position must be a non-negative finite number");
        fromPosition = fp;
      }
      const bus = args.bus != null ? String(args.bus) : undefined;
      const code = genAudioPlayScript({ nodePath, streamPath: sp.resPath, volumeDb: vol.num, pitchScale: pitch.num, bus, fromPosition });
      return runTrusted(args, ctx, code);
    }

    case "audio_stop": {
      const node = cleanNodePath(args.node_path, "");
      if (node.error || !args.node_path) return opsErrorResult("INVALID_PATH", node.error || "node_path is required");
      return runTrusted(args, ctx, genAudioStopScript(node.path));
    }

    case "audio_set_param": {
      const node = cleanNodePath(args.node_path, "");
      if (node.error || !args.node_path) return opsErrorResult("INVALID_PATH", node.error || "node_path is required");
      const vol = cleanNumber(args.volume_db, "volume_db", -80, 24);
      if (vol.error) return opsErrorResult("INVALID_TYPE", vol.error);
      const pitch = cleanNumber(args.pitch_scale, "pitch_scale", 0.01, 100);
      if (pitch.error) return opsErrorResult("INVALID_TYPE", pitch.error);
      const bus = args.bus != null ? String(args.bus) : undefined;
      if (vol.num === undefined && pitch.num === undefined && bus === undefined) {
        return opsErrorResult("INVALID_PARAMS", "audio_set_param requires at least one of volume_db, pitch_scale, bus");
      }
      const code = genAudioSetParamScript({ nodePath: node.path, volumeDb: vol.num, pitchScale: pitch.num, bus });
      return runTrusted(args, ctx, code);
    }

    case "audio_query": {
      const node = cleanNodePath(args.node_path, "");
      if (node.error || !args.node_path) return opsErrorResult("INVALID_PATH", node.error || "node_path is required");
      return runTrusted(args, ctx, genAudioQueryScript(node.path));
    }

    default:
      return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  }
}
