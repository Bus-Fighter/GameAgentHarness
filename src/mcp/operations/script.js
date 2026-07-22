import fs from "node:fs";
import path from "node:path";
import { textResult, opsErrorResult, ensureDir, writeAtomic, scanFiles } from "../util.js";
import { requireProjectPath, resolveWithinRoot, normalizeUserProjectPath } from "../path-utils.js";
import { gateDestructive } from "../guard.js";

export const tools = [
  {
    name: "read_script",
    description: "Read a GDScript file (or any text file) from the project.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        script_path: { type: "string", description: "Script path relative to project (or res:// path)" },
      },
      required: ["project_path", "script_path"],
    },
  },
  {
    name: "write_script",
    description: "Write a GDScript file in the project (creates parent directories). Refuses to overwrite an existing file unless overwrite=true.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        script_path: { type: "string", description: "Script path relative to project (or res:// path)" },
        content: { type: "string", description: "Full file content to write" },
        overwrite: { type: "boolean", description: "Allow overwriting an existing file (default: false)", default: false },
      },
      required: ["project_path", "script_path", "content"],
    },
  },
  {
    name: "edit_script",
    description: "Edit an existing GDScript file with a literal search-and-replace. Fails if the search text is not found exactly once unless allow_multiple=true.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        script_path: { type: "string", description: "Script path relative to project (or res:// path)" },
        search: { type: "string", description: "Exact text to search for" },
        replace: { type: "string", description: "Replacement text" },
        allow_multiple: { type: "boolean", description: "Replace all occurrences instead of requiring exactly one (default: false)", default: false },
      },
      required: ["project_path", "script_path", "search", "replace"],
    },
  },
  {
    name: "project_replace",
    description: "Project-wide literal search-and-replace across text files (.gd, .tscn, .tres, .cfg, .gdshader, project.godot). Destructive: requires a confirm_token obtained by calling this tool without one first.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        search: { type: "string", description: "Exact text to search for" },
        replace: { type: "string", description: "Replacement text" },
        extensions: { type: "array", items: { type: "string" }, description: "File extensions to include (default: .gd, .tscn, .tres, .cfg, .gdshader)" },
        dry_run: { type: "boolean", description: "Only report matches without writing (default: false)", default: false },
        confirm_token: { type: "string", description: "Confirmation token from a previous call (not needed when dry_run=true)" },
      },
      required: ["project_path", "search", "replace"],
    },
  },
];

function resolveScriptPath(projectPath, scriptPathRaw) {
  if (typeof scriptPathRaw !== "string" || scriptPathRaw.trim() === "") {
    throw new Error("script_path is required");
  }
  const rel = normalizeUserProjectPath(scriptPathRaw);
  return resolveWithinRoot(projectPath, rel);
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

function projectReplaceExecute(args) {
  const projectPath = requireProjectPath(args);
  const search = String(args.search);
  const replace = String(args.replace);
  if (search === "") {
    return opsErrorResult("INVALID_PARAMS", "search must not be empty");
  }
  const extensions = Array.isArray(args.extensions) && args.extensions.length > 0
    ? args.extensions.map(String)
    : [".gd", ".tscn", ".tres", ".cfg", ".gdshader"];

  const files = scanFiles(projectPath, extensions);
  const projectGodot = path.join(projectPath, "project.godot");
  if (extensions.includes(".cfg") || extensions.includes("project.godot")) {
    if (fs.existsSync(projectGodot) && !files.includes(projectGodot)) {
      files.push(projectGodot);
    }
  }

  const changed = [];
  let totalReplacements = 0;

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const occurrences = countOccurrences(content, search);
    if (occurrences === 0) continue;
    totalReplacements += occurrences;
    changed.push({
      file: path.relative(projectPath, file).replace(/\\/g, "/"),
      replacements: occurrences,
    });
    if (!args.dry_run) {
      writeAtomic(file, content.split(search).join(replace));
    }
  }

  return textResult(JSON.stringify({
    dry_run: args.dry_run === true,
    files_changed: changed.length,
    total_replacements: totalReplacements,
    details: changed,
  }, null, 2));
}

export async function handle(toolName, args, ctx) {
  switch (toolName) {
    case "read_script": {
      const projectPath = requireProjectPath(args);
      let abs;
      try {
        abs = resolveScriptPath(projectPath, args.script_path);
      } catch (err) {
        return opsErrorResult("INVALID_PATH", err.message);
      }
      if (!fs.existsSync(abs)) {
        return opsErrorResult("FILE_NOT_FOUND", `Script not found: ${args.script_path}`);
      }
      return textResult(fs.readFileSync(abs, "utf8"));
    }

    case "write_script": {
      const projectPath = requireProjectPath(args);
      let abs;
      try {
        abs = resolveScriptPath(projectPath, args.script_path);
      } catch (err) {
        return opsErrorResult("INVALID_PATH", err.message);
      }
      if (typeof args.content !== "string") {
        return opsErrorResult("INVALID_PARAMS", "content must be a string");
      }
      const existed = fs.existsSync(abs);
      if (existed && args.overwrite !== true) {
        return opsErrorResult("ALREADY_EXISTS", `File already exists: ${args.script_path}. Pass overwrite=true to replace it.`);
      }
      ensureDir(abs);
      writeAtomic(abs, args.content);
      return textResult(`${existed ? "Updated" : "Created"} ${normalizeUserProjectPath(args.script_path)} (${args.content.length} bytes)`);
    }

    case "edit_script": {
      const projectPath = requireProjectPath(args);
      let abs;
      try {
        abs = resolveScriptPath(projectPath, args.script_path);
      } catch (err) {
        return opsErrorResult("INVALID_PATH", err.message);
      }
      if (!fs.existsSync(abs)) {
        return opsErrorResult("FILE_NOT_FOUND", `Script not found: ${args.script_path}`);
      }
      const search = String(args.search ?? "");
      const replace = String(args.replace ?? "");
      if (search === "") {
        return opsErrorResult("INVALID_PARAMS", "search must not be empty");
      }
      const content = fs.readFileSync(abs, "utf8");
      const occurrences = countOccurrences(content, search);
      if (occurrences === 0) {
        return opsErrorResult("NOT_FOUND", "search text not found in file");
      }
      if (occurrences > 1 && args.allow_multiple !== true) {
        return opsErrorResult("AMBIGUOUS_MATCH", `search text found ${occurrences} times. Pass allow_multiple=true to replace all, or provide more context.`);
      }
      writeAtomic(abs, content.split(search).join(replace));
      return textResult(`Replaced ${occurrences} occurrence(s) in ${normalizeUserProjectPath(args.script_path)}`);
    }

    case "project_replace": {
      if (args.dry_run === true) {
        return projectReplaceExecute(args);
      }
      return gateDestructive("project_replace", args, projectReplaceExecute);
    }

    default:
      return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  }
}
