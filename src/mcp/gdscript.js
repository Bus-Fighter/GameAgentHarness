import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawnGodot, forceKillTree } from "./godot-process.js";
import { scanGdscriptSandbox } from "./guard.js";
import { analyzeOutput } from "./error-analyzer.js";
import { MARKER_RESULT, MARKER_ERROR } from "./util.js";

function generateMarker() {
  return `__MCP_${randomUUID().replace(/-/g, "").substring(0, 16)}__`;
}

export function isFullClass(code) {
  return /^\s*extends\s+/m.test(code);
}

function normalizeIndentToTabs(text) {
  return text.split("\n").map((line) => {
    const match = line.match(/^ +/);
    if (!match) return line;
    const spaces = match[0].length;
    const tabs = "\t".repeat(Math.floor(spaces / 4)) + " ".repeat(spaces % 4);
    return tabs + line.slice(spaces);
  }).join("\n");
}

function classifyLines(code) {
  const lines = code.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const declarationLines = [];
  const statementLines = [];
  let inFuncBody = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (inFuncBody) declarationLines.push(line);
      continue;
    }
    if (trimmed.startsWith("#") && !inFuncBody) {
      declarationLines.push(line);
      continue;
    }
    if (/^[^\t ]/.test(line) && /^(func |static func |var |const |signal |enum |class_name |@export|@onready|@icon|@warning)/.test(trimmed)) {
      declarationLines.push(line);
      if (/^(static )?func /.test(trimmed)) inFuncBody = true;
      if (/=\s*func\s*\(.*\)\s*:\s*$/.test(trimmed)) inFuncBody = true;
      continue;
    }
    if (inFuncBody) {
      if (/^[^\t ]/.test(line) && !trimmed.startsWith("#")) {
        inFuncBody = false;
      } else {
        declarationLines.push(line);
        continue;
      }
    }
    statementLines.push(line);
  }

  return { declarationLines, statementLines };
}

const GD_MCP_OUTPUT = [
  "func _mcp_output(key: String, value: Variant) -> void:",
  "\t_mcp_outputs.append({\"key\": key, \"value\": str(value)})",
];

const GD_MCP_GET_ROOT = [
  "func _mcp_get_root() -> Node:",
  "\tif _mcp_root != null:",
  "\t\treturn _mcp_root",
  "\tif root != null:",
  "\t\t_mcp_root = root",
  "\t\treturn _mcp_root",
  "\treturn null",
];

const GD_MCP_GET_NODE = [
  "func _mcp_get_node(path: String) -> Node:",
  "\tvar r = _mcp_get_root()",
  "\tif r == null:",
  "\t\treturn null",
  "\tvar clean = path",
  "\tif clean == \"root\" or clean == \"/root\" or clean == \".\":",
  "\t\treturn r",
  "\tif clean.begins_with(\"/root/\"):",
  "\t\tclean = clean.substr(6)",
  "\tif clean.begins_with(\"root/\"):",
  "\t\tclean = clean.substr(5)",
  "\tif clean == str(r.name):",
  "\t\treturn r",
  "\treturn r.get_node_or_null(clean)",
];

const GD_MCP_LOAD_SCENE = [
  "var _mcp_scene_instance: Node = null",
  "func _mcp_load_scene(abs_path: String) -> bool:",
  "\tvar packed = load(abs_path)",
  "\tif packed == null:",
  "\t\t_mcp_output(\"error\", \"Failed to load scene: \" + abs_path)",
  "\t\treturn false",
  "\t_mcp_scene_instance = packed.instantiate()",
  "\tif _mcp_scene_instance == null:",
  "\t\t_mcp_output(\"error\", \"Failed to instantiate scene: \" + abs_path)",
  "\t\treturn false",
  "\treturn true",
  "func _mcp_get_scene_node(path: String) -> Node:",
  "\tif _mcp_scene_instance == null:",
  "\t\treturn null",
  "\tvar clean = path",
  "\tif clean == \"root\" or clean == \"/root\" or clean == \".\":",
  "\t\treturn _mcp_scene_instance",
  "\tif clean.begins_with(\"root/\"):",
  "\t\tclean = clean.substr(5)",
  "\tif clean == str(_mcp_scene_instance.name):",
  "\t\treturn _mcp_scene_instance",
  "\treturn _mcp_scene_instance.get_node_or_null(clean)",
];

