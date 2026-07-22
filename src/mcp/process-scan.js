import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const EDITOR_FLAGS = new Set(["-e", "--editor"]);

export function classifyCmdline(cmdline) {
  const tokens = String(cmdline).match(/"[^"]*"|\S+/g) ?? [];
  const clean = tokens.map((t) => t.replace(/^"|"$/g, ""));
  let kind = "game";
  let projectPath = null;
  for (let i = 0; i < clean.length; i += 1) {
    if (EDITOR_FLAGS.has(clean[i])) kind = "editor";
    if (clean[i] === "--path" && clean[i + 1]) {
      projectPath = clean[i + 1];
      i += 1;
    } else if (clean[i].startsWith("--path=")) {
      projectPath = clean[i].slice("--path=".length);
    }
  }
  return { kind, projectPath };
}

function parseWindowsProcessJson(jsonText) {
  let data = JSON.parse(jsonText);
  if (!Array.isArray(data)) data = [data];
  const out = [];
  for (const proc of data) {
    const cmdline = proc.CommandLine ?? "";
    const { kind, projectPath } = classifyCmdline(cmdline);
    out.push({
      pid: proc.ProcessId,
      exe: proc.ExecutablePath ?? null,
      kind,
      projectPath,
      cmdline,
    });
  }
  return out;
}

function parsePsOutput(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const cmdline = match[2];
    if (!/godot/i.test(cmdline)) continue;
    const { kind, projectPath } = classifyCmdline(cmdline);
    out.push({ pid: Number(match[1]), exe: null, kind, projectPath, cmdline });
  }
  return out;
}

function normalizePath(p) {
  return String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function filterByProject(processes, projectRoot) {
  if (!projectRoot) return processes;
  const target = normalizePath(projectRoot);
  return processes.filter((proc) => {
    const pp = normalizePath(proc.projectPath);
    return pp && (pp === target || pp.endsWith("/" + target) || target.endsWith("/" + pp));
  });
}

export async function findGodotProcesses({ projectRoot } = {}) {
  let processes;
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name LIKE 'godot%'\" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
    ], { timeout: 15000, windowsHide: true });
    processes = stdout.trim() ? parseWindowsProcessJson(stdout) : [];
  } else {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,args="], { timeout: 15000 });
    processes = parsePsOutput(stdout);
  }
  return filterByProject(processes, projectRoot);
}

export async function killGodotProcess(pid, { force = false } = {}) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    throw new Error(`Invalid pid: ${pid}`);
  }
  if (process.platform === "win32") {
    const args = ["/PID", String(numericPid), "/T"];
    if (force) args.push("/F");
    await execFileAsync("taskkill", args, { timeout: 15000, windowsHide: true });
  } else {
    process.kill(numericPid, force ? "SIGKILL" : "SIGTERM");
  }
  return { pid: numericPid, force };
}
