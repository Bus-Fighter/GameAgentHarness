#!/usr/bin/env node
import { ArtifactStore } from "./core/artifact-store.js";
import { buildSummary } from "./core/summary-builder.js";
import { HarnessHost } from "./host/harness-host.js";
import { emitSample } from "./dev/sample-events.js";
import { installGodotAdapter } from "./godot/install-adapter.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function usage() {
  console.log(`Game Agent Harness

Usage:
  harness host start [--host 127.0.0.1] [--port 8765] [--trace-dir traces]
  harness trace list [--trace-dir traces]
  harness trace summarize [latest|trace-id] [--trace-dir traces]
  harness dev emit-sample [--host 127.0.0.1] [--port 8765]
  harness godot install-adapter --project /path/to/GodotProject
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [group, command, target] = args._;
  const traceDir = args["trace-dir"] ?? "traces";

  if (!group || args.help) {
    usage();
    return;
  }

  if (group === "host" && command === "start") {
    const host = new HarnessHost({
      host: args.host ?? "127.0.0.1",
      port: Number(args.port ?? 8765),
      traceDir,
    });

    await host.start();
    console.log(`[harness] listening on ws://${args.host ?? "127.0.0.1"}:${Number(args.port ?? 8765)}`);
    console.log(`[harness] writing traces to ${traceDir}`);

    const shutdown = () => {
      console.log("\n[harness] stopping");
      host.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  if (group === "trace" && command === "list") {
    const store = new ArtifactStore(traceDir);
    const traces = store.listTraces();
    if (traces.length === 0) {
      console.log("No traces found.");
      return;
    }
    for (const trace of traces) {
      console.log(`${trace.id} ${trace.manifest.startedAt} events=${trace.manifest.counts?.events ?? 0}`);
    }
    return;
  }

  if (group === "trace" && command === "summarize") {
    const store = new ArtifactStore(traceDir);
    const traceId = target === "latest" || !target ? store.latestTraceId() : target;
    if (!traceId) {
      console.error("No trace found.");
      process.exitCode = 1;
      return;
    }
    console.log(buildSummary(store, traceId));
    return;
  }

  if (group === "dev" && command === "emit-sample") {
    await emitSample({
      host: args.host ?? "127.0.0.1",
      port: Number(args.port ?? 8765),
    });
    console.log("Sample events emitted.");
    return;
  }

  if (group === "godot" && command === "install-adapter") {
    const target = installGodotAdapter(args.project);
    console.log(`Installed Godot adapter to ${target}`);
    console.log("Enable it in Godot: Project > Project Settings > Plugins.");
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
