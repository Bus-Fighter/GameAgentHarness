import fs from "node:fs";
import path from "node:path";
import { opsErrorResult, textResult, gdEscape, writeAtomic, ensureDir } from "../util.js";
import { requireProjectPath, resolveWithinRoot } from "../path-utils.js";
import { resolveGodotPath } from "../godot-process.js";
import { executeGdscript, parseGdscriptResult, SCENE_TREE_HEADER } from "../gdscript.js";

const NON_PERSIST = " Runtime effect only: recordings are stored under the harness traceDir or res://recordings, never in scene files.";

export const MAX_RECORDING_EVENTS = 10000;

// ─── Keycode → Godot key name mapping (subset, mirrors upstream) ─────────────

export const KEYCODE_TO_STRING = {
  4: "a", 5: "b", 6: "c", 7: "d", 8: "e", 9: "f", 10: "g", 11: "h", 12: "i",
  13: "j", 14: "k", 15: "l", 16: "m", 17: "n", 18: "o", 19: "p", 20: "q",
  21: "r", 22: "s", 23: "t", 24: "u", 25: "v", 26: "w", 27: "x", 28: "y", 29: "z",
  30: "0", 31: "1", 32: "2", 33: "3", 34: "4", 35: "5", 36: "6", 37: "7", 38: "8", 39: "9",
  41: "escape", 42: "tab", 44: "enter", 45: "space",
  46: "up", 47: "down", 48: "left", 49: "right",
  50: "shift", 51: "ctrl", 52: "alt",
};

export function keycodeToBridgeKey(keycode) {
  return KEYCODE_TO_STRING[keycode] ?? null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function sanitizeRecordingFileName(name) {
  if (name.includes("/") || name.includes("\\") || name.split(/[/\\]/).includes("..")) {
    throw new Error("INVALID_FILE_NAME: path traversal detected");
  }
  if (!/^recording_[\w-]+\.json$/.test(name)) {
    throw new Error("INVALID_FILE_NAME: must match recording_*.json pattern");
  }
  return name;
}

export function generateRecordingFileName() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `recording_${ts}.json`;
}

