import fs from "node:fs";
import path from "node:path";
import { opsErrorResult, textResult, gdEscape } from "../util.js";
import { requireProjectPath, resolveWithinRoot, normalizeUserProjectPath } from "../path-utils.js";
import { resolveGodotPath, spawnGodot } from "../godot-process.js";
import { executeGdscript, parseGdscriptResult } from "../gdscript.js";
import { HEADER } from "./navigation.js";

const VALID_ASSERTIONS = new Set(["node_exists", "property_equals", "signal_connected", "node_count"]);

const STRESS_SAFE_TYPES = new Set([
  "Node", "Node2D", "Node3D", "Control", "CanvasItem",
  "CharacterBody2D", "CharacterBody3D", "RigidBody2D", "RigidBody3D",
  "StaticBody2D", "StaticBody3D", "AnimatableBody2D", "AnimatableBody3D",
  "Area2D", "Area3D", "PhysicsBody2D", "PhysicsBody3D",
  "Sprite2D", "Sprite3D", "MeshInstance3D", "Camera2D", "Camera3D",
  "Label", "Button", "Panel", "BoxContainer", "HBoxContainer", "VBoxContainer",
  "MarginContainer", "ScrollContainer", "GridContainer",
  "CollisionShape2D", "CollisionShape3D", "CollisionPolygon2D", "CollisionPolygon3D",
  "AudioStreamPlayer", "AudioStreamPlayer2D", "AudioStreamPlayer3D",
  "Timer", "Tween",
]);

export function genTestAssertScript({ assertionType, path: nodePath, property, expected, signalName, targetPath, methodName, parentPath, count }) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar _root = _mcp_get_root()
\tif _root == null:
\t\t_mcp_output("error", "Scene root not available")
\t\t_mcp_done()
\t\treturn
\tvar _path = "${gdEscape(nodePath ?? "")}"
\tmatch "${gdEscape(assertionType)}":
\t\t"node_exists":
\t\t\tvar _n = _mcp_get_node(_path)
\t\t\tif _n != null:
\t\t\t\t_mcp_output("result", JSON.stringify({"passed": true, "message": "Node exists: " + _path}))
\t\t\telse:
\t\t\t\t_mcp_output("result", JSON.stringify({"passed": false, "message": "Node not found: " + _path}))
\t\t"property_equals":
\t\t\tvar _n = _mcp_get_node(_path)
\t\t\tif _n == null:
\t\t\t\t_mcp_output("result", JSON.stringify({"passed": false, "message": "Node not found: " + _path}))
\t\t\telse:
\t\t\t\tvar _prop = "${gdEscape(property ?? "")}"
\t\t\t\tvar _val = str(_n.get(_prop))
\t\t\t\tvar _expected = "${gdEscape(String(expected ?? ""))}"
\t\t\t\tvar _match = _val == _expected
\t\t\t\t_mcp_output("result", JSON.stringify({"passed": _match, "message": "%s.%s = %s (expected: %s)" % [_path, _prop, _val, _expected], "actual": _val}))
\t\t"signal_connected":
\t\t\tvar _src = _mcp_get_node(_path)
\t\t\tvar _tgt = _mcp_get_node("${gdEscape(targetPath ?? "")}")
\t\t\tif _src == null or _tgt == null:
\t\t\t\t_mcp_output("result", JSON.stringify({"passed": false, "message": "Source or target node not found"}))
\t\t\telse:
\t\t\t\tvar _connected = _src.is_connected("${gdEscape(signalName ?? "")}", Callable(_tgt, "${gdEscape(methodName ?? "")}"))
\t\t\t\t_mcp_output("result", JSON.stringify({"passed": _connected, "message": "Signal %s->%s.%s %s" % ["${gdEscape(signalName ?? "")}", "${gdEscape(targetPath ?? "")}", "${gdEscape(methodName ?? "")}", "connected" if _connected else "not connected"]}))
\t\t"node_count":
\t\t\tvar _p = _mcp_get_node("${gdEscape(parentPath ?? "")}") if "${gdEscape(parentPath ?? "")}" != "" else _root
\t\t\tif _p == null:
\t\t\t\t_mcp_output("result", JSON.stringify({"passed": false, "message": "Parent node not found: ${gdEscape(parentPath ?? "")}"}))
\t\t\telse:
\t\t\t\tvar _count = _p.get_child_count()
\t\t\t\tvar _expected = ${count ?? -1}
\t\t\t\t_mcp_output("result", JSON.stringify({"passed": _count == _expected, "message": "Children: %d (expected: %d)" % [_count, _expected], "actual": _count}))
\t\t_:
\t\t\t_mcp_output("error", "Unknown assertion type: ${gdEscape(assertionType)}")
\t_mcp_done()
`;
}

export function genTestStressScript(nodeType, iterations) {
  return `${HEADER}
