import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const COMMON_GODOT_PATTERNS = [
  () => process.env.GODOT_BIN,
  () => findInPath("godot"),
  () => findInPath("godot4"),
  () => findInPath("Godot"),
  () => findFile("/usr/bin", "godot*"),
  () => findFile("/usr/local/bin", "godot*"),
  () => findFile(path.join(os.homedir(), "Downloads"), "Godot*"),
  () => findFile(path.join(os.homedir(), "Applications"), "Godot*.app"),
  () => findFile(path.join(os.homedir(), "AppData", "Local", "Programs"), "Godot*.exe"),
  () => findFile("C:\\Program Files", "Godot*.exe"),
];

function findInPath(name) {
  const paths = (process.env.PATH ?? "").split(path.delimiter);
  for (const dir of paths) {
    const full = path.join(dir, name);
    if (fs.existsSync(full) && isExecutable(full)) return full;
    if (process.platform === "win32") {
      const withExe = full + ".exe";
      if (fs.existsSync(withExe)) return withExe;
    }
  }
  return null;
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findFile(dir, pattern) {
  if (!fs.existsSync(dir)) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (matchesPattern(entry.name, pattern)) {
          const bin = findExecutableInside(full);
          if (bin) return bin;
        }
        const nested = findFile(full, pattern);
        if (nested) return nested;
      } else if (matchesPattern(entry.name, pattern) && isExecutable(full)) {
        return full;
      }
    }
  } catch {}
  return null;
}

function matchesPattern(name, pattern) {
  const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$", "i");
  return regex.test(name);
}

function findExecutableInside(dir) {
  if (!fs.existsSync(dir)) return null;
  const candidates = [
    path.join(dir, "Godot"),
    path.join(dir, "godot"),
    path.join(dir, "Godot_mono"),
    path.join(dir, "Contents", "MacOS", "Godot"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && isExecutable(candidate)) return candidate;
  }

  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) {
        const full = path.join(dir, entry.name);
        if (isExecutable(full)) return full;
      }
    }
  } catch {}
  return null;
}

export function findGodotBin() {
  for (const fn of COMMON_GODOT_PATTERNS) {
    const result = fn();
    if (result) return result;
  }
  return null;
}

export function launchEditor({ godotBin, projectRoot }) {
  if (!godotBin) {
    throw new Error("Godot binary not found. Set GODOT_BIN or pass --godot-bin.");
  }
  if (!projectRoot || !fs.existsSync(projectRoot)) {
    throw new Error(`Project root not found: ${projectRoot}`);
  }
  const projectFile = path.join(projectRoot, "project.godot");
  if (!fs.existsSync(projectFile)) {
    throw new Error(`project.godot not found in ${projectRoot}`);
  }

  const child = spawn(godotBin, ["--path", projectRoot, "--editor"], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (err) => {
    console.error(`[harness] failed to launch Godot: ${err.message}`);
  });
  child.unref();
  return child;
}

export function killProcess(child) {
  if (!child) return;
  try {
    child.kill("SIGTERM");
  } catch {}
}
