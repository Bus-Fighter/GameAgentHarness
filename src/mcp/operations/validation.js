import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { textResult, opsErrorResult, scanFiles, parseMcpScriptOutput } from "../util.js";
import { resolveGodotPath, spawnGodot, SCRIPTS_DIR } from "../godot-process.js";
import { requireProjectPath, resolveWithinRoot } from "../path-utils.js";
import { analyzeOutput } from "../error-analyzer.js";
import { validateSceneFileStructure } from "../tscn/validate.js";

const KNOWN_BASE_METHODS = new Set([
  "add_child", "remove_child", "get_child", "get_children", "get_child_count",
  "get_parent", "get_tree", "get_node", "find_child", "find_children",
  "has_node", "is_inside_tree", "is_node_ready", "queue_free", "free",
  "call_deferred", "set_deferred", "emit_signal", "connect", "disconnect",
  "is_connected", "get_name", "set_name",
  "_ready", "_process", "_physics_process", "_input", "_unhandled_input",
  "_unhandled_key_input", "_enter_tree", "_exit_tree",
  "position", "rotation", "scale", "visible", "modulate", "z_index",
  "get_global_mouse_position", "get_viewport", "get_viewport_rect",
  "set_process", "set_physics_process", "set_process_input",
  "draw_rect", "draw_circle", "draw_string", "draw_line", "queue_redraw",
  "get_canvas_item", "get_global_transform",
  "move_and_slide", "move_and_collide", "velocity", "floor",
  "is_on_floor", "is_on_wall", "is_on_ceiling",
  "linear_velocity", "angular_velocity", "mass",
  "gravity_scale", "apply_impulse", "apply_force",
  "get_rid", "get_region",
  "set_shader_parameter", "canvas_item",
  "wait_time", "autostart", "one_shot",
  "get_path", "resource_path", "get_resource", "duplicate",
  "is_action_pressed", "is_action_just_pressed", "is_action_just_released",
  "get_vector", "get_strength", "mouse_mode", "set_mouse_mode",
  "get_overlapping_bodies", "get_overlapping_areas",
  "monitoring", "monitorable", "collision_mask", "collision_layer",
  "set_collision_mask_value",
  "play", "stop", "pause", "seek",
  "get_current_animation_position", "current_animation", "speed_scale", "autoplay",
  "playing", "volume_db", "pitch_scale", "stream",
  "set_cell", "get_cell", "get_used_cells", "map_to_local", "local_to_map",
  "texture", "hframes", "vframes", "frame", "region_enabled", "region_rect",
  "horizontal_alignment", "vertical_alignment", "autowrap_mode",
  "bbcode_text", "append_text", "scroll_to_line",
  "start", "time_left", "paused",
  "tween_property", "tween_callback", "set_parallel", "set_trans", "set_ease",
  "get_window", "set_flag", "borderless", "transparent",
]);

const METHOD_REF_RE = /(?:\.|"|\b)([a-z_][a-z0-9_]{0,40})(?:\(|"|\.|\s|$)/gi;

export function isErrorFalsePositive(line) {
  const trimmedLine = line.trim();
  if (trimmedLine.includes("await ") && trimmedLine.includes("not found in base self")) return true;
  if (trimmedLine.includes("not found in base self") && trimmedLine.includes("ScriptBus")) return true;
  if (trimmedLine.includes("Condition") && trimmedLine.includes("is true")) return true;

  if (trimmedLine.includes("not found in base self")) {
    let match;
    METHOD_REF_RE.lastIndex = 0;
    while ((match = METHOD_REF_RE.exec(trimmedLine)) !== null) {
      if (KNOWN_BASE_METHODS.has(match[1])) return true;
    }
  }

  if (/Parse Error.*\b(_ready|_process|_physics_process|_input|_unhandled_input|_enter_tree|_exit_tree)\b/.test(trimmedLine)) {
    if (/not found in base self/.test(trimmedLine)) return true;
  }

  return false;
}

