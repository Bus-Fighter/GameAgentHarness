import { textResult, errorResult } from "../util.js";

const BRIDGE_GUIDANCE = "Start the Godot editor or game with the game-agent-harness adapter connected (harness host WebSocket) and retry.";

export const tools = [
  {
    name: "console_list_commands",
    description: "List all commands registered in the game's CommandService (scopes flattened, e.g. \"info\" or \"userdata get\"). Requires a live engine connection.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "console_execute",
    description: "Execute a command in the game's CommandService (scopes like `info`/`userdata`, handlers with `-param value` syntax). This gives generic get/call access to the game's command system. Returns captured logs and execution events. Requires a live engine connection.",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "Command string to execute, e.g. \"info version\" or \"userdata get -key name\"" },
      },
      required: ["input"],
    },
  },
  {
    name: "actor_list",
    description: "List all Actor nodes (including Actor2D subclasses) currently in the live scene tree. Requires a live engine connection.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "actor_get",
    description: "Get details (name, type, path, childCount) for a single Actor node by its scene tree path. Requires a live engine connection.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Node path, e.g. \"/root/Main/Player\"" },
      },
      required: ["path"],
    },
  },
  {
    name: "binding_list_sources",
    description: "List all live scene tree nodes implementing IBindingSource. Requires a live engine connection.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "binding_list_types",
    description: "List registered binding source type names from BindingSourceRegistryHost. Requires a live engine connection.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "binding_get_keys",
    description: "List the binding keys registered for a given binding source type name. Requires a live engine connection.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Binding source type name (see binding_list_types)" },
      },
      required: ["type"],
    },
  },
];

async function engineCmd(ctx, command, params) {
  const bridge = ctx?.bridge;
  if (!bridge || typeof bridge.cmd !== "function") {
    return { error: `Engine bridge unavailable. ${BRIDGE_GUIDANCE}` };
  }
  try {
    const data = await bridge.cmd("game", command, params);
    return { data };
  } catch (err) {
    return { error: `Engine command game.${command} failed: ${err.message}. ${BRIDGE_GUIDANCE}` };
  }
}

export async function handle(toolName, args, ctx) {
  switch (toolName) {
    case "console_list_commands": {
      const { data, error } = await engineCmd(ctx, "console_list", {});
      if (error) return errorResult(error);
      return textResult(JSON.stringify(data, null, 2));
    }
    case "console_execute": {
      const input = typeof args.input === "string" ? args.input.trim() : "";
      if (!input) return errorResult('Error: "input" is required and must be a non-empty string.');
      const { data, error } = await engineCmd(ctx, "console_exec", { input });
      if (error) return errorResult(error);
      return textResult(JSON.stringify(data, null, 2));
    }
    case "actor_list": {
      const { data, error } = await engineCmd(ctx, "actor_list", {});
      if (error) return errorResult(error);
      return textResult(JSON.stringify(data, null, 2));
    }
    case "actor_get": {
      const path = typeof args.path === "string" ? args.path.trim() : "";
      if (!path) return errorResult('Error: "path" is required and must be a non-empty string.');
      const { data, error } = await engineCmd(ctx, "actor_get", { path });
      if (error) return errorResult(error);
      return textResult(JSON.stringify(data, null, 2));
    }
    case "binding_list_sources": {
      const { data, error } = await engineCmd(ctx, "binding_list_sources", {});
      if (error) return errorResult(error);
      return textResult(JSON.stringify(data, null, 2));
    }
    case "binding_list_types": {
      const { data, error } = await engineCmd(ctx, "binding_list_types", {});
      if (error) return errorResult(error);
      return textResult(JSON.stringify(data, null, 2));
    }
    case "binding_get_keys": {
      const type = typeof args.type === "string" ? args.type.trim() : "";
      if (!type) return errorResult('Error: "type" is required and must be a non-empty string.');
      const { data, error } = await engineCmd(ctx, "binding_get_keys", { type });
      if (error) return errorResult(error);
      return textResult(JSON.stringify(data, null, 2));
    }
    default:
      return errorResult(`No handler for tool: ${toolName}`);
  }
}
