import fs from "node:fs";
import path from "node:path";

export const MARKER_RESULT = "___MCP_RESULT___";
export const MARKER_ERROR = "___MCP_ERROR___";

export const CLASS_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const BLOCKED_PROPS = new Set([
  "script", "owner", "process_mode", "process_priority", "process_input",
  "process_unhandled_input", "process_unhandled_key_input", "process_internal",
  "physics_process_mode", "physics_interpolation_mode", "name", "meta",
  "input_event", "ready", "tree_entered", "tree_exited", "tree_exiting",
]);

export function textResult(text) {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text) {
  return { content: [{ type: "text", text }], isError: true };
}

export function opsErrorResult(code, message, extra = {}) {
  return errorResult(JSON.stringify({ success: false, error: { code, message, ...extra } }, null, 2));
}

export function requireString(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

export function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function writeAtomic(filePath, content) {
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function toSnakeCase(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

export function gdEscape(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function normalizeNodePath(nodePath) {
  const raw = String(nodePath ?? "root");
  if (raw === "" || raw === "/" || raw === "/root") return "root";
  return raw.replace(/^\/+/, "");
}

const DEFAULT_SKIP_DIRS = new Set([".godot", ".import", ".git", "node_modules", ".hg", ".svn"]);

export function scanFiles(rootDir, extensions, { skipDirs = [] } = {}) {
  const skip = new Set([...DEFAULT_SKIP_DIRS, ...skipDirs]);
  const results = [];
  const walk = (dir, depth) => {
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
        if (!skip.has(entry.name) && !entry.name.startsWith(".")) {
          walk(full, depth + 1);
        }
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  };
  walk(rootDir, 0);
  return results;
}

export function parseMcpScriptOutput(rawOutput, exitCode, resultMarker = MARKER_RESULT, errorMarker = MARKER_ERROR) {
  const lines = rawOutput.split("\n");
  const logLines = [];
  let parsed = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(resultMarker)) {
      try {
        parsed = JSON.parse(trimmed.substring(resultMarker.length));
      } catch {
        parsed = { success: false, error: "Failed to parse result JSON", raw: trimmed };
      }
    } else if (trimmed.startsWith(errorMarker)) {
      try {
        parsed = JSON.parse(trimmed.substring(errorMarker.length));
      } catch {
        parsed = { success: false, error: "Failed to parse error JSON", raw: trimmed };
      }
    } else {
      logLines.push(trimmed);
    }
  }

  if (parsed) return parsed;

  return {
    success: false,
    error: exitCode !== 0 ? `Process exited with code ${exitCode}` : "No structured output found",
    raw_output: logLines.join("\n"),
  };
}