export async function batchValidateScripts(godotPath, projectPath, scriptFiles, globalTimeoutMs = 15000) {
  if (scriptFiles.length === 0) return [];

  let effectiveGodotPath = godotPath;
  if (process.platform === "win32" && !godotPath.endsWith("_console.exe")) {
    const consolePath = godotPath.replace(/\.exe$/, "_console.exe");
    if (fs.existsSync(consolePath)) effectiveGodotPath = consolePath;
  }

  const pathSep = process.platform === "win32" ? "\\" : "/";
  const relOf = (absPath) => absPath.replace(projectPath + pathSep, "");
  const scriptRels = scriptFiles.map(relOf);
  const resPaths = scriptRels.map((rel) => "res://" + rel.replace(/\\/g, "/"));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-mcp-validate-"));
  const listPath = path.join(tmpDir, `list-${randomUUID().replace(/-/g, "").substring(0, 8)}.json`).replace(/\\/g, "/");
  fs.writeFileSync(listPath, JSON.stringify(resPaths), "utf8");

  const gdSafePath = listPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const validatorCode = [
    "extends SceneTree",
    "",
    "func _initialize():",
    '\tvar tmp_path: String = "' + gdSafePath + '"',
    "\tvar f := FileAccess.open(tmp_path, FileAccess.READ)",
    "\tif f == null:",
    '\t\tprint("MCP_VALIDATE_ERROR: Cannot read script list")',
    "\t\tquit()",
    "\t\treturn",
    "\tvar json_text := f.get_as_text()",
    "\tf.close()",
    "\tvar scripts = JSON.parse_string(json_text)",
    "\tif scripts == null or not scripts is Array:",
    '\t\tprint("MCP_VALIDATE_ERROR: Invalid script list JSON")',
    "\t\tquit()",
    "\t\treturn",
    "\tfor i in range(scripts.size()):",
    "\t\tvar script_path: String = scripts[i]",
    "\t\tvar res = load(script_path)",
    "\t\tif res == null:",
    '\t\t\tprint("MCP_LOAD_NULL: " + script_path)',
    "\t\t\tcontinue",
    '\tprint("MCP_VALIDATE_DONE")',
    "\tquit()",
  ].join("\n");

  const validatorPath = path.join(tmpDir, "validator.gd");
  fs.writeFileSync(validatorPath, validatorCode, "utf8");

  const results = new Map();

  try {
    const spawnResult = await spawnGodot(effectiveGodotPath, [
      "--headless", "--path", projectPath, "--script", validatorPath,
    ], { timeoutMs: globalTimeoutMs });

    const output = spawnResult.stdout;
    const outputLines = output.split("\n");

    const infraErrors = outputLines.filter((l) => l.includes("MCP_VALIDATE_ERROR:"));
    if (infraErrors.length > 0) {
      results.set("<validator>", infraErrors.map((l) => l.trim()));
    }

    const loadNullLines = outputLines.filter((l) => l.includes("MCP_LOAD_NULL:"));
    for (const ln of loadNullLines) {
      const m = ln.match(/MCP_LOAD_NULL:\s*(res:\/\/.+)/);
      if (!m) continue;
      const nullResPath = m[1].trim();
      for (const rel of scriptRels) {
        if (nullResPath === "res://" + rel.replace(/\\/g, "/")) {
          const existing = results.get(rel);
          if (!existing || existing.length === 0) {
            results.set(rel, [`Script failed to load (returned null): ${nullResPath}. Check load-time issues (circular deps, invalid extends, missing dependency).`]);
          }
          break;
        }
      }
    }

    const validatorCompleted = outputLines.some((l) => l.includes("MCP_VALIDATE_DONE"));
    if (!validatorCompleted && infraErrors.length === 0) {
      results.set("<validator>", ["Validator process did not complete (likely timed out). Results may be incomplete."]);
    }

    let filteredCount = 0;
    let lastParseError = "";
    for (const line of outputLines) {
      const trimmed = line.trim();
      if (trimmed.includes("Parse Error:")) {
        if (isErrorFalsePositive(trimmed)) {
          filteredCount += 1;
          lastParseError = "";
        } else {
          lastParseError = trimmed;
        }
      } else if (trimmed.startsWith("at:") && trimmed.includes("res://") && lastParseError) {
        for (const rel of scriptRels) {
          if (trimmed.includes("res://" + rel.replace(/\\/g, "/") + ":")) {
            if (!results.has(rel)) results.set(rel, []);
            const errors = results.get(rel);
            if (!errors.includes(lastParseError)) {
              errors.push(lastParseError);
            }
            break;
          }
        }
        lastParseError = "";
      }
    }

    const finalResults = Array.from(results.entries()).map(([file, errors]) => ({ file, errors }));
    if (filteredCount > 0) {
      if (finalResults.length > 0) {
        finalResults[0].filtered_count = filteredCount;
      } else {
        finalResults.push({ file: "<filtered>", errors: [], filtered_count: filteredCount });
      }
    }
    return finalResults;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

const API_PITFALL_RULES = [
  {
    pattern: /\.(direction|gravity|emission_box_extents)\s*=\s*Vector2\s*\(/,
    message: "Property requires Vector3, not Vector2. In Godot 4.x, ParticleProcessMaterial.direction/gravity/emission_box_extents all take Vector3.",
  },
  {
    pattern: /\.color_ramp\s*=\s*Gradient\.new\s*\(\s*\)/,
    message: "color_ramp requires GradientTexture1D, not a bare Gradient. Wrap it: var tex := GradientTexture1D.new(); tex.gradient = grad; mat.color_ramp = tex",
  },
  {
    pattern: /extends\s+RefCounted/,
    message: 'RefCounted cannot call add_child(). If you need SubViewport or child nodes, use "extends Node" instead.',
    condition: (content) => /SubViewport|add_child|get_texture|get_image|queue_free/.test(content),
  },
  {
    pattern: /^\s*seed\s*\(\s*\d+\s*\)/m,
    message: "seed() affects ALL subsequent random calls globally. Consider using RandomNumberGenerator with .seed = value instead to isolate randomness.",
  },
  {
    pattern: /\.queue_free\s*\(\s*\)\s*(?:\r?\n[^\n]*){0,2}\r?\n[^\n]*\.queue_free\s*\(\s*\)/,
    message: "queue_free() appears to be called twice on the same object (likely a copy-paste error).",
  },
  {
    pattern: /EMISSION_SHAPE_RECTANGLE/,
    message: "EMISSION_SHAPE_RECTANGLE does not exist in Godot 4.x. Use EMISSION_SHAPE_BOX for 3D box emission.",
  },
];

function scanForCommonPitfalls(content) {
  const codeOnly = content.split(/\r?\n/).filter((l) => !l.trimStart().startsWith("#")).join("\n");
  const warnings = [];
  for (const rule of API_PITFALL_RULES) {
    if (rule.pattern.test(codeOnly)) {
      if (rule.condition && !rule.condition(codeOnly)) continue;
      warnings.push(rule.message);
    }
  }
  return warnings;
}

export const tools = [
  {
    name: "run_and_verify",
    description: "Run a Godot project headlessly for a fixed duration and analyze all stdout/stderr for errors, warnings, and headless limitations. Returns a structured analysis with actionable fix suggestions.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene: { type: "string", description: "Optional scene path to run instead of the main scene" },
        timeout: { type: "number", description: "Timeout in seconds (default: 20, max: 120)", default: 20 },
        capture_tree: { type: "boolean", description: "Also capture the scene tree after running (requires scene)", default: false },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "analyze_error",
    description: "Analyze raw Godot output text (stdout/stderr) and return structured errors, warnings, and actionable fix suggestions.",
    inputSchema: {
      type: "object",
      properties: {
        output: { type: "string", description: "Raw Godot output text to analyze" },
      },
      required: ["output"],
    },
  },
  {
    name: "validate_scripts",
    description: "Batch-validate GDScript files in the project using a headless Godot parse pass. Returns per-file error lists with false-positive filtering for known base-class methods.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scripts: { type: "array", items: { type: "string" }, description: "Optional list of script paths relative to project. Defaults to all .gd files." },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "validate_project",
    description: "Validate a Godot project without running it: checks project.godot presence, missing resource references in scenes, scene file structure, script pitfalls, and shader syntax.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        check_resources: { type: "boolean", description: "Check missing resource references (default: true)", default: true },
        check_scripts: { type: "boolean", description: "Check script pitfalls (default: true)", default: true },
        check_scenes: { type: "boolean", description: "Check scene file structure (default: true)", default: true },
        exclude_paths: { type: "array", items: { type: "string" }, description: "Directories to exclude (default: .godot, .import)" },
      },
      required: ["project_path"],
    },
  },
];

function readAutoloadNames(projectPath) {
  try {
    const configPath = path.join(projectPath, "project.godot");
    if (!fs.existsSync(configPath)) return {};
    const content = fs.readFileSync(configPath, "utf8");
    const names = [];
    let inAutoload = false;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[")) {
        inAutoload = trimmed === "[autoload]";
        continue;
      }
      if (inAutoload) {
        const kv = trimmed.match(/^(\S+)\s*=/);
        if (kv) names.push(kv[1]);
      }
    }
    const classCachePath = path.join(projectPath, ".godot", "global_script_class_cache.cfg");
    let classNames = [];
    if (fs.existsSync(classCachePath)) {
      const cacheContent = fs.readFileSync(classCachePath, "utf8");
      classNames = [...cacheContent.matchAll(/"class":\s*&?"(\w+)"/g)].map((m) => m[1]);
    }
    return { autoloadNames: names, classNames };
  } catch {
    return {};
  }
}

