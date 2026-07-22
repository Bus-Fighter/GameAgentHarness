import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { textResult, errorResult } from "../util.js";

const OPERATIONS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SELF_FILE = path.join(OPERATIONS_DIR, "custom-declared.js");
const NAME_RE = /^[a-z][a-z0-9_]*$/;

function loadDeclared(projectRoot) {
  const file = path.join(projectRoot, ".harness", "custom-tools.json");
  if (!fs.existsSync(file)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`[custom-declared] failed to parse ${file}: ${err.message}`);
    return [];
  }
  const entries = Array.isArray(parsed?.tools) ? parsed.tools : [];
  const valid = [];
  const seen = new Set();
  for (const entry of entries) {
    const name = entry?.name;
    if (typeof name !== "string" || !NAME_RE.test(name)) {
      console.error(`[custom-declared] skipping tool with invalid name: ${JSON.stringify(name)}`);
      continue;
    }
    if (seen.has(name)) {
      console.error(`[custom-declared] skipping duplicate tool name: ${name}`);
      continue;
    }
    if (typeof entry.description !== "string" || entry.description === "") {
      console.error(`[custom-declared] skipping ${name}: missing description`);
      continue;
    }
    const target = entry.target;
    if (!target || typeof target.domain !== "string" || typeof target.command !== "string") {
      console.error(`[custom-declared] skipping ${name}: target.domain and target.command are required`);
      continue;
    }
    const inputSchema = entry.inputSchema && typeof entry.inputSchema === "object" && entry.inputSchema.type === "object"
      ? entry.inputSchema
      : { type: "object", properties: {} };
    const paramMap = entry.target.paramMap && typeof entry.target.paramMap === "object" ? entry.target.paramMap : {};
    seen.add(name);
    valid.push({ name, description: entry.description, inputSchema, target: { domain: target.domain, command: target.command, paramMap } });
  }
  return valid;
}

async function builtinToolNames() {
  const names = new Set();
  let files = [];
  try {
    files = fs.readdirSync(OPERATIONS_DIR).filter((f) => f.endsWith(".js"));
  } catch {
    return names;
  }
  for (const file of files) {
    const full = path.join(OPERATIONS_DIR, file);
    if (full === SELF_FILE) continue;
    try {
      const mod = await import(pathToFileURL(full).href);
      if (Array.isArray(mod.tools)) {
        for (const tool of mod.tools) {
          if (typeof tool?.name === "string") names.add(tool.name);
        }
      }
    } catch {
    }
  }
  return names;
}

async function resolveDeclared(projectRoot) {
  const declared = loadDeclared(projectRoot);
  if (declared.length === 0) return [];
  const builtins = await builtinToolNames();
  return declared.filter((tool) => {
    if (builtins.has(tool.name)) {
      console.error(`[custom-declared] skipping ${tool.name}: collides with a built-in tool`);
      return false;
    }
    return true;
  });
}

const initialTools = await resolveDeclared(process.cwd());

export const tools = initialTools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));

export async function handle(toolName, args, ctx) {
  const projectRoot = ctx?.projectRoot ?? process.cwd();
  const declared = await resolveDeclared(projectRoot);
  const tool = declared.find((t) => t.name === toolName);
  if (!tool) {
    return errorResult(`No declared custom tool: ${toolName}`);
  }
  const bridge = ctx?.bridge;
  if (!bridge || typeof bridge.cmd !== "function") {
    return errorResult("Engine bridge unavailable. Start the Godot editor or game with the game-agent-harness adapter connected and retry.");
  }
  const mapped = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    mapped[tool.target.paramMap[key] ?? key] = value;
  }
  try {
    const data = await bridge.cmd(tool.target.domain, tool.target.command, mapped);
    return textResult(JSON.stringify(data, null, 2));
  } catch (err) {
    return errorResult(`Engine command ${tool.target.domain}.${tool.target.command} failed: ${err.message}`);
  }
}