export function validateEventsJson(eventsJson) {
  let parsed;
  try {
    parsed = JSON.parse(eventsJson);
  } catch {
    throw new Error("INVALID_RECORDING_FORMAT: events_json is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("INVALID_RECORDING_FORMAT: events_json must be an object");
  }
  if (typeof parsed.version !== "number" || !Array.isArray(parsed.events)) {
    throw new Error("INVALID_RECORDING_FORMAT: must contain version (number) and events (array)");
  }
  if (parsed.events.length > MAX_RECORDING_EVENTS) {
    throw new Error(`INVALID_RECORDING_FORMAT: events array exceeds ${MAX_RECORDING_EVENTS} entries (got ${parsed.events.length}) — potential DoS`);
  }
  return parsed;
}

// ─── GDScript generators ─────────────────────────────────────────────────────

export function genRecordingSaveScript(fileName, eventsJsonEscaped) {
  return `${SCENE_TREE_HEADER}
func _initialize():
\tvar dir: DirAccess = DirAccess.open("res://")
\tif dir == null:
\t\t_mcp_output("error", "Failed to access res:// directory")
\t\t_mcp_done()
\t\treturn
\tif not dir.dir_exists("recordings"):
\t\tdir.make_dir("recordings")
\tvar file: FileAccess = FileAccess.open("res://recordings/${fileName}", FileAccess.WRITE)
\tif file == null:
\t\t_mcp_output("error", "Failed to open file for writing: res://recordings/${fileName}")
\t\t_mcp_done()
\t\treturn
\tvar events_data: String = JSON.stringify(JSON.parse_string("${eventsJsonEscaped}"))
\tif events_data == "":
\t\t_mcp_output("error", "Invalid events JSON")
\t\t_mcp_done()
\t\treturn
\tfile.store_string(events_data)
\tfile.close()
\t_mcp_output("saved", {"file_name": "${fileName}", "path": "res://recordings/${fileName}"})
\t_mcp_done()
`;
}

export function genRecordingLoadScript(fileName) {
  return `${SCENE_TREE_HEADER}
func _initialize():
\tvar file: FileAccess = FileAccess.open("res://recordings/${fileName}", FileAccess.READ)
\tif file == null:
\t\t_mcp_output("error", "File not found: res://recordings/${fileName}")
\t\t_mcp_done()
\t\treturn
\tvar content: String = file.get_as_text()
\tfile.close()
\tvar parsed: Variant = JSON.parse_string(content)
\tif parsed == null:
\t\t_mcp_output("error", "Invalid JSON in recording file: ${fileName}")
\t\t_mcp_done()
\t\treturn
\t_mcp_output("recording", parsed)
\t_mcp_done()
`;
}

export function genRecordingPlayScript(eventsJsonEscaped, speed) {
  return `${SCENE_TREE_HEADER}
var _mcp_played: int = 0
var _mcp_errors: Array = []

func _initialize():
\tvar parsed: Variant = JSON.parse_string("${eventsJsonEscaped}")
\tif parsed == null or not (parsed is Dictionary) or not parsed.has("events"):
\t\t_mcp_output("error", "Invalid events JSON")
\t\t_mcp_done()
\t\treturn
\tvar events: Array = parsed["events"]
\tif events.size() > ${MAX_RECORDING_EVENTS}:
\t\t_mcp_output("error", "Too many events")
\t\t_mcp_done()
\t\treturn
\tvar last_time: float = 0.0
\tfor evt in events:
\t\tif not (evt is Dictionary):
\t\t\tcontinue
\t\tvar t: float = float(evt.get("time_offset", evt.get("time_ms", evt.get("timestamp_ms", 0))))
\t\tif last_time > 0.0:
\t\t\tvar delay_ms: float = clamp((t - last_time) / ${speed}, 16.0, 10000.0)
\t\t\tvar wait_frames: int = max(1, int(ceil(delay_ms / 16.0)))
\t\t\tfor _w in range(wait_frames):
\t\t\t\tawait process_frame
\t\tlast_time = t
\t\t_replay_event(evt)
\t_mcp_output("result", {"status": "ok" if _mcp_errors.is_empty() else "partial", "events_played": _mcp_played, "total_events": events.size(), "errors": _mcp_errors})
\t_mcp_done()

func _replay_event(evt: Dictionary) -> void:
\tvar evt_type: String = str(evt.get("type", ""))
\tmatch evt_type:
\t\t"key":
\t\t\tvar keycode: int = int(evt.get("keycode", 0))
\t\t\tvar ie := InputEventKey.new()
\t\t\tie.keycode = keycode
\t\t\tie.pressed = bool(evt.get("pressed", true))
\t\t\tInput.parse_input_event(ie)
\t\t\t_mcp_played += 1
\t\t"mouse_click":
\t\t\tvar pos = evt.get("position", evt.get("pos", [0, 0]))
\t\t\tvar me := InputEventMouseButton.new()
\t\t\tme.position = Vector2(float(pos[0]), float(pos[1]))
\t\t\tme.button_index = int(evt.get("button", 1))
\t\t\tme.pressed = bool(evt.get("pressed", true))
\t\t\tInput.parse_input_event(me)
\t\t\t_mcp_played += 1
\t\t"mouse_move":
\t\t\tvar pos2 = evt.get("position", evt.get("pos", [0, 0]))
\t\t\tvar mm := InputEventMouseMotion.new()
\t\t\tmm.position = Vector2(float(pos2[0]), float(pos2[1]))
\t\t\tInput.parse_input_event(mm)
\t\t\t_mcp_played += 1
\t\t"touch":
\t\t\tvar pos3 = evt.get("position", evt.get("pos", [0, 0]))
\t\t\tvar te := InputEventScreenTouch.new()
\t\t\tte.position = Vector2(float(pos3[0]), float(pos3[1]))
\t\t\tte.pressed = bool(evt.get("pressed", true))
\t\t\tte.index = int(evt.get("index", 0))
\t\t\tInput.parse_input_event(te)
\t\t\t_mcp_played += 1
\t\t"touch_drag":
\t\t\tvar pos4 = evt.get("position", evt.get("pos", [0, 0]))
\t\t\tvar td := InputEventScreenDrag.new()
\t\t\ttd.position = Vector2(float(pos4[0]), float(pos4[1]))
\t\t\ttd.index = int(evt.get("index", 0))
\t\t\tvar rel = evt.get("relative", [0, 0])
\t\t\ttd.relative = Vector2(float(rel[0]), float(rel[1]))
\t\t\tInput.parse_input_event(td)
\t\t\t_mcp_played += 1
\t\t_:
\t\t\t_mcp_errors.append("Unknown event type: " + evt_type)
`;
}

// ─── Tool definitions ────────────────────────────────────────────────────────

export const tools = [
  {
    name: "recording_start",
    description: `Start an input recording session (session marker file under traceDir/recordings). Live in-game capture requires the Wave 2 in-editor bridge (ctx.bridge), which is not yet available — this records session timing only.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        session_name: { type: "string", description: "Optional session label" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "recording_stop",
    description: "Stop an active recording session and finalize its timing marker.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "recording_save",
    description: "Save an events JSON (version + events array) to res://recordings/recording_<timestamp>.json inside the project.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        events_json: { type: "string", description: "JSON string with {version: number, events: array}" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "events_json"],
    },
  },
  {
    name: "recording_load",
    description: "Load a recording file from res://recordings/recording_*.json.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        file_name: { type: "string", description: "Recording file name (recording_*.json)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "file_name"],
    },
  },
  {
    name: "recording_play",
    description: `Replay an events JSON headlessly by injecting InputEvents via Input.parse_input_event with inter-event timing (speed multiplier supported). Upstream's bridge-based playback is deferred (no bridge in harness).${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        events_json: { type: "string", description: "JSON string with {version: number, events: array}" },
        speed: { type: "number", description: "Playback speed multiplier (default 1.0)", default: 1.0 },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "events_json"],
    },
  },
];

