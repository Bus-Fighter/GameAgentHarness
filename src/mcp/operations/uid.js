import { textResult, opsErrorResult } from "../util.js";
import { resolveGodotPath, runGodotScript } from "../godot-process.js";
import { requireProjectPath, normalizeUserProjectPath } from "../path-utils.js";

export const tools = [
  {
    name: "get_uid",
    description: "Get the UID for a specific file in a Godot project (Godot 4.4+ .uid files).",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        file_path: { type: "string", description: "File path relative to project (or res:// path)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "file_path"],
    },
  },
  {
    name: "update_project_uids",
    description: "Resave all project resources (.tscn, .gd, shaders) to update/generate UID references (Godot 4.4+).",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path"],
    },
  },
];

export async function handle(toolName, args, ctx) {
  switch (toolName) {
    case "get_uid": {
      const projectPath = requireProjectPath(args);
      if (typeof args.file_path !== "string" || args.file_path.trim() === "") {
        return opsErrorResult("INVALID_PARAMS", "file_path is required");
      }
      const filePath = normalizeUserProjectPath(args.file_path);
      if (filePath.replace(/\\/g, "/").split("/").includes("..")) {
        return opsErrorResult("INVALID_PATH", "file_path contains path traversal");
      }
      const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
      const result = await runGodotScript("godot_operations.gd", "get_uid", { file_path: filePath }, projectPath, {
        timeout: 60000,
        godotPath: godot,
      });
      if (result.timedOut) return opsErrorResult("TIMEOUT", "get_uid timed out");
      if (result.exitCode !== 0) {
        return opsErrorResult("GODOT_ERROR", `get_uid failed (exit code ${result.exitCode}):\n${result.stdout}${result.stderr}`);
      }
      const jsonLine = result.stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).pop();
      if (jsonLine) {
        try {
          return textResult(JSON.stringify(JSON.parse(jsonLine), null, 2));
        } catch {}
      }
      return textResult(result.stdout.trim());
    }

    case "update_project_uids": {
      const projectPath = requireProjectPath(args);
      const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
      const result = await runGodotScript("godot_operations.gd", "resave_resources", { project_path: "res://" }, projectPath, {
        timeout: 180000,
        godotPath: godot,
      });
      if (result.timedOut) return opsErrorResult("TIMEOUT", "resave_resources timed out after 180s");
      if (result.exitCode !== 0) {
        return opsErrorResult("GODOT_ERROR", `resave_resources failed (exit code ${result.exitCode}):\n${result.stdout}${result.stderr}`);
      }
      return textResult(result.stdout.trim());
    }

    default:
      return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  }
}
