#!/usr/bin/env node
import { ArtifactStore } from "./core/artifact-store.js";
import { buildCurrentContext } from "./core/context-builder.js";
import { getCapabilities, formatCapabilities } from "./core/capabilities.js";
import { loadProfile, resolveTraceDir } from "./core/profile.js";
import { getLanIp } from "./core/network.js";
import { buildSummary } from "./core/summary-builder.js";
import { filterTimeline, readTrace, resolveTraceId } from "./core/trace-reader.js";
import { loadScenario, runScenario } from "./core/validation-runner.js";
import { exportViewer } from "./core/viewer-exporter.js";
import { HarnessHost } from "./host/harness-host.js";
import { emitSample } from "./dev/sample-events.js";
import { createTestFieldTrace } from "./dev/test-field.js";
import { installGodotAdapter } from "./godot/install-adapter.js";


function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
      const next = argv[i + 1];
      if (inlineValue != null) {
        args[rawKey] = inlineValue;
      } else if (next && !next.startsWith("--")) {
        args[rawKey] = next;
        i += 1;
      } else {
        args[rawKey] = true;
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
  harness capabilities [--json]
  harness host start [--host 127.0.0.1] [--port 8765] [--trace-dir traces] [--project-root <path>]
  harness dashboard start [--host 127.0.0.1] [--port 8765] [--dashboard-host 127.0.0.1] [--dashboard-port 8766] [--trace-dir traces] [--project-root <path>] [--godot-bin <path>]
  harness profile show --profile examples/test-field.profile.json [--json]
  harness context current [latest|trace-id] [--profile file] [--trace-dir traces] [--json]
  harness trace list [--trace-dir traces] [--json]
  harness trace summarize [latest|trace-id] [--trace-dir traces]
  harness trace inspect [latest|trace-id] [--trace-dir traces] [--stream all|events|snapshots|logs|validations] [--type prefix.or.type] [--limit 20] [--json]
  harness validate scenario --scenario examples/test-field.validation.json [--profile file] [--trace latest|trace-id] [--trace-dir traces] [--json]
  harness viewer export [latest|trace-id] --output /tmp/trace.html [--profile file] [--trace-dir traces] [--json]
  harness dev create-test-field [--trace-dir traces] [--json]
  harness dev emit-sample [--host 127.0.0.1] [--port 8765]
  harness godot install-adapter --project /path/to/GodotProject
`);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function loadCliProfile(args) {
  return args.profile ? loadProfile(args.profile) : null;
}

function cliStore(args, profile = null) {
  return new ArtifactStore(resolveTraceDir({ traceDir: args["trace-dir"], profile }));
}

function requiredTraceId(store, requested) {
  const traceId = resolveTraceId(store, requested);
  if (!traceId) {
    throw new Error("No trace found. Create one with `harness dev create-test-field` or run the host with an engine adapter.");
  }
  return traceId;
}

function formatTraceItem(item) {
  const frame = item.frame == null ? "" : ` frame=${item.frame}`;
  const entity = item.entity?.name ?? item.entity?.path ?? item.entity?.id ?? "none";
  return `#${item.seq} [${item.stream}] ${item.type}${frame} entity=${entity}`;
}

