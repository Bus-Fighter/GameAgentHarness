import fs from "node:fs";
import path from "node:path";

const MAX_DECODE_ITERATIONS = 20;
const WINDOWS_DEVICE_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

export function iterativeDecode(raw, maxIterations = MAX_DECODE_ITERATIONS) {
  let decoded = raw;
  let prev = "";
  let iterations = 0;
  while (decoded !== prev && iterations < maxIterations) {
    prev = decoded;
    decoded = decodeURIComponent(decoded);
    iterations += 1;
  }
  return decoded;
}

export function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(p);
}

export function validateProjectRoot(p) {
  const resolved = resolvePath(p);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Project path does not exist: ${resolved}`);
  }
  if (!fs.existsSync(path.join(resolved, "project.godot"))) {
    throw new Error(`Not a valid Godot project (no project.godot found): ${resolved}`);
  }
  return resolved;
}

export function safeRealPath(p, base) {
  try {
    return fs.realpathSync(p);
  } catch {
    let current = resolvePath(p);
    const trailing = [];
    while (!fs.existsSync(current)) {
      trailing.unshift(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    let resolvedAncestor;
    try {
      resolvedAncestor = fs.realpathSync(current);
    } catch (err) {
      throw new Error(`Cannot resolve real path for "${current}" (component of "${p}"): ${err.message}`);
    }
    const resolved = trailing.length > 0 ? path.join(resolvedAncestor, ...trailing) : resolvedAncestor;
    if (base) {
      const rel = path.relative(base, resolved);
      if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        throw new Error(`Path traversal detected in fallback resolution: ${p}`);
      }
    }
    return resolved;
  }
}

export function resolveWithinRoot(root, userPath) {
  const base = safeRealPath(resolvePath(root));

  if (/^\\\\[^\\]/.test(userPath)) {
    throw new Error(`Path traversal detected: ${userPath}`);
  }

  const leafName = userPath.replace(/\\/g, "/").split("/").pop() || "";
  const baseName = leafName.replace(/\.[^.]*$/, "");
  if (WINDOWS_DEVICE_RE.test(baseName)) {
    throw new Error(`Path traversal detected: ${userPath}`);
  }

  let decoded;
  try {
    decoded = iterativeDecode(userPath);
  } catch {
    throw new Error(`Path traversal detected: ${userPath}`);
  }

  const normalizedPath = decoded.replace(/\\/g, "/");
  const segments = normalizedPath.split("/");
  if (segments.some((s) => s === "..")) {
    throw new Error(`Path traversal detected: ${userPath}`);
  }
  const resolved = path.resolve(base, normalizedPath);
  const realResolved = safeRealPath(resolved, base);
  const rel = path.relative(base, realResolved);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path traversal detected: ${userPath}`);
  }
  return realResolved;
}

export function normalizeUserProjectPath(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("res://")) return trimmed.slice("res://".length);
  return trimmed;
}

export function requireProjectPath(args) {
  const raw = args.project_path;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("project_path is required and must be a non-empty string");
  }
  return validateProjectRoot(raw);
}