export const SCENE_TREE_HEADER = [
  "extends SceneTree",
  "var _mcp_outputs: Array = []",
  "var _mcp_root: Node = null",
  "",
  ...GD_MCP_GET_ROOT,
  "",
  ...GD_MCP_GET_NODE,
  "",
  ...GD_MCP_LOAD_SCENE,
  "",
  ...GD_MCP_OUTPUT,
].join("\n");

export function wrapSnippet(code, resultMarker = MARKER_RESULT) {
  const { declarationLines, statementLines } = classifyLines(normalizeIndentToTabs(code));

  const scriptLines = [
    "extends SceneTree",
    "var _mcp_outputs: Array = []",
    "var _mcp_root: Node = null",
    "",
    ...GD_MCP_GET_ROOT,
    "",
    ...GD_MCP_GET_NODE,
    "",
    ...GD_MCP_OUTPUT,
    "",
    "func _mcp_done() -> void:",
    "\tprint(\"" + resultMarker + "\" + JSON.stringify({\"success\": true, \"outputs\": _mcp_outputs}))",
    "\tif Engine.get_main_loop() == self:",
    "\t\tquit(0)",
  ];

  if (declarationLines.length > 0) {
    scriptLines.push("", ...declarationLines, "");
  }

  scriptLines.push("func _initialize():");
  if (statementLines.length > 0) {
    for (const line of statementLines) {
      scriptLines.push("\t" + line);
    }
  }
  scriptLines.push(
    "\tprint(\"" + resultMarker + "\" + JSON.stringify({\"success\": true, \"outputs\": _mcp_outputs}))",
    "\tif Engine.get_main_loop() == self:",
    "\t\tquit(0)",
  );

  return scriptLines.join("\n") + "\n";
}

export function injectHelpers(code, resultMarker = MARKER_RESULT) {
  const lines = code.split("\n");
  const extendsIdx = lines.findIndex((l) => /^\s*extends\s+/.test(l));

  const hasOutputsVar = lines.some((l) => /^\s*var\s+_mcp_outputs\s*:/.test(l) && !l.trim().startsWith("#"));
  const hasOutputFunc = lines.some((l) => /^\s*func\s+_mcp_output\s*\(/.test(l) && !l.trim().startsWith("#"));
  const hasDoneFunc = lines.some((l) => /^\s*func\s+_mcp_done\s*\(/.test(l) && !l.trim().startsWith("#"));

  const helperLines = [""];
  if (!hasOutputsVar) helperLines.push("var _mcp_outputs: Array = []", "");
  if (!hasOutputFunc) helperLines.push(...GD_MCP_OUTPUT, "");
  if (!hasDoneFunc) {
    helperLines.push(
      "func _mcp_done() -> void:",
      "\tprint(\"" + resultMarker + "\" + JSON.stringify({\"success\": true, \"outputs\": _mcp_outputs}))",
      "\tif Engine.get_main_loop() == self:",
      "\t\tquit(0)",
      "",
    );
  }

  const idx = extendsIdx >= 0 ? extendsIdx + 1 : 0;
  return [...lines.slice(0, idx), ...helperLines, ...lines.slice(idx)].join("\n");
}

export function parseMcpMarkers(raw, resultMarker = MARKER_RESULT, errorMarker = MARKER_ERROR) {
  const lines = raw.split("\n");
  const logLines = [];
  let parsed = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(resultMarker)) {
      try {
        parsed = JSON.parse(trimmed.substring(resultMarker.length));
      } catch {
        parsed = { success: false, error: "Failed to parse result JSON: " + trimmed };
      }
    } else if (trimmed.startsWith(errorMarker)) {
      try {
        parsed = JSON.parse(trimmed.substring(errorMarker.length));
      } catch {
        parsed = { success: false, error: "Failed to parse error JSON: " + trimmed };
      }
    } else {
      logLines.push(trimmed);
    }
  }

  return { parsed, logLines };
}

function extractCompileError(raw) {
  const errors = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.includes("Parse Error:") || trimmed.includes("Script Error:")) {
      errors.push(trimmed);
    }
  }
  return errors.join("\n");
}

