import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliPath, installIdeConfig, listIdeConfigs } from "../src/mcp/ide-configs.js";

function makeEnv(t) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ide-proj-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ide-home-"));
  t.after(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });
  return { projectRoot, homeDir, dashboardUrl: "http://127.0.0.1:8766/mcp" };
}

test("listIdeConfigs returns snippets for all IDEs", (t) => {
  const env = makeEnv(t);
  const ides = listIdeConfigs(env);
  const byId = Object.fromEntries(ides.map((ide) => [ide.id, ide]));

  assert.deepEqual(ides.map((ide) => ide.id).sort(), ["claude", "codex", "cursor", "generic", "opencode"]);

  assert.equal(byId.claude.configPath, path.join(env.projectRoot, ".mcp.json").replace(/\\/g, "/"));
  assert.equal(byId.claude.snippet.mcpServers["game-agent-harness"].url, env.dashboardUrl);
  assert.ok(byId.claude.altSnippet.mcpServers["game-agent-harness"].args[0].endsWith("cli.js"));

  assert.equal(byId.codex.configPath, path.join(env.homeDir, ".codex", "config.toml").replace(/\\/g, "/"));
  assert.match(byId.codex.snippet, /\[mcp_servers\.game-agent-harness\]/);
  assert.doesNotMatch(byId.codex.snippet, /\\\\/);

  assert.equal(byId.opencode.snippet.mcp["game-agent-harness"].type, "local");
  assert.equal(byId.opencode.snippet.mcp["game-agent-harness"].command[1], cliPath());

  assert.equal(byId.cursor.configPath, path.join(env.projectRoot, ".cursor", "mcp.json").replace(/\\/g, "/"));

  assert.equal(byId.generic.installable, false);
  assert.ok(byId.generic.snippet.http.url);
  assert.ok(byId.generic.snippet.stdio.command);

  for (const ide of ides) {
    assert.equal(ide.exists, false);
    assert.equal(ide.configured, false);
  }
});

test("install claude writes .mcp.json and reports configured", (t) => {
  const env = makeEnv(t);
  const result = installIdeConfig({ ide: "claude", ...env });
  assert.equal(result.ok, true);
  assert.equal(result.backupPath, null);
  const data = JSON.parse(fs.readFileSync(path.join(env.projectRoot, ".mcp.json"), "utf8"));
  assert.equal(data.mcpServers["game-agent-harness"].type, "http");
  assert.equal(data.mcpServers["game-agent-harness"].url, env.dashboardUrl);

  const ides = listIdeConfigs(env);
  const claude = ides.find((ide) => ide.id === "claude");
  assert.equal(claude.exists, true);
  assert.equal(claude.configured, true);
});

test("install opencode merges into existing opencode.json and is idempotent", (t) => {
  const env = makeEnv(t);
  const configPath = path.join(env.projectRoot, "opencode.json");
  fs.writeFileSync(configPath, JSON.stringify({ model: "x/y", mcp: { notion: { type: "remote", url: "https://example.com", enabled: true } } }, null, 2));

  const first = installIdeConfig({ ide: "opencode", ...env });
  assert.ok(first.backupPath);
  assert.ok(fs.existsSync(first.backupPath.replace(/\//g, path.sep)));

  installIdeConfig({ ide: "opencode", ...env });
  const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(data.model, "x/y");
  assert.ok(data.mcp.notion);
  assert.equal(data.mcp["game-agent-harness"].type, "local");
  assert.deepEqual(data.mcp["game-agent-harness"].command, ["node", cliPath(), "mcp", "serve"]);
  assert.equal(Object.keys(data.mcp).filter((key) => key === "game-agent-harness").length, 1);
});

test("install codex appends TOML section and replaces on reinstall", (t) => {
  const env = makeEnv(t);
  const configPath = path.join(env.homeDir, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, 'model = "gpt-5"\n\n[other]\nvalue = 1\n');

  installIdeConfig({ ide: "codex", ...env });
  let text = fs.readFileSync(configPath, "utf8");
  assert.match(text, /\[mcp_servers\.game-agent-harness\]/);
  assert.match(text, /command = "node"/);
  assert.match(text, /\[other\]/);

  installIdeConfig({ ide: "codex", ...env });
  text = fs.readFileSync(configPath, "utf8");
  const occurrences = text.split("[mcp_servers.game-agent-harness]").length - 1;
  assert.equal(occurrences, 1);
  assert.match(text, /\[other\]/);

  const codex = listIdeConfigs(env).find((ide) => ide.id === "codex");
  assert.equal(codex.exists, true);
  assert.equal(codex.configured, true);
});

test("install cursor writes .cursor/mcp.json", (t) => {
  const env = makeEnv(t);
  const result = installIdeConfig({ ide: "cursor", ...env });
  assert.equal(result.ok, true);
  const data = JSON.parse(fs.readFileSync(path.join(env.projectRoot, ".cursor", "mcp.json"), "utf8"));
  assert.deepEqual(data.mcpServers["game-agent-harness"], { command: "node", args: [cliPath(), "mcp", "serve"] });
});

test("install generic or unknown ide throws", (t) => {
  const env = makeEnv(t);
  assert.throws(() => installIdeConfig({ ide: "generic", ...env }), /Unknown or non-installable/);
  assert.throws(() => installIdeConfig({ ide: "vim", ...env }), /Unknown or non-installable/);
});