// ─── Session state helpers (traceDir file memory) ────────────────────────────

function sessionFile(ctx) {
  return path.join(ctx.traceDir, "recordings", "active-session.json");
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handle(toolName, args, ctx) {
  try {
    switch (toolName) {
      case "recording_start": {
        requireProjectPath(args);
        const file = sessionFile(ctx);
        if (fs.existsSync(file)) {
          const existing = JSON.parse(fs.readFileSync(file, "utf8"));
          if (existing.active) {
            return opsErrorResult("RECORDING_IN_PROGRESS", "A recording session is already active. Call recording_stop first.");
          }
        }
        ensureDir(file);
        const session = { active: true, started_at: new Date().toISOString(), label: args.session_name ?? null };
        writeAtomic(file, JSON.stringify(session, null, 2));
        return textResult(JSON.stringify({ success: true, session, note: "Live in-game capture requires the Wave 2 in-editor bridge (not yet available); this records session timing only." }, null, 2));
      }
      case "recording_stop": {
        requireProjectPath(args);
        const file = sessionFile(ctx);
        if (!fs.existsSync(file)) {
          return opsErrorResult("NO_RECORDING", "No active recording session.");
        }
        const session = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!session.active) {
          return opsErrorResult("NO_RECORDING", "No active recording session.");
        }
        session.active = false;
        session.stopped_at = new Date().toISOString();
        session.duration_ms = Date.parse(session.stopped_at) - Date.parse(session.started_at);
        writeAtomic(file, JSON.stringify(session, null, 2));
        return textResult(JSON.stringify({ success: true, session }, null, 2));
      }
      case "recording_save": {
        const projectPath = requireProjectPath(args);
        const eventsJson = args.events_json;
        if (!eventsJson || typeof eventsJson !== "string") {
          return opsErrorResult("INVALID_RECORDING_FORMAT", "events_json must be a non-empty JSON string");
        }
        try { validateEventsJson(eventsJson); } catch (e) {
          return opsErrorResult("INVALID_RECORDING_FORMAT", e.message);
        }
        const fileName = generateRecordingFileName();
        resolveWithinRoot(projectPath, `recordings/${fileName}`);
        const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
        const script = genRecordingSaveScript(fileName, gdEscape(eventsJson));
        const result = await executeGdscript({ godotPath: godot, projectPath, code: script, timeout: 30, trusted: true });
        return parseGdscriptResult(result, {
          mapError: (msg) => {
            if (msg.includes("not found")) return "RECORDING_FILE_NOT_FOUND";
            if (msg.includes("Invalid")) return "INVALID_RECORDING_FORMAT";
            return "SCRIPT_EXEC_FAILED";
          },
        });
      }
      case "recording_load": {
        const projectPath = requireProjectPath(args);
        const rawName = String(args.file_name ?? "");
        if (!rawName) return opsErrorResult("INVALID_FILE_NAME", "file_name is required");
        let safeName;
        try { safeName = sanitizeRecordingFileName(rawName); } catch (e) {
          return opsErrorResult("INVALID_FILE_NAME", e.message);
        }
        resolveWithinRoot(projectPath, `recordings/${safeName}`);
        const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
        const result = await executeGdscript({ godotPath: godot, projectPath, code: genRecordingLoadScript(safeName), timeout: 30, trusted: true });
        return parseGdscriptResult(result, {
          mapError: (msg) => {
            if (msg.includes("not found") || msg.includes("File not found")) return "RECORDING_FILE_NOT_FOUND";
            if (msg.includes("Invalid")) return "INVALID_RECORDING_FORMAT";
            return "SCRIPT_EXEC_FAILED";
          },
        });
      }
      case "recording_play": {
        const projectPath = requireProjectPath(args);
        const eventsJson = args.events_json;
        if (!eventsJson || typeof eventsJson !== "string") {
          return opsErrorResult("INVALID_RECORDING_FORMAT", "events_json must be a non-empty JSON string");
        }
        let validated;
        try { validated = validateEventsJson(eventsJson); } catch (e) {
          return opsErrorResult("INVALID_RECORDING_FORMAT", e.message);
        }
        const speed = typeof args.speed === "number" && Number.isFinite(args.speed) && args.speed > 0 ? args.speed : 1.0;
        const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
        const result = await executeGdscript({
          godotPath: godot,
          projectPath,
          code: genRecordingPlayScript(gdEscape(eventsJson), speed),
          timeout: 120,
          trusted: true,
        });
        void validated;
        return parseGdscriptResult(result, { mapError: () => "PLAYBACK_FAILED" });
      }
      default:
        return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
    }
  } catch (err) {
    const msg = err.message;
    if (msg.includes("INVALID_FILE_NAME") || msg.includes("traversal")) return opsErrorResult("INVALID_FILE_NAME", msg);
    return opsErrorResult("INVALID_PARAMS", msg);
  }
}
