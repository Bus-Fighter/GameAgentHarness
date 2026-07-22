import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OPERATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "operations");

const toolIndex = new Map();

function isValidToolDefinition(tool, moduleName) {
  if (!tool || typeof tool !== "object") return `module ${moduleName}: tool entry is not an object`;
  if (typeof tool.name !== "string" || tool.name === "") return `module ${moduleName}: tool missing name`;
  if (typeof tool.description !== "string") return `module ${moduleName}: tool ${tool.name} missing description`;
  if (!tool.inputSchema || typeof tool.inputSchema !== "object" || tool.inputSchema.type !== "object") {
    return `module ${moduleName}: tool ${tool.name} inputSchema must be a JSON schema object with type "object"`;
  }
  return null;
}

export function registerModule(mod, moduleName = "<inline>") {
  if (!Array.isArray(mod.tools)) {
    throw new Error(`operations module ${moduleName} must export const tools = [...]`);
  }
  if (typeof mod.handle !== "function") {
    throw new Error(`operations module ${moduleName} must export async function handle(toolName, args, ctx)`);
  }

  for (const tool of mod.tools) {
    const invalid = isValidToolDefinition(tool, moduleName);
    if (invalid) throw new Error(invalid);
    if (toolIndex.has(tool.name)) {
      throw new Error(`Duplicate tool name "${tool.name}" (already registered by ${toolIndex.get(tool.name).module})`);
    }
    toolIndex.set(tool.name, { tool, module: moduleName, handler: mod.handle });
  }
}

const scanned = fs.readdirSync(OPERATIONS_DIR)
  .filter((f) => f.endsWith(".js"))
  .sort();

for (const file of scanned) {
  const mod = await import(pathToFileURL(path.join(OPERATIONS_DIR, file)).href);
  registerModule(mod, file);
}

export function listTools() {
  return [...toolIndex.values()].map((entry) => entry.tool);
}

export async function dispatch(toolName, args, ctx) {
  const entry = toolIndex.get(toolName);
  if (!entry) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${toolName}. Use "harness godot tools" to list available tools.` }],
      isError: true,
    };
  }
  try {
    const result = await entry.handler(toolName, args ?? {}, ctx);
    if (!result || !Array.isArray(result.content)) {
      throw new Error(`Tool ${toolName} returned an invalid result (missing content array)`);
    }
    return result;
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error in ${toolName}: ${err.message}` }],
      isError: true,
    };
  }
}
