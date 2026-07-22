import { textResult, errorResult, opsErrorResult } from "../util.js";
import { ArtifactStore } from "../../core/artifact-store.js";
import { readTrace, resolveTraceId, filterTimeline } from "../../core/trace-reader.js";
import { buildSummary } from "../../core/summary-builder.js";
import { buildCurrentContext } from "../../core/context-builder.js";
import { loadScenario, runScenario } from "../../core/validation-runner.js";

function bridgeUnavailableResult() {
  return errorResult(
    "Engine bridge is not available. Start the harness host with an attached Godot editor/game " +
    "(harness host start) so ctx.bridge can reach the engine, then retry. " +
    "See adapters/godot/COMMANDS.md for the editor.* / game.* command list.",
  );
}

function bridgeAvailable(ctx) {
  return ctx.bridge && typeof ctx.bridge.isAvailable === "function" && ctx.bridge.isAvailable();
}

export const tools = [
  {
    name: "harness_list_traces",
    description: "List all harness traces in the trace directory: id, startedAt/endedAt, and per-stream event counts.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "harness_trace_summarize",
    description: "Build a markdown summary for a trace (context, counts, recent timeline). Defaults to the latest trace.",
    inputSchema: {
      type: "object",
      properties: {
        traceId: { type: "string", description: "Trace id (default: \"latest\")", default: "latest" },
      },
    },
  },
  {
    name: "harness_trace_inspect",
    description: "Inspect trace timeline items, optionally filtered by stream (events/snapshots/logs/validations), type prefix, and limit.",
    inputSchema: {
      type: "object",
      properties: {
        traceId: { type: "string", description: "Trace id (default: \"latest\")", default: "latest" },
        stream: { type: "string", description: "Stream to read: events, snapshots, logs, validations, or all (default: all)", default: "all" },
        type: { type: "string", description: "Event type or type prefix filter (e.g. \"player\" matches player.hp_changed)" },
        limit: { type: "number", description: "Return only the last N matching items" },
      },
    },
  },
  {
    name: "harness_get_context",
    description: "Get the current agent-facing context JSON for a trace: runtime/scene state, latest snapshot, important entities, errors, validations, recent timeline.",
    inputSchema: {
      type: "object",
      properties: {
        traceId: { type: "string", description: "Trace id (default: \"latest\")", default: "latest" },
      },
    },
  },
  {
    name: "harness_validate_scenario",
    description: "Run a validation scenario (JSON file with expect[] checks) against a trace and return structured pass/fail per check.",
    inputSchema: {
      type: "object",
      properties: {
        scenario: { type: "string", description: "Path to the scenario JSON file" },
        traceId: { type: "string", description: "Trace id (default: \"latest\")", default: "latest" },
      },
      required: ["scenario"],
    },
  },
  {
    name: "harness_capture_frame",
    description: "Capture the latest live frame from the running game via the engine bridge (game.screenshot). Frame bytes arrive via the host frame pipeline; the latest frame is also served at /api/live/frame on the dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        persist: { type: "boolean", description: "Persist the frame into the trace evidence directory (default: false)", default: false },
      },
    },
  },
  {
    name: "harness_editor_logs",
    description: "Get recent log-stream events (log.info, log.error, ...) from the latest (or given) trace.",
    inputSchema: {
      type: "object",
      properties: {
        traceId: { type: "string", description: "Trace id (default: \"latest\")", default: "latest" },
        limit: { type: "number", description: "Return only the last N log items (default: 50)", default: 50 },
      },
    },
  },
  {
    name: "engine_command",
    description: "Generic passthrough to the live engine bridge: send an editor.* or game.* command (see adapters/godot/COMMANDS.md for the full command list, e.g. editor.get_scene_tree, game.get_tree, game.input_action). Requires an available engine bridge.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Command domain: \"editor\" or \"game\"" },
        command: { type: "string", description: "Command name within the domain (e.g. \"get_tree\", \"screenshot\")" },
        params: { type: "object", description: "Command parameters (default: {})", default: {} },
      },
      required: ["domain", "command"],
    },
  },
];

