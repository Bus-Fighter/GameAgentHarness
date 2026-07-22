import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findGodotBin } from "../core/editor-launcher.js";

const MAX_OUTPUT_BUFFER_LINES = 5000;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function buildSafeEnv() {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    USERPROFILE: process.env.USERPROFILE ?? "",
    LOCALAPPDATA: process.env.LOCALAPPDATA ?? "",
    APPDATA: process.env.APPDATA ?? "",
    TEMP: process.env.TEMP ?? "",
    TMP: process.env.TMP ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    COMSPEC: process.env.COMSPEC ?? "",
    OS: process.env.OS ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    DISPLAY: process.env.DISPLAY ?? "",
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "",
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? "",
    XDG_DATA_HOME: process.env.XDG_DATA_HOME ?? "",
  };
}

export function forceKillTree(proc) {
  if (proc.killed) return;
  if (process.platform === "win32") {
    try {
      const child = spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
      child.on("error", () => { try { proc.kill(); } catch {} });
    } catch {
      try { proc.kill(); } catch {}
    }
  } else {
    if (proc.pid) {
      try {
        const pk = spawn("pkill", ["-P", String(proc.pid)], { stdio: "ignore" });
        pk.on("error", () => {});
      } catch {}
    }
    try { proc.kill("SIGTERM"); } catch {}
  }
}

export async function resolveGodotPath(explicitPath) {
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Godot binary not found at explicit path: ${explicitPath}`);
    }
    return explicitPath;
  }
  if (process.env.GODOT_PATH) {
    if (fs.existsSync(process.env.GODOT_PATH)) {
      return process.env.GODOT_PATH;
    }
    throw new Error(`GODOT_PATH is set but does not exist: ${process.env.GODOT_PATH}`);
  }
  const found = findGodotBin();
  if (!found) {
    throw new Error("Godot binary not found. Set GODOT_PATH, pass godot_path, or install Godot.");
  }
  return found;
}

export function execGodot(args, godotPath, { timeout = 60000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let proc;
    try {
      proc = execFile(godotPath, args, {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: buildSafeEnv(),
        windowsHide: true,
      }, (error, stdout, stderr) => {
        clearTimeout(timer);
        if (error && error.killed) {
          resolvePromise({ exitCode: null, stdout: String(stdout), stderr: String(stderr), timedOut: true });
          return;
        }
        resolvePromise({
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
          timedOut: false,
        });
      });
      void stdoutChunks;
      void stderrChunks;
    } catch (err) {
      reject(new Error(`execGodot: failed to spawn ${godotPath}: ${err.message}`));
      return;
    }
    const timer = setTimeout(() => {
      try { forceKillTree(proc); } catch {}
    }, timeout + 5000);
  });
}

export function spawnGodot(godotPath, args, { timeoutMs = 60000, maxOutput = 100000 } = {}) {
  return new Promise((resolvePromise) => {
    let proc;
    let settled = false;
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    try {
      proc = spawn(godotPath, args, { stdio: ["pipe", "pipe", "pipe"], env: buildSafeEnv() });
    } catch (spawnErr) {
      const msg = `SPAWN_FAILED: ${spawnErr.message}`;
      resolvePromise({ stdout: msg, stderr: "", exitCode: -1, timedOut: false });
      return;
    }

    proc.stdout.on("data", (d) => {
      if (stdoutBytes < maxOutput) { stdoutChunks.push(d); stdoutBytes += d.byteLength; }
    });
    proc.stderr.on("data", (d) => {
      if (stderrBytes < maxOutput) { stderrChunks.push(d); stderrBytes += d.byteLength; }
    });

    const collect = () => ({
      out: Buffer.concat(stdoutChunks).toString("utf8"),
      errOut: Buffer.concat(stderrChunks).toString("utf8"),
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      forceKillTree(proc);
      const { out, errOut } = collect();
      resolvePromise({ stdout: out, stderr: errOut, exitCode: null, timedOut: true });
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const { out, errOut } = collect();
      resolvePromise({ stdout: out, stderr: errOut, exitCode: code, timedOut: false });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const { out, errOut } = collect();
      resolvePromise({ stdout: out, stderr: `${errOut}\nError: ${err.message}`, exitCode: -1, timedOut: false });
    });
  });
}

export const SCRIPTS_DIR = path.join(MODULE_DIR, "scripts");

export async function runGodotScript(scriptName, operation, params, projectPath, { timeout = 60000, godotPath } = {}) {
  const godot = godotPath ?? (await resolveGodotPath());
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Godot script not found: ${scriptPath}`);
  }
  const args = ["--headless", "--path", projectPath, "--script", scriptPath];
  if (operation != null) {
    args.push(operation, JSON.stringify(params ?? {}));
  } else if (params != null) {
    args.push(JSON.stringify(params));
  }
  return spawnGodot(godot, args, { timeoutMs: timeout });
}

export class GodotProcessManager {
  constructor() {
    this.process = null;
    this.outputBuffer = [];
    this.projectPath = null;
    this.startedAt = 0;
  }

  isRunning() {
    return this.process != null && !this.process.killed && this.process.exitCode == null;
  }

  runProject(godotPath, projectPath, { extraArgs = [] } = {}) {
    if (this.isRunning()) {
      throw new Error("A Godot project is already running. Stop it first with stop_project.");
    }
    const args = ["--path", projectPath, ...extraArgs];
    const proc = spawn(godotPath, args, { stdio: ["ignore", "pipe", "pipe"], env: buildSafeEnv() });
    this.process = proc;
    this.projectPath = projectPath;
    this.startedAt = Date.now();
    this.outputBuffer = [];

    const pushLines = (streamName, chunk) => {
      const text = chunk.toString("utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trimEnd();
        if (!trimmed) continue;
        this.outputBuffer.push(`[${streamName}] ${trimmed}`);
      }
      if (this.outputBuffer.length > MAX_OUTPUT_BUFFER_LINES) {
        this.outputBuffer.splice(0, this.outputBuffer.length - MAX_OUTPUT_BUFFER_LINES);
      }
    };

    proc.stdout.on("data", (d) => pushLines("stdout", d));
    proc.stderr.on("data", (d) => pushLines("stderr", d));
    proc.on("close", (code) => {
      pushLines("system", `Process exited with code ${code}`);
    });
    proc.on("error", (err) => {
      pushLines("system", `Process error: ${err.message}`);
    });

    return { pid: proc.pid, projectPath };
  }

  async stopProject() {
    const proc = this.process;
    if (!proc || !this.isRunning()) {
      this.process = null;
      return { stopped: false, message: "No running Godot project." };
    }
    const pid = proc.pid;
    await new Promise((resolvePromise) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolvePromise();
        }
      };
      const timer = setTimeout(() => {
        forceKillTree(proc);
        finish();
      }, 5000);
      proc.on("close", () => {
        clearTimeout(timer);
        finish();
      });
      proc.on("error", () => {
        clearTimeout(timer);
        finish();
      });
      forceKillTree(proc);
    });
    this.process = null;
    return { stopped: true, pid, projectPath: this.projectPath };
  }

  getDebugOutput() {
    return {
      running: this.isRunning(),
      projectPath: this.projectPath,
      startedAt: this.startedAt || null,
      lines: [...this.outputBuffer],
    };
  }
}
