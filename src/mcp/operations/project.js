import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { textResult, opsErrorResult, scanFiles, ensureDir } from "../util.js";
import { resolveGodotPath, spawnGodot } from "../godot-process.js";
import { resolvePath, validateProjectRoot, resolveWithinRoot } from "../path-utils.js";

function parseGodotConfig(content) {
  const lines = content.split("\n");
  const config = {};
  let currentSection = "";

  const parseValue = (raw) => {
    if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    const num = Number(raw);
    if (Number.isFinite(num) && raw.trim() !== "") return num;
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const inner = raw.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(",").map((s) => parseValue(s.trim()));
    }
    return raw;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!config[currentSection]) config[currentSection] = {};
      continue;
    }
    const kvMatch = trimmed.match(/^(\S+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const container = currentSection ? config[currentSection] : config;
      container[kvMatch[1]] = parseValue(kvMatch[2].trim());
    }
  }

  return config;
}

export const tools = [
  {
    name: "list_projects",
    description: "Scan a directory for Godot projects (directories containing project.godot).",
    inputSchema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Directory to scan (default: user home)", default: "~" },
        recursive: { type: "boolean", description: "Scan subdirectories recursively (default: true)", default: true },
        max_depth: { type: "number", description: "Maximum recursion depth (default: 3)", default: 3 },
      },
    },
  },
  {
    name: "get_project_info",
    description: "Get metadata about a Godot project: name, config version, features, main scene, autoloads, and file counts.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "list_files",
    description: "List files in a Godot project, optionally filtered by extension and directory.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        directory: { type: "string", description: "Subdirectory relative to project root (default: whole project)" },
        extensions: { type: "array", items: { type: "string" }, description: "File extensions to include, e.g. [\".gd\", \".tscn\"]" },
        recursive: { type: "boolean", description: "Recurse into subdirectories (default: true)", default: true },
      },
      required: ["project_path"],
    },
  },
  {
    name: "read_project_config",
    description: "Read and parse the project's project.godot configuration file.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "create_project",
    description: "Create a new Godot project directory with a minimal project.godot.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path of the new project directory to create" },
        project_name: { type: "string", description: "Display name for the project (default: directory name)" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "import_resources",
    description: "Run a headless Godot import pass (--import) to refresh the project's .godot/imported cache.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        timeout: { type: "number", description: "Timeout in seconds (default: 120)", default: 120 },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path"],
    },
  },
];

