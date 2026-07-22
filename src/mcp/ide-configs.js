import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_KEY = "game-agent-harness";

function toSlashes(p) {
  return p.replace(/\\/g, "/");
}

export function cliPath() {
  return toSlashes(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../cli.js"));
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function backupIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.bak-${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function claudeConfig(configPath, dashboardUrl) {
  return {
    path: configPath,
    write(existing) {
      const data = existing && typeof existing === "object" ? existing : {};
      data.mcpServers = data.mcpServers && typeof data.mcpServers === "object" ? data.mcpServers : {};
      data.mcpServers[SERVER_KEY] = { type: "http", url: dashboardUrl };
      writeJson(configPath, data);
    },
  };
}

function opencodeConfig(configPath) {
  return {
    path: configPath,
    write(existing) {
      const data = existing && typeof existing === "object" ? existing : {};
      data.mcp = data.mcp && typeof data.mcp === "object" ? data.mcp : {};
      data.mcp[SERVER_KEY] = {
        type: "local",
        command: ["node", cliPath(), "mcp", "serve"],
        enabled: true,
      };
      writeJson(configPath, data);
    },
  };
}

function cursorConfig(configPath) {
  return {
    path: configPath,
    write(existing) {
      const data = existing && typeof existing === "object" ? existing : {};
      data.mcpServers = data.mcpServers && typeof data.mcpServers === "object" ? data.mcpServers : {};
      data.mcpServers[SERVER_KEY] = { command: "node", args: [cliPath(), "mcp", "serve"] };
      writeJson(configPath, data);
    },
  };
}

const CODEX_SECTION_HEADER = "[mcp_servers.game-agent-harness]";

function codexConfig(configPath) {
  const section = [
    CODEX_SECTION_HEADER,
    'command = "node"',
    `args = ["${cliPath()}", "mcp", "serve"]`,
    "",
  ].join("\n");
  return {
    path: configPath,
    write() {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      let text = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
      if (text.includes(CODEX_SECTION_HEADER)) {
        const lines = text.split("\n");
        const start = lines.findIndex((line) => line.trim() === CODEX_SECTION_HEADER);
        let end = lines.length;
        for (let i = start + 1; i < lines.length; i += 1) {
          if (lines[i].trimStart().startsWith("[")) {
            end = i;
            break;
          }
        }
        lines.splice(start, end - start, section.trimEnd(), "");
        text = lines.join("\n");
      } else {
        if (text.length > 0 && !text.endsWith("\n")) text += "\n";
        text += `\n${section}`;
      }
      fs.writeFileSync(configPath, text);
    },
  };
}

export function listIdeConfigs({ projectRoot = process.cwd(), dashboardUrl = "http://127.0.0.1:8766/mcp", homeDir = os.homedir() } = {}) {
  const root = path.resolve(projectRoot);
  const cli = cliPath();

  const defs = [
    {
      id: "claude",
      label: "Claude Code",
      configPath: path.join(root, ".mcp.json"),
      installable: true,
      snippet: {
        mcpServers: { [SERVER_KEY]: { type: "http", url: dashboardUrl } },
      },
      altSnippet: {
        note: "stdio variant",
        mcpServers: { [SERVER_KEY]: { command: "node", args: [cli, "mcp", "serve"] } },
      },
      factory: claudeConfig,
    },
    {
      id: "codex",
      label: "Codex",
      configPath: path.join(homeDir, ".codex", "config.toml"),
      installable: true,
      snippet: [
        "[mcp_servers.game-agent-harness]",
        'command = "node"',
        `args = ["${cli}", "mcp", "serve"]`,
      ].join("\n"),
      factory: codexConfig,
    },
    {
      id: "opencode",
      label: "OpenCode",
      configPath: path.join(root, "opencode.json"),
      installable: true,
      snippet: {
        mcp: {
          [SERVER_KEY]: { type: "local", command: ["node", cli, "mcp", "serve"], enabled: true },
        },
      },
      factory: opencodeConfig,
    },
    {
      id: "cursor",
      label: "Cursor",
      configPath: path.join(root, ".cursor", "mcp.json"),
      installable: true,
      snippet: {
        mcpServers: { [SERVER_KEY]: { command: "node", args: [cli, "mcp", "serve"] } },
      },
      factory: cursorConfig,
    },
    {
      id: "generic",
      label: "Generic MCP client",
      configPath: null,
      installable: false,
      snippet: {
        http: { type: "http", url: dashboardUrl },
        stdio: { command: "node", args: [cli, "mcp", "serve"] },
      },
      factory: null,
    },
  ];

  return defs.map((def) => {
    const exists = def.configPath ? fs.existsSync(def.configPath) : false;
    let configured = false;
    if (exists) {
      if (def.id === "codex") {
        configured = fs.readFileSync(def.configPath, "utf8").includes("[mcp_servers.game-agent-harness]");
      } else {
        const data = readJsonSafe(def.configPath);
        configured = Boolean(data?.mcpServers?.[SERVER_KEY] ?? data?.mcp?.[SERVER_KEY]);
      }
    }
    return {
      id: def.id,
      label: def.label,
      configPath: def.configPath ? toSlashes(def.configPath) : null,
      exists,
      configured,
      snippet: def.snippet,
      altSnippet: def.altSnippet ?? null,
      installable: def.installable,
    };
  });
}

export function installIdeConfig({ ide, projectRoot = process.cwd(), dashboardUrl = "http://127.0.0.1:8766/mcp", homeDir = os.homedir() } = {}) {
  const root = path.resolve(projectRoot);
  let config;
  if (ide === "claude") config = claudeConfig(path.join(root, ".mcp.json"), dashboardUrl);
  else if (ide === "codex") config = codexConfig(path.join(homeDir, ".codex", "config.toml"));
  else if (ide === "opencode") config = opencodeConfig(path.join(root, "opencode.json"));
  else if (ide === "cursor") config = cursorConfig(path.join(root, ".cursor", "mcp.json"));
  else throw new Error(`Unknown or non-installable IDE: ${ide}`);

  const existing = config.path.endsWith(".json") ? readJsonSafe(config.path) : null;
  const backupPath = backupIfExists(config.path);
  config.write(existing);
  return { ok: true, path: toSlashes(config.path), backupPath: backupPath ? toSlashes(backupPath) : null };
}
