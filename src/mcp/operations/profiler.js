import { opsErrorResult, gdEscape } from "../util.js";
import { resolveGodotPath } from "../godot-process.js";
import { requireProjectPath } from "../path-utils.js";
import { executeGdscript, parseGdscriptResult } from "../gdscript.js";

const NON_PERSIST = "Runtime operation: affects only the current headless execution context and is not persisted to .tscn files.";

const ACTIONS = ["snapshot", "sample", "signal_audit"];

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

export function genProfilerSnapshotScript() {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar _data: Dictionary = {}
\t_data["fps"] = Performance.get_monitor(Performance.TIME_FPS)
\t_data["process_time_ms"] = Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0
\t_data["physics_process_time_ms"] = Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0
\t_data["memory_static_mb"] = Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0
\t_data["object_count"] = int(Performance.get_monitor(Performance.OBJECT_COUNT))
\t_data["resource_count"] = int(Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT))
\t_data["node_count"] = int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT))
\t_data["orphan_node_count"] = int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
\t_data["draw_calls"] = int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
\t_data["objects_drawn"] = int(Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME))
\t_data["physics_3d_active_objects"] = int(Performance.get_monitor(Performance.PHYSICS_3D_ACTIVE_OBJECTS))
\t_data["physics_3d_collision_pairs"] = int(Performance.get_monitor(Performance.PHYSICS_3D_COLLISION_PAIRS))
\t_mcp_output("snapshot", _data)
\t_mcp_done()
`;
}

export function genProfilerSampleScript(frameCount) {
  return `${HEADER}
var _samples_process: Array = []
var _samples_physics: Array = []
var _collected: int = 0
var _frame_count: int = ${frameCount}

func _initialize():
\t_mcp_load_main_scene()

func _process(_delta: float):
\t_samples_process.append(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0)
\t_samples_physics.append(Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0)
\t_collected += 1
\tif _collected >= _frame_count:
\t\t_report()

func _stats(samples: Array) -> Dictionary:
\tvar d: Dictionary = {}
\tvar n: int = samples.size()
\tif n == 0:
\t\treturn d
\tvar sorted_s: Array = samples.duplicate()
\tsorted_s.sort()
\tvar total: float = 0.0
\tfor t in samples:
\t\ttotal += t
\td["frame_count"] = n
\td["avg_ms"] = total / float(n)
\td["min_ms"] = sorted_s[0]
\td["max_ms"] = sorted_s[n - 1]
\td["p50_ms"] = sorted_s[int(n * 0.5)]
\tvar p95_idx: int = int(n * 0.95)
\tif p95_idx >= n:
\t\tp95_idx = n - 1
\td["p95_ms"] = sorted_s[p95_idx]
\tvar p99_idx: int = int(n * 0.99)
\tif p99_idx >= n:
\t\tp99_idx = n - 1
\td["p99_ms"] = sorted_s[p99_idx]
\treturn d

func _report():
\t_mcp_output("frames", _collected)
\t_mcp_output("process", _stats(_samples_process))
\t_mcp_output("physics", _stats(_samples_physics))
\t_mcp_output("memory_static_mb", Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0)
\t_mcp_done()
`;
}

export function genSignalAuditScript(nodePath) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar _root: Node = _mcp_get_root()
\tif _root == null:
\t\t_mcp_output("error", "Scene root not found")
\t\t_mcp_done()
\t\treturn
\tvar _search_root: Node = _root
\tif "${gdEscape(nodePath)}" != "":
\t\t_search_root = _mcp_get_node("${gdEscape(nodePath)}")
\t\tif _search_root == null:
\t\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t\t_mcp_done()
\t\t\treturn
\tvar _results: Array = []
\tvar _stack: Array = [_search_root]
\twhile _stack.size() > 0:
\t\tvar _n: Node = _stack.pop_back()
\t\tvar _sig_list: Array = _n.get_signal_list()
\t\tfor _sig_info in _sig_list:
\t\t\tvar _sig_name: String = _sig_info["name"]
\t\t\tvar _conns: Array = _n.get_signal_connection_list(_sig_name)
\t\t\tfor _conn in _conns:
\t\t\t\tvar _entry: Dictionary = {}
\t\t\t\t_entry["source_path"] = str(_n.get_path()).trim_prefix("/root/")
\t\t\t\t_entry["signal_name"] = _sig_name
\t\t\t\tvar _target_obj: Object = _conn["callable"].get_object()
\t\t\t\tif _target_obj is Node:
\t\t\t\t\t_entry["target_path"] = str((_target_obj as Node).get_path()).trim_prefix("/root/")
\t\t\t\telse:
\t\t\t\t\t_entry["target_path"] = str(_target_obj)
\t\t\t\t_entry["target_method"] = _conn["callable"].get_method()
\t\t\t\t_entry["flags"] = _conn["flags"]
\t\t\t\t_results.append(_entry)
\t\tfor _c in _n.get_children():
\t\t\t_stack.append(_c)
\t_mcp_output("signal_connections", _results)
\t_mcp_output("total_count", _results.size())
\t_mcp_done()
`;
}

export const tools = [
  {
    name: "profiler",
    description: `Runtime performance profiler with actions: "snapshot" (FPS, memory, draw calls, physics stats), "sample" (frame-time sampling of process/physics over duration_ms with avg/min/max/p50/p95/p99), "signal_audit" (list all signal connections in the scene subtree). ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        action: { type: "string", enum: [...ACTIONS], description: "Profiler action: snapshot | sample | signal_audit" },
        duration_ms: { type: "number", description: "Sampling duration in milliseconds (sample action, default 1000)" },
        node_path: { type: "string", description: "Subtree root node path (signal_audit, default: whole scene)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "action"],
    },
  },
];

export async function handle(toolName, args, ctx) {
  if (toolName !== "profiler") return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);

  const action = args.action;
  if (typeof action !== "string" || !ACTIONS.includes(action)) {
    return opsErrorResult("INVALID_ACTION", `Unknown action: ${String(action)}. Supported: ${ACTIONS.join(", ")}`);
  }

  let code;
  let timeout = 30;
  switch (action) {
    case "snapshot":
      code = genProfilerSnapshotScript();
      break;
    case "sample": {
      let durationMs = 1000;
      if (args.duration_ms !== undefined) {
        const d = Number(args.duration_ms);
        if (!Number.isFinite(d) || d <= 0) {
          return opsErrorResult("INVALID_PARAMS", "duration_ms must be a positive finite number");
        }
        durationMs = Math.min(d, 30000);
      }
      const frameCount = Math.max(10, Math.min(600, Math.round(durationMs / 16.667)));
      timeout = Math.min(120, 15 + Math.ceil(frameCount / 60) * 2);
      code = genProfilerSampleScript(frameCount);
      break;
    }
    case "signal_audit": {
      let nodePath = "";
      if (args.node_path != null && String(args.node_path).trim() !== "") {
        const raw = String(args.node_path).trim();
        if (raw.includes("..")) return opsErrorResult("INVALID_PATH", `node path must not contain "..": ${raw}`);
        nodePath = raw.replace(/^\/+/, "");
      }
      code = genSignalAuditScript(nodePath);
      break;
    }
  }

  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path ?? ctx?.godotPath);
  const result = await executeGdscript({ godotPath: godot, projectPath, code, timeout, trusted: true });
  return parseGdscriptResult(result, {
    mapError: (msg) => (msg.includes("not found") ? "NODE_NOT_FOUND" : "SCRIPT_EXEC_FAILED"),
  });
}