function formatContext(context) {
  const lines = [
    `# Current Harness Context: ${context.traceId}`,
    "",
    `- Project: ${context.observed.project?.name ?? context.profile.project.name}`,
    `- Engine: ${context.observed.engine?.name ?? context.profile.engine.name}`,
    `- Scene: ${context.scene ?? "unknown"}`,
    `- Runtime running: ${context.runtime.running}`,
    `- Selected: ${context.selected?.name ?? context.selected?.path ?? "none"}`,
    `- Latest snapshot: ${context.latestSnapshot ? "present" : "none"}`,
    `- Semantic events: ${context.semanticEvents.length}`,
    `- Errors: ${context.errors.length}`,
    `- Validations: ${context.validations.passed} passed, ${context.validations.failed} failed`,
    "",
    "## Important Entities",
    "",
  ];

  if (context.importantEntities.length === 0) {
    lines.push("- none configured");
  } else {
    for (const entity of context.importantEntities) {
      lines.push(`- ${entity.role}: ${entity.matched ? entity.label : "not observed"}`);
    }
  }

  lines.push("", "## Recent Timeline", "");
  for (const item of context.recentTimeline) {
    lines.push(`- #${item.seq} [${item.stream}] ${item.type} entity=${item.entity}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function formatValidation(result) {
  const lines = [
    `# Validation Scenario: ${result.name}`,
    "",
    `- Trace: ${result.traceId}`,
    `- Result: ${result.ok ? "PASS" : "FAIL"}`,
    `- Checks: ${result.passed} passed, ${result.failed} failed`,
    "",
  ];

  for (const check of result.checks) {
    lines.push(`- ${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.message}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [group, command, target] = args._;

  if (!group || args.help) {
    usage();
    return;
  }

  if (group === "capabilities") {
    const capabilities = getCapabilities();
    if (args.json) {
      printJson(capabilities);
    } else {
      console.log(formatCapabilities(capabilities));
    }
    return;
  }

  if (group === "host" && command === "start") {
    const host = new HarnessHost({
      host: args.host ?? "127.0.0.1",
      port: Number(args.port ?? 8765),
      traceDir: args["trace-dir"] ?? "traces",
      projectRoot: args["project-root"] ?? process.cwd(),
    });

    await host.start();
    const hostAddr = (args.host ?? "127.0.0.1") === "0.0.0.0" ? getLanIp() : (args.host ?? "127.0.0.1");
    console.log(`[harness] listening on ws://${hostAddr}:${Number(args.port ?? 8765)}`);
    console.log(`[harness] writing traces to ${args["trace-dir"] ?? "traces"}`);

    const shutdown = () => {
      console.log("\n[harness] stopping");
      host.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  if (group === "dashboard" && command === "start") {
    const dashboardHost = args["dashboard-host"] ?? "127.0.0.1";
    const dashboardPort = Number(args["dashboard-port"] ?? 8766);
    const host = new HarnessHost({
      host: args.host ?? "127.0.0.1",
      port: Number(args.port ?? 8765),
      traceDir: args["trace-dir"] ?? "traces",
      projectRoot: args["project-root"] ?? process.cwd(),
      dashboard: true,
      dashboardHost,
      dashboardPort,
      godotBin: args["godot-bin"] ?? null,
    });

    await host.start();
    const intakeHost = (args.host ?? "127.0.0.1") === "0.0.0.0" ? getLanIp() : (args.host ?? "127.0.0.1");
    const dashboardHostDisplay = dashboardHost === "0.0.0.0" ? getLanIp() : dashboardHost;
    console.log(`[harness] intake ws://${intakeHost}:${Number(args.port ?? 8765)}`);
    console.log(`[harness] dashboard http://${dashboardHostDisplay}:${dashboardPort}`);
    console.log(`[harness] writing traces to ${args["trace-dir"] ?? "traces"}`);

    const shutdown = () => {
      console.log("\n[harness] stopping");
      host.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  if (group === "profile" && command === "show") {
    const profile = loadProfile(args.profile);
    if (!profile) {
      throw new Error("Missing --profile <file>.");
    }
    if (args.json) {
      printJson(profile);
    } else {
      console.log(`# Profile: ${profile.project.name}\n`);
      console.log(`- Engine: ${profile.engine.name}`);
      console.log(`- Trace dir: ${profile.traceDir ?? "<command default>"}`);
      console.log(`- Important entities: ${profile.importantEntities.length}`);
      console.log(`- Semantic events: ${profile.semanticEvents.length}`);
      console.log(`- Validation scenarios: ${profile.validationScenarios.length}`);
    }
    return;
  }

  if (group === "trace" && command === "list") {
    const profile = loadCliProfile(args);
    const store = cliStore(args, profile);
    const traces = store.listTraces();
    if (args.json) {
      printJson({ traceDir: store.rootDir, traces });
      return;
    }
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
    const profile = loadCliProfile(args);
    const store = cliStore(args, profile);
    const traceId = requiredTraceId(store, target ?? "latest");
    console.log(buildSummary(store, traceId));
    return;
  }

  if (group === "trace" && command === "inspect") {
    const profile = loadCliProfile(args);
    const store = cliStore(args, profile);
    const traceId = requiredTraceId(store, target ?? "latest");
    const trace = readTrace(store, traceId);
    const items = filterTimeline(trace, {
      stream: args.stream ?? "all",
      type: args.type ?? null,
      source: args.source ?? null,
      limit: args.limit ? Number(args.limit) : 20,
    });
    if (args.json) {
      printJson({ traceId, count: items.length, items });
    } else {
      console.log(`# Trace Inspect: ${traceId}\n`);
      for (const item of items) {
        console.log(`- ${formatTraceItem(item)}`);
      }
    }
    return;
  }

  if (group === "context" && command === "current") {
    const profile = loadCliProfile(args);
    const store = cliStore(args, profile);
    const traceId = requiredTraceId(store, target ?? "latest");
    const context = buildCurrentContext(store, traceId, { profile });
    if (args.json) {
      printJson(context);
    } else {
      console.log(formatContext(context));
    }
    return;
  }

  if (group === "validate") {
    const profile = loadCliProfile(args);
    const scenarioPath = args.scenario ?? (command === "scenario" ? target : command);
    if (!scenarioPath) {
      throw new Error("Missing validation scenario. Use --scenario <file>.");
    }
    const store = cliStore(args, profile);
    const traceId = requiredTraceId(store, args.trace ?? "latest");
    const scenario = loadScenario(scenarioPath);
    const result = runScenario({ store, traceId, profile, scenario });
    if (args.json) {
      printJson(result);
    } else {
      console.log(formatValidation(result));
    }
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }


  if (group === "viewer" && command === "export") {
    const profile = loadCliProfile(args);
    const store = cliStore(args, profile);
    const traceId = requiredTraceId(store, target ?? "latest");
    if (!args.output) {
      throw new Error("Missing --output <html-file>.");
    }
    const result = exportViewer({ store, traceId, profile, outputPath: args.output });
    if (args.json) {
      printJson(result);
    } else {
      console.log(`Exported trace viewer for ${result.traceId}`);
      console.log(`Output: ${result.outputPath}`);
      console.log(`Timeline events: ${result.events}`);
      console.log(`Evidence references: ${result.evidence}`);
    }
    return;
  }

  if (group === "dev" && command === "create-test-field") {
    const profile = loadCliProfile(args);
    const traceDir = resolveTraceDir({ traceDir: args["trace-dir"], profile });
    const result = createTestFieldTrace({ traceDir });
    if (args.json) {
      printJson(result);
    } else {
      console.log(`Created test-field trace ${result.traceId}`);
      console.log(`Trace dir: ${result.traceDir}`);
      console.log(`Summary: ${result.summaryPath}`);
      console.log(`Evidence: ${result.evidencePath}`);
    }
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