func _initialize():
\t_mcp_load_main_scene()
\tvar _root = _mcp_get_root()
\tif _root == null:
\t\t_mcp_output("error", "Scene root not available")
\t\t_mcp_done()
\t\treturn
\tvar _type = "${gdEscape(nodeType)}"
\tvar _iters = ${iterations}
\tvar _obj_before = Performance.get_monitor(Performance.OBJECT_COUNT)
\tvar _mem_before = Performance.get_monitor(Performance.MEMORY_STATIC)
\tvar _peak = _mem_before
\tfor _i in range(_iters):
\t\tvar _n = ClassDB.instantiate(_type)
\t\tif _n == null:
\t\t\t_mcp_output("error", "Cannot instantiate: " + _type)
\t\t\t_mcp_done()
\t\t\treturn
\t\t_root.add_child(_n)
\t\tvar _mem = Performance.get_monitor(Performance.MEMORY_STATIC)
\t\tif _mem > _peak:
\t\t\t_peak = _mem
\t\t_n.queue_free()
\tfor _f in range(3):
\t\tawait self.process_frame
\tvar _obj_after = Performance.get_monitor(Performance.OBJECT_COUNT)
\tvar _mem_after = Performance.get_monitor(Performance.MEMORY_STATIC)
\tvar _obj_leaked = (_obj_after - _obj_before) > _iters * 0.1
\tvar _mem_leaked = _mem_after > _mem_before * 1.1
\tvar _leaked = _obj_leaked or _mem_leaked
\t_mcp_output("result", JSON.stringify({
\t\t"success": not _leaked,
\t\t"iterations": _iters,
\t\t"node_type": _type,
\t\t"object_count_before": _obj_before,
\t\t"object_count_after": _obj_after,
\t\t"memory_before": _mem_before,
\t\t"memory_after": _mem_after,
\t\t"peak_memory": _peak,
\t\t"leaked": _leaked,
\t\t"message": "Stress test %s: %d iterations" % ["PASSED" if not _leaked else "LEAKED", _iters]
\t}))
\t_mcp_done()
`;
}

// ─── Export presets (pure JS parsing of export_presets.cfg) ──────────────────

export function parseExportPresets(cfgText) {
  const presets = [];
  let current = null;
  for (const rawLine of cfgText.split("\n")) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^\[preset\.(\d+)\]$/);
    if (sectionMatch) {
      current = { index: Number(sectionMatch[1]), name: "", platform: "", runnable: false, options: {} };
      presets.push(current);
      continue;
    }
    if (line.startsWith("[") || current === null) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (key === "name") current.name = value;
    else if (key === "platform") current.platform = value;
    else if (key === "runnable") current.runnable = value === "true";
    else current.options[key] = value;
  }
  return presets;
}

// ─── Tool definitions ────────────────────────────────────────────────────────

export const tools = [
  {
    name: "run_tests",
    description: "Run a GUT test suite headlessly. Requires the GUT addon at addons/gut inside the project (clearly errors if absent).",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        test_dir: { type: "string", description: "GUT test directory relative to project (default: res://test)", default: "res://test" },
        config: { type: "string", description: "Optional .gutconfig.json path relative to project" },
        timeout: { type: "number", description: "Timeout in seconds (default 120)", default: 120 },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "test_assert",
    description: "Assert a condition on the main scene tree: node_exists, property_equals, signal_connected, or node_count.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        assertion_type: { type: "string", enum: [...VALID_ASSERTIONS], description: "Assertion type" },
        path: { type: "string", description: "Node path (node_exists/property_equals/signal_connected)" },
        property: { type: "string", description: "Property name (property_equals)" },
        expected: { description: "Expected value (property_equals)" },
        signal: { type: "string", description: "Signal name (signal_connected)" },
        target: { type: "string", description: "Target node path (signal_connected)" },
        method: { type: "string", description: "Target method name (signal_connected)" },
        parent: { type: "string", description: "Parent node path (node_count, default root)" },
        count: { type: "number", description: "Expected child count (node_count)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "assertion_type"],
    },
  },
  {
    name: "test_stress",
    description: "Stress test node create/destroy cycles for leak detection (object count and static memory before/after).",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_type: { type: "string", description: "Node type to create/destroy (default: Node)", default: "Node" },
        iterations: { type: "number", description: "Iterations (1-10000, default 100)", default: 100 },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "export_list_presets",
    description: "List export presets from the project's export_presets.cfg (pure file parsing, no Godot process).",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "export_get_preset",
    description: "Get a single export preset by name from export_presets.cfg (pure file parsing, no Godot process).",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        name: { type: "string", description: "Preset name" },
      },
      required: ["project_path", "name"],
    },
  },
  {
    name: "export_build",
    description: "Build an export preset headlessly (godot --headless --export-release). Requires export templates installed in the Godot installation.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        preset: { type: "string", description: "Export preset name" },
        output_path: { type: "string", description: "Output file path (absolute or relative to project). If omitted, uses the preset's export_path." },
        release: { type: "boolean", description: "Release build (true) or debug build (false). Default true.", default: true },
        timeout: { type: "number", description: "Timeout in seconds (default 300)", default: 300 },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "preset"],
    },
  },
];

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handle(toolName, args, ctx) {
  try {
    switch (toolName) {
      case "run_tests": {
        const projectPath = requireProjectPath(args);
        const gutScript = path.join(projectPath, "addons", "gut", "gut_cmdln.gd");
        if (!fs.existsSync(gutScript)) {
          return opsErrorResult("GUT_NOT_INSTALLED",
            "GUT addon not found at addons/gut/gut_cmdln.gd. Install GUT (https://github.com/bitwes/Gut) into the project's addons/ directory to use run_tests.");
        }
        const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
        const testDir = typeof args.test_dir === "string" && args.test_dir ? args.test_dir : "res://test";
        const timeout = Math.min(Math.max(Number(args.timeout) || 120, 10), 600);
        const gutArgs = ["--headless", "--path", projectPath, "-s", "addons/gut/gut_cmdln.gd", `-gdir=${testDir}`, "-gexit"];
        if (args.config) {
          const rel = normalizeUserProjectPath(String(args.config));
          resolveWithinRoot(projectPath, rel);
          gutArgs.push(`-gconfig=${rel}`);
        }
        const result = await spawnGodot(godot, gutArgs, { timeoutMs: timeout * 1000 });
        const out = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`;
        const summaryMatch = out.match(/(\d+)\s+passed[, ]+(\d+)\s+failed/i);
        return textResult(JSON.stringify({
          success: !result.timedOut && result.exitCode === 0,
          timed_out: result.timedOut,
          exit_code: result.exitCode,
          summary: summaryMatch ? { passed: Number(summaryMatch[1]), failed: Number(summaryMatch[2]) } : null,
          output: out.slice(-8000),
        }, null, 2));
      }
      case "test_assert": {
        const projectPath = requireProjectPath(args);
        const assertionType = String(args.assertion_type ?? "");
        if (!VALID_ASSERTIONS.has(assertionType)) {
          return opsErrorResult("INVALID_PARAMS", `Invalid assertion_type: "${assertionType}". Must be one of: ${[...VALID_ASSERTIONS].join(", ")}`);
        }
        if (assertionType === "node_count" && typeof args.count !== "number") {
          return opsErrorResult("INVALID_PARAMS", 'node_count assertion requires "count" parameter');
        }
        if (!args.path && assertionType !== "node_count") {
          return opsErrorResult("INVALID_PARAMS", `"path" is required for ${assertionType} assertion`);
        }
        const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
        const script = genTestAssertScript({
          assertionType,
          path: args.path,
          property: args.property,
          expected: args.expected,
          signalName: args.signal,
          targetPath: args.target,
          methodName: args.method,
          parentPath: args.parent,
          count: args.count,
        });
        const result = await executeGdscript({ godotPath: godot, projectPath, code: script, timeout: 30, trusted: true });
        return parseGdscriptResult(result, { mapError: () => "ASSERTION_FAILED" });
      }
      case "test_stress": {
        const projectPath = requireProjectPath(args);
        const rawType = String(args.node_type || "Node");
        if (!STRESS_SAFE_TYPES.has(rawType)) {
          return opsErrorResult("INVALID_NODE_TYPE", `node_type "${rawType}" not in stress test whitelist. Allowed: ${[...STRESS_SAFE_TYPES].join(", ")}`);
        }
        const iterations = Math.min(Math.max(Math.floor(Number(args.iterations) || 100), 1), 10000);
        const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
        const result = await executeGdscript({ godotPath: godot, projectPath, code: genTestStressScript(rawType, iterations), timeout: 120, trusted: true });
        return parseGdscriptResult(result, { mapError: () => "STRESS_TEST_FAILED" });
      }
      case "export_list_presets": {
        const projectPath = requireProjectPath(args);
        const cfgPath = path.join(projectPath, "export_presets.cfg");
        if (!fs.existsSync(cfgPath)) {
          return opsErrorResult("FILE_NOT_FOUND", "export_presets.cfg not found. Configure export presets in the Godot editor first.");
        }
        const presets = parseExportPresets(fs.readFileSync(cfgPath, "utf8"));
        return textResult(JSON.stringify({ success: true, count: presets.length, presets: presets.map((p) => ({ name: p.name, platform: p.platform, runnable: p.runnable })) }, null, 2));
      }
      case "export_get_preset": {
        const projectPath = requireProjectPath(args);
        const name = String(args.name ?? "");
        if (!name) return opsErrorResult("INVALID_PARAMS", "name is required");
        const cfgPath = path.join(projectPath, "export_presets.cfg");
        if (!fs.existsSync(cfgPath)) {
          return opsErrorResult("FILE_NOT_FOUND", "export_presets.cfg not found. Configure export presets in the Godot editor first.");
        }
        const presets = parseExportPresets(fs.readFileSync(cfgPath, "utf8"));
        const preset = presets.find((p) => p.name === name);
        if (!preset) {
          return opsErrorResult("PRESET_NOT_FOUND", `Preset "${name}" not found. Available: ${presets.map((p) => p.name).join(", ")}`);
        }
        return textResult(JSON.stringify({ success: true, preset }, null, 2));
      }
      case "export_build": {
        const projectPath = requireProjectPath(args);
        const presetName = String(args.preset ?? "");
        if (!presetName) return opsErrorResult("INVALID_PARAMS", "preset is required");
        const cfgPath = path.join(projectPath, "export_presets.cfg");
        if (!fs.existsSync(cfgPath)) {
          return opsErrorResult("FILE_NOT_FOUND", "export_presets.cfg not found. Configure export presets in the Godot editor first.");
        }
        const presets = parseExportPresets(fs.readFileSync(cfgPath, "utf8"));
        const preset = presets.find((p) => p.name === presetName);
        if (!preset) {
          return opsErrorResult("PRESET_NOT_FOUND", `Preset "${presetName}" not found. Available: ${presets.map((p) => p.name).join(", ")}`);
        }
        let outputPath = args.output_path ? String(args.output_path) : String(preset.options.export_path ?? "");
        if (!outputPath) {
          return opsErrorResult("INVALID_PARAMS", "No output_path given and preset has no export_path.");
        }
        if (!path.isAbsolute(outputPath)) {
          outputPath = path.join(projectPath, outputPath.replace(/^res:\/\//, ""));
        }
        const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
        const mode = args.release === false ? "--export-debug" : "--export-release";
        const timeout = Math.min(Math.max(Number(args.timeout) || 300, 30), 1800);
        const result = await spawnGodot(godot, ["--headless", "--path", projectPath, mode, presetName, outputPath], { timeoutMs: timeout * 1000 });
        const out = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`;
        const built = !result.timedOut && result.exitCode === 0 && fs.existsSync(outputPath);
        return textResult(JSON.stringify({
          success: built,
          timed_out: result.timedOut,
          exit_code: result.exitCode,
          preset: presetName,
          output_path: outputPath,
          note: built ? undefined : "Export failed. Common cause: export templates not installed for this Godot version.",
          output: out.slice(-4000),
        }, null, 2));
      }
      default:
        return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
    }
  } catch (err) {
    return opsErrorResult("INVALID_PARAMS", err.message);
  }
}