function validateShaderFile(filePath, relPath) {
  const errors = [];
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return { errors: [`Cannot read shader file: ${relPath}`] };
  }
  const lines = content.split("\n");
  const hasShaderType = lines.some((l) => /^\s*shader_type\s+\w+\s*;/.test(l));
  if (!hasShaderType) {
    errors.push('Missing shader_type declaration (e.g. "shader_type canvas_item;" or "shader_type spatial;")');
  }
  const varyings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const lineNum = i + 1;
    if (/^uniform\s+\w+\s*;\s*$/.test(line)) {
      errors.push(`Line ${lineNum}: uniform missing type (e.g. "uniform float name;")`);
    }
    const vm = line.match(/^varying\s+\w+\s+(\w+)/);
    if (vm) {
      if (varyings.includes(vm[1])) {
        errors.push(`Line ${lineNum}: Duplicate varying declaration: ${vm[1]}`);
      }
      varyings.push(vm[1]);
    }
  }
  return { errors };
}

export async function handle(toolName, args, ctx) {
  switch (toolName) {
    case "run_and_verify": {
      const projectPath = requireProjectPath(args);
      const timeout = Math.min(Math.max(Number(args.timeout) || 20, 5), 120);
      const scene = args.scene;
      const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);

      const cmdArgs = ["--headless", "--path", projectPath];
      if (scene) cmdArgs.push(String(scene));

      const precheckErrors = [];
      try {
        const allScripts = scanFiles(projectPath, [".gd"]);
        const scriptsToCheck = allScripts.slice(0, 10);
        if (scriptsToCheck.length > 0) {
          precheckErrors.push(...await batchValidateScripts(godot, projectPath, scriptsToCheck, 15000));
        }
      } catch {}

      const result = await spawnGodot(godot, cmdArgs, { timeoutMs: timeout * 1000 });
      const allOutput = [...result.stdout.split("\n"), ...result.stderr.split("\n")];
      const analysis = analyzeOutput(allOutput, readAutoloadNames(projectPath));

      if (precheckErrors.length > 0) analysis.precheck_errors = precheckErrors;
      if (result.timedOut) {
        analysis.summary += `\nNote: Process timed out (killed) after ${timeout}s - normal for interactive projects. hasErrors/analysis reflect ALL stdout/stderr captured during the full [0, ${timeout}s] run window.`;
      } else if (result.exitCode !== 0 && result.exitCode !== null) {
        analysis.summary += `\nNote: Process exited with code ${result.exitCode}.`;
      }
      analysis.sample_window = {
        timed_out: result.timedOut,
        duration_seconds: timeout,
        coverage: "full run window - all stdout/stderr analyzed",
      };

      if (args.capture_tree === true && scene) {
        try {
          const treeScript = path.join(SCRIPTS_DIR, "query_scene_tree.gd");
          if (fs.existsSync(treeScript)) {
            const treeResult = await spawnGodot(godot, [
              "--headless", "--path", projectPath,
              "--script", treeScript,
              JSON.stringify({ scene_path: String(scene), max_depth: 3 }),
            ], { timeoutMs: 30000 });
            if (treeResult.stdout) {
              analysis.scene_tree = parseMcpScriptOutput(treeResult.stdout, 0);
            }
          }
        } catch {}
      }

      return textResult(JSON.stringify(analysis, null, 2));
    }

    case "analyze_error": {
      const outputText = args.output;
      if (typeof outputText !== "string" || !outputText.trim()) {
        return opsErrorResult("INVALID_PARAMS", '"output" parameter is required and must not be empty.');
      }
      const analysis = analyzeOutput(outputText.split("\n"));
      return textResult(JSON.stringify(analysis, null, 2));
    }

    case "validate_scripts": {
      const projectPath = requireProjectPath(args);
      const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
      let scriptFiles;
      if (Array.isArray(args.scripts) && args.scripts.length > 0) {
        scriptFiles = args.scripts.map((s) => resolveWithinRoot(projectPath, String(s)));
      } else {
        scriptFiles = scanFiles(projectPath, [".gd"]);
      }
      if (scriptFiles.length === 0) {
        return textResult(JSON.stringify({ valid: true, files_checked: 0, results: [] }, null, 2));
      }
      const results = await batchValidateScripts(godot, projectPath, scriptFiles, 30000);
      const withErrors = results.filter((r) => r.errors.length > 0);
      return textResult(JSON.stringify({
        valid: withErrors.length === 0,
        files_checked: scriptFiles.length,
        files_with_errors: withErrors.length,
        results,
      }, null, 2));
    }

    case "validate_project": {
      const projectPath = requireProjectPath(args);
      const checkResources = args.check_resources !== false;
      const checkScripts = args.check_scripts !== false;
      const checkScenes = args.check_scenes !== false;
      const excludePaths = Array.isArray(args.exclude_paths) && args.exclude_paths.every((s) => typeof s === "string")
        ? args.exclude_paths
        : [".godot", ".import"];

      const issues = [];
      const collect = (exts) => scanFiles(projectPath, exts, { skipDirs: excludePaths })
        .filter((f) => !fs.existsSync(path.join(path.dirname(f), ".gdignore")));
      const relOf = (absPath) => path.relative(projectPath, absPath);

      if (!fs.existsSync(path.join(projectPath, "project.godot"))) {
        issues.push({ severity: "critical", category: "project", message: "project.godot not found" });
        return textResult(JSON.stringify({ valid: false, issue_count: issues.length, issues }, null, 2));
      }

      if (checkResources || checkScenes) {
        for (const sceneFile of collect([".tscn"])) {
          const rel = relOf(sceneFile);
          const content = fs.readFileSync(sceneFile, "utf8");

          if (checkScenes) {
            for (const err of validateSceneFileStructure(content, rel)) {
              issues.push({ severity: "error", category: "scene_structure", message: err, file: rel });
            }
          }

          if (checkResources) {
            const extResRegex = /\[ext_resource[^[]*path="([^"]+)"/g;
            let match;
            while ((match = extResRegex.exec(content)) !== null) {
              const resPath = match[1];
              if (!resPath.startsWith("res://")) continue;
              const absPath = resolveWithinRoot(projectPath, resPath.replace("res://", ""));
              if (!fs.existsSync(absPath)) {
                issues.push({ severity: "error", category: "missing_resource", message: `Referenced resource not found: ${resPath}`, file: rel });
              }
            }

            const texRefRegex = /^[^;]*texture\s*=\s*ExtResource\("([^"]+)"\)/gm;
            while ((match = texRefRegex.exec(content)) !== null) {
              const refId = match[1];
              const defRegex = new RegExp(`\\[ext_resource[^\\]]*id="${refId}"`, "s");
              if (!defRegex.test(content)) {
                issues.push({ severity: "error", category: "missing_resource", message: `Texture references undefined ext_resource id: "${refId}"`, file: rel });
              }
            }
          }
        }
      }

      if (checkScripts) {
        for (const scriptFile of collect([".gd"])) {
          const rel = relOf(scriptFile);
          const content = fs.readFileSync(scriptFile, "utf8");
          for (const warning of scanForCommonPitfalls(content)) {
            issues.push({ severity: "warning", category: "script_pitfall", message: warning, file: rel });
          }
        }
        for (const shaderFile of collect([".gdshader", ".shader"])) {
          const rel = relOf(shaderFile);
          for (const err of validateShaderFile(shaderFile, rel).errors) {
            issues.push({ severity: "error", category: "shader_syntax", message: err, file: rel });
          }
        }
      }

      return textResult(JSON.stringify({
        valid: issues.filter((i) => i.severity === "error" || i.severity === "critical").length === 0,
        issue_count: issues.length,
        issues,
      }, null, 2));
    }

    default:
      return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  }
}