function resolveStoreAndTrace(ctx, args) {
  const store = new ArtifactStore(ctx.traceDir);
  const traceId = resolveTraceId(store, args.traceId ?? "latest");
  if (!traceId) {
    return { store, traceId: null };
  }
  return { store, traceId };
}

export async function handle(toolName, args, ctx) {
  switch (toolName) {
    case "harness_list_traces": {
      const store = new ArtifactStore(ctx.traceDir);
      const traces = store.listTraces().map(({ id, manifest }) => ({
        id,
        startedAt: manifest.startedAt ?? null,
        endedAt: manifest.endedAt ?? null,
        counts: manifest.counts ?? {},
      }));
      return textResult(JSON.stringify({ traceDir: store.rootDir, count: traces.length, traces }, null, 2));
    }

    case "harness_trace_summarize": {
      const { store, traceId } = resolveStoreAndTrace(ctx, args);
      if (!traceId) {
        return opsErrorResult("NO_TRACE", `No traces found in ${store.rootDir}`);
      }
      return textResult(buildSummary(store, traceId));
    }

    case "harness_trace_inspect": {
      const { store, traceId } = resolveStoreAndTrace(ctx, args);
      if (!traceId) {
        return opsErrorResult("NO_TRACE", `No traces found in ${store.rootDir}`);
      }
      const trace = readTrace(store, traceId);
      const items = filterTimeline(trace, {
        stream: args.stream ?? "all",
        type: args.type ?? null,
        limit: args.limit ?? null,
      });
      return textResult(JSON.stringify({ traceId, count: items.length, items }, null, 2));
    }

    case "harness_get_context": {
      const { store, traceId } = resolveStoreAndTrace(ctx, args);
      if (!traceId) {
        return opsErrorResult("NO_TRACE", `No traces found in ${store.rootDir}`);
      }
      const context = buildCurrentContext(store, traceId, { profile: ctx.profile ?? null });
      return textResult(JSON.stringify(context, null, 2));
    }

    case "harness_validate_scenario": {
      if (typeof args.scenario !== "string" || args.scenario.trim() === "") {
        return opsErrorResult("INVALID_PARAMS", "scenario is required (path to a scenario JSON file)");
      }
      const { store, traceId } = resolveStoreAndTrace(ctx, args);
      if (!traceId) {
        return opsErrorResult("NO_TRACE", `No traces found in ${store.rootDir}`);
      }
      const scenario = loadScenario(args.scenario);
      const result = runScenario({ store, traceId, profile: ctx.profile ?? null, scenario });
      return textResult(JSON.stringify(result, null, 2));
    }

    case "harness_capture_frame": {
      if (!(await bridgeAvailable(ctx))) {
        return bridgeUnavailableResult();
      }
      const data = await ctx.bridge.cmd("game", "screenshot", { persist: args.persist === true });
      return textResult(JSON.stringify({
        ok: true,
        data,
        frameUrl: "/api/live/frame",
        hint: "Frame bytes are delivered via the host frame pipeline; fetch the latest frame from the dashboard endpoint /api/live/frame.",
      }, null, 2));
    }

    case "harness_editor_logs": {
      const { store, traceId } = resolveStoreAndTrace(ctx, args);
      if (!traceId) {
        return opsErrorResult("NO_TRACE", `No traces found in ${store.rootDir}`);
      }
      const trace = readTrace(store, traceId);
      const items = filterTimeline(trace, {
        stream: "logs",
        limit: args.limit ?? 50,
      });
      return textResult(JSON.stringify({ traceId, count: items.length, items }, null, 2));
    }

    case "engine_command": {
      if (!(await bridgeAvailable(ctx))) {
        return bridgeUnavailableResult();
      }
      const domain = String(args.domain ?? "");
      const command = String(args.command ?? "");
      if (!domain || !command) {
        return opsErrorResult("INVALID_PARAMS", "domain and command are required");
      }
      const params = args.params && typeof args.params === "object" ? args.params : {};
      const data = await ctx.bridge.cmd(domain, command, params);
      return textResult(JSON.stringify({ ok: true, domain, command, data }, null, 2));
    }

    default:
      return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  }
}