export async function executeGdscript({ godotPath, projectPath, code, timeout = 30, trusted = false }) {
  const startTime = Date.now();

  if (process.env.ALLOW_EXECUTE_GDSCRIPT === "false") {
    return {
      success: false, compile_success: false,
      compile_error: "GDScript execution is disabled (ALLOW_EXECUTE_GDSCRIPT=false)",
      errors: [], run_success: false, run_error: "", outputs: [], raw_output: "", duration_ms: 0,
    };
  }

  const sandboxWarnings = trusted ? [] : scanGdscriptSandbox(code);
  const safetyDisabled = process.env.GODOT_MCP_UNRESTRICTED === "true"
    && (process.env.GODOT_MCP_DISABLE_SAFETY === "true" || process.env.GODOT_MCP_ALLOW_UNSAFE === "true");
  if (sandboxWarnings.length > 0 && !safetyDisabled) {
    return {
      success: false, compile_success: false,
      compile_error: `Sandbox violation: code contains dangerous patterns.\n${sandboxWarnings.join("\n")}`,
      errors: [], run_success: false, run_error: "", outputs: [], raw_output: "", duration_ms: 0,
    };
  }

  const rndResult = generateMarker();
  const rndError = generateMarker();

  let scriptContent;
  if (isFullClass(code)) {
    scriptContent = injectHelpers(code, rndResult);
  } else {
    scriptContent = wrapSnippet(code, rndResult);
  }
  scriptContent = scriptContent.replaceAll(MARKER_RESULT, rndResult).replaceAll(MARKER_ERROR, rndError);

  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-mcp-exec-"));
  const tempFile = path.join(sessionDir, `${randomUUID().replace(/-/g, "").substring(0, 8)}.gd`);
  fs.writeFileSync(tempFile, scriptContent, "utf8");

  try {
    const result = await spawnGodot(godotPath, ["--headless", "--path", projectPath, "--script", tempFile], {
      timeoutMs: timeout * 1000,
      maxOutput: 10 * 1024 * 1024,
    });

    const rawOutput = result.stdout + result.stderr;
    const duration = Date.now() - startTime;
    const { parsed, logLines } = parseMcpMarkers(rawOutput, rndResult, rndError);
    const analysis = analyzeOutput(logLines);
    const compileError = extractCompileError(rawOutput);
    const hasCompileError = compileError.length > 0;

    if (result.timedOut) {
      return {
        success: false, compile_success: !hasCompileError, compile_error: compileError,
        errors: analysis.errors, run_success: false,
        run_error: `Godot process timed out after ${timeout}s`,
        outputs: [], raw_output: logLines.join("\n"), duration_ms: duration,
      };
    }

    if (parsed) {
      const isSuccess = parsed.success === true;
      return {
        success: isSuccess && !hasCompileError,
        compile_success: !hasCompileError,
        compile_error: compileError,
        errors: analysis.errors,
        run_success: isSuccess,
        run_error: parsed.error || "",
        outputs: parsed.outputs || [],
        raw_output: logLines.join("\n"),
        duration_ms: duration,
      };
    }

    return {
      success: false,
      compile_success: !hasCompileError,
      compile_error: compileError,
      errors: analysis.errors,
      run_success: false,
      run_error: result.exitCode !== 0 ? `Process exited with code ${result.exitCode}` : "No structured output found",
      outputs: [],
      raw_output: logLines.join("\n"),
      duration_ms: duration,
    };
  } finally {
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
  }
}

export function parseGdscriptResult(execResult, { mapError } = {}) {
  if (!execResult.success) {
    const message = execResult.compile_error || execResult.run_error || "GDScript execution failed";
    const code = mapError ? mapError(message) : "SCRIPT_EXEC_FAILED";
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, error: { code, message }, errors: execResult.errors, raw_output: execResult.raw_output }, null, 2) }],
      isError: true,
    };
  }
  const outputs = execResult.outputs ?? [];
  const errorEntry = outputs.find((o) => o.key === "error");
  if (errorEntry) {
    const code = mapError ? mapError(String(errorEntry.value)) : "SCRIPT_EXEC_FAILED";
    return {
      content: [{ type: "text", text: JSON.stringify({ success: false, error: { code, message: String(errorEntry.value) } }, null, 2) }],
      isError: true,
    };
  }
  const payload = {};
  for (const entry of outputs) {
    if (entry.key === "error") continue;
    payload[entry.key] = entry.value;
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, ...payload }, null, 2) }],
  };
}