export async function handle(toolName, args, ctx) {
  switch (toolName) {
    case "list_projects": {
      const rawDir = args.directory ? String(args.directory) : os.homedir();
      const root = resolvePath(rawDir.replace(/^~(?=$|[/\\])/, os.homedir()));
      if (!fs.existsSync(root)) {
        return opsErrorResult("DIR_NOT_FOUND", `Directory not found: ${root}`);
      }
      const recursive = args.recursive !== false;
      const maxDepth = Math.min(Math.max(Number(args.max_depth) || 3, 1), 10);
      const skip = new Set([".git", ".godot", ".import", "node_modules"]);
      const projects = [];

      const walk = (dir, depth) => {
        if (depth > maxDepth) return;
        if (fs.existsSync(path.join(dir, "project.godot"))) {
          projects.push(dir);
          return;
        }
        if (!recursive && depth > 0) return;
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (!entry.isDirectory() || skip.has(entry.name) || entry.name.startsWith(".")) continue;
          walk(path.join(dir, entry.name), depth + 1);
        }
      };
      walk(root, 0);

      return textResult(JSON.stringify({ root, count: projects.length, projects }, null, 2));
    }

    case "get_project_info": {
      const projectPath = validateProjectRoot(args.project_path);
      const configPath = path.join(projectPath, "project.godot");
      const config = parseGodotConfig(fs.readFileSync(configPath, "utf8"));

      const application = config.application ?? {};
      const info = {
        name: application["config/name"] ?? path.basename(projectPath),
        path: projectPath,
        configVersion: application["config_version"] ?? null,
        features: application["config/features"] ?? null,
        mainScene: application["run/main_scene"] ?? null,
        autoloads: Object.keys(config.autoload ?? {}),
        counts: {
          scripts: scanFiles(projectPath, [".gd"]).length,
          scenes: scanFiles(projectPath, [".tscn"]).length,
          resources: scanFiles(projectPath, [".tres", ".res"]).length,
          shaders: scanFiles(projectPath, [".gdshader", ".shader"]).length,
        },
      };
      return textResult(JSON.stringify(info, null, 2));
    }

    case "list_files": {
      const projectPath = validateProjectRoot(args.project_path);
      let baseDir = projectPath;
      if (args.directory) {
        baseDir = resolveWithinRoot(projectPath, String(args.directory));
        if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
          return opsErrorResult("DIR_NOT_FOUND", `Directory not found in project: ${args.directory}`);
        }
      }
      const extensions = Array.isArray(args.extensions) && args.extensions.length > 0
        ? args.extensions.map(String)
        : null;
      const recursive = args.recursive !== false;

      let files;
      if (extensions) {
        files = recursive
          ? scanFiles(baseDir, extensions)
          : fs.readdirSync(baseDir).filter((f) => extensions.some((ext) => f.endsWith(ext))).map((f) => path.join(baseDir, f));
      } else {
        const all = [];
        const walk = (dir, depth) => {
          if (!recursive && depth > 0) return;
          if (depth > 20) return;
          let entries;
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (!entry.name.startsWith(".") && entry.name !== "node_modules") walk(full, depth + 1);
            } else {
              all.push(full);
            }
          }
        };
        walk(baseDir, 0);
        files = all;
      }

      const relative = files.map((f) => path.relative(projectPath, f).replace(/\\/g, "/")).sort();
      return textResult(JSON.stringify({ project: projectPath, count: relative.length, files: relative }, null, 2));
    }

    case "read_project_config": {
      const projectPath = validateProjectRoot(args.project_path);
      const configPath = path.join(projectPath, "project.godot");
      const config = parseGodotConfig(fs.readFileSync(configPath, "utf8"));
      return textResult(JSON.stringify(config, null, 2));
    }

    case "create_project": {
      const rawPath = args.project_path;
      if (typeof rawPath !== "string" || rawPath.trim() === "") {
        return opsErrorResult("INVALID_PARAMS", "project_path is required");
      }
      if (rawPath.replace(/\\/g, "/").split("/").includes("..")) {
        return opsErrorResult("INVALID_PATH", "project_path must not contain '..'");
      }
      const projectPath = resolvePath(rawPath);
      if (fs.existsSync(path.join(projectPath, "project.godot"))) {
        return opsErrorResult("ALREADY_EXISTS", `A Godot project already exists at ${projectPath}`);
      }
      const projectName = typeof args.project_name === "string" && args.project_name.trim()
        ? args.project_name.trim()
        : path.basename(projectPath);
      if (!/^[\w .-]+$/.test(projectName)) {
        return opsErrorResult("INVALID_PARAMS", `Invalid project_name: ${projectName}`);
      }

      ensureDir(path.join(projectPath, "project.godot"));
      const config = [
        "; Engine configuration file.",
        "",
        "config_version=5",
        "",
        "[application]",
        "",
        `config/name="${projectName}"`,
        'config/features=PackedStringArray("4.2")',
        "",
      ].join("\n");
      fs.writeFileSync(path.join(projectPath, "project.godot"), config, "utf8");
      return textResult(`Created Godot project "${projectName}" at ${projectPath}`);
    }

    case "import_resources": {
      const projectPath = validateProjectRoot(args.project_path);
      const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
      const timeout = Math.min(Math.max(Number(args.timeout) || 120, 10), 600);
      const result = await spawnGodot(godot, ["--headless", "--path", projectPath, "--import"], { timeoutMs: timeout * 1000 });
      if (result.timedOut) {
        return opsErrorResult("TIMEOUT", `Import timed out after ${timeout}s`);
      }
      return textResult(JSON.stringify({
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        output: (result.stdout + result.stderr).trim(),
      }, null, 2));
    }

    default:
      return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  }
}
