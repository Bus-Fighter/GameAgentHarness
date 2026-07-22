import fs from "node:fs";
import path from "node:path";
import { textResult, opsErrorResult, parseMcpScriptOutput } from "../util.js";
import { resolveGodotPath, runGodotScript, SCRIPTS_DIR } from "../godot-process.js";
import { requireProjectPath, resolveWithinRoot, normalizeUserProjectPath } from "../path-utils.js";
import { executeGdscript } from "../gdscript.js";

export const tools = [
  {
    name: "execute_gdscript",
    description: "Execute arbitrary GDScript code in a headless Godot process. Code snippets without an `extends` line are auto-wrapped in a SceneTree script. Use _mcp_output(key, value) for structured output. Dangerous APIs (OS.execute, file writes, threads, reflection) are blocked by a sandbox scanner.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        code: { type: "string", description: "GDScript code to execute" },
        timeout: { type: "number", description: "Timeout in seconds (default: 30)", default: 30 },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "code"],
    },
  },
  {
    name: "query_scene_tree",
    description: "Query a scene's node tree with resolved runtime property values. Loads the scene headlessly and returns the full tree structure up to max_depth.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project (or res:// path)" },
        max_depth: { type: "number", description: "Maximum tree depth (default: 5)", default: 5 },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path"],
    },
  },
  {
    name: "inspect_node",
    description: "Deep-inspect a specific node in a scene: properties, signal connections, available signals, and children details.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project (or res:// path)" },
        node_path: { type: "string", description: "Node path (default: root)", default: "root" },
        max_depth: { type: "number", description: "Children depth (default: 3)", default: 3 },
        include_signals: { type: "boolean", description: "Include signal info (default: true)", default: true },
        include_properties: { type: "boolean", description: "Include properties (default: true)", default: true },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path"],
    },
  },
];

async function runMarkedScript(scriptName, args) {
  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path);
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  if (!fs.existsSync(scriptPath)) {
    return textResult(`Error: ${scriptName} not found at ${scriptPath}`);
  }
  const sceneRel = normalizeUserProjectPath(args.scene_path);
  try {
    resolveWithinRoot(projectPath, sceneRel);
  } catch {
    return opsErrorResult("INVALID_PATH", "scene_path contains path traversal");
  }
  return { projectPath, godot };
}

export async function handle(toolName, args, ctx) {
  switch (toolName) {
    case "execute_gdscript": {
      const projectPath = requireProjectPath(args);
      const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
      const code = args.code;
      if (typeof code !== "string" || code.trim() === "") {
        return opsErrorResult("INVALID_PARAMS", '"code" is required and must be a non-empty string.');
      }
      const timeout = Math.min(Math.max(Number(args.timeout) || 30, 1), 300);
      const result = await executeGdscript({ godotPath: godot, projectPath, code, timeout });
      return textResult(JSON.stringify(result, null, 2));
    }

    case "query_scene_tree": {
      const resolved = await runMarkedScript("query_scene_tree.gd", args);
      if ("content" in resolved) return resolved;
      const params = {
        scene_path: normalizeUserProjectPath(args.scene_path),
        max_depth: Number(args.max_depth) || 5,
      };
      const result = await runGodotScript("query_scene_tree.gd", null, params, resolved.projectPath, {
        timeout: 60000,
        godotPath: resolved.godot,
      });
      if (result.timedOut) return textResult("query_scene_tree timed out after 60s");
      return textResult(JSON.stringify(parseMcpScriptOutput(result.stdout, result.exitCode ?? 0), null, 2));
    }

    case "inspect_node": {
      const resolved = await runMarkedScript("inspect_node.gd", args);
      if ("content" in resolved) return resolved;
      const params = {
        scene_path: normalizeUserProjectPath(args.scene_path),
        node_path: args.node_path || "root",
        max_depth: Number(args.max_depth) || 3,
        include_signals: args.include_signals !== false,
        include_properties: args.include_properties !== false,
      };
      const result = await runGodotScript("inspect_node.gd", null, params, resolved.projectPath, {
        timeout: 60000,
        godotPath: resolved.godot,
      });
      if (result.timedOut) return textResult("inspect_node timed out after 60s");
      return textResult(JSON.stringify(parseMcpScriptOutput(result.stdout, result.exitCode ?? 0), null, 2));
    }

    default:
      return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  }
}
