import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGodotPath } from "../src/mcp/godot-process.js";
import { findGodotBin } from "../src/core/editor-launcher.js";
import fs from "node:fs";
import os from "node:os";

const execFileAsync = promisify(execFile);
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

async function runCli(argv, env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...argv], { env: { ...process.env, ...env } });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

test("CLI: godot tools lists tools", async () => {
  const { code, stdout } = await runCli(["godot", "tools"]);
  assert.equal(code, 0);
  assert.match(stdout, /run_and_verify/);
  assert.match(stdout, /execute_gdscript/);
});

test("CLI: godot dispatch with kebab-case tool name and flag coercion", async () => {
  const { code, stdout } = await runCli(["godot", "analyze-error", "--output", "ERROR: Index out of bounds"]);
  assert.equal(code, 0);
  const analysis = JSON.parse(stdout);
  assert.equal(analysis.hasErrors, true);
  assert.equal(analysis.errors[0].type, "runtime_error");
});

test("CLI: godot unknown tool exits with error", async () => {
  const { code, stdout } = await runCli(["godot", "does-not-exist"]);
  assert.equal(code, 1);
  assert.match(stdout, /Unknown tool/);
});

test("CLI: --params-json escape hatch", async () => {
  const { code, stdout } = await runCli(["godot", "analyze-error", "--params-json", JSON.stringify({ output: "WARNING: something" })]);
  assert.equal(code, 0);
  const analysis = JSON.parse(stdout);
  assert.equal(analysis.warnings.length, 1);
});

test("CLI: mcp without a known subcommand shows usage", async () => {
  const { code, stdout } = await runCli(["mcp"]);
  assert.equal(code, 1);
  assert.match(stdout, /mcp serve/);
});

test("godot resolution order: explicit > GODOT_PATH env > findGodotBin", async () => {
  const fake = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-godot-")), "godot.exe");
  fs.writeFileSync(fake, "");

  assert.equal(await resolveGodotPath(fake), fake);
  await assert.rejects(() => resolveGodotPath(path.join(os.tmpdir(), "missing-godot.exe")), /not found/);

  const prevEnv = process.env.GODOT_PATH;
  try {
    process.env.GODOT_PATH = fake;
    assert.equal(await resolveGodotPath(), fake);
    process.env.GODOT_PATH = path.join(os.tmpdir(), "nope.exe");
    await assert.rejects(() => resolveGodotPath(), /GODOT_PATH/);
  } finally {
    if (prevEnv === undefined) delete process.env.GODOT_PATH;
    else process.env.GODOT_PATH = prevEnv;
  }
});

test("godot version via env-provided fake binary (skips when no Godot)", async (t) => {
  const bin = findGodotBin();
  if (!bin) {
    t.diagnostic("No Godot binary found; skipping godot-executing test");
    return;
  }
  try {
    await execFileAsync(bin, ["--version"], { timeout: 10000 });
  } catch {
    t.diagnostic(`Godot binary at ${bin} is not runnable; skipping`);
    return;
  }
  const { code, stdout } = await runCli(["godot", "get-godot-version"]);
  assert.equal(code, 0);
  assert.match(stdout, /\d+\.\d+/);
});
