# Game Agent Harness

Game Agent Harness is a trace-first runtime evidence harness for game
development agents, and an MCP server for driving the Godot editor/runtime.

The core product is the local evidence pipeline:

```text
engine plugin -> harness host -> trace artifacts -> CLI/MCP/agent summary
```

The current implementation includes:

- dependency-free Node.js host
- JSON/JSONL trace artifacts
- project profiles for engine-neutral game context
- CLI for host, profile inspection, trace listing/summaries/inspection,
  current context, validation scenarios, static viewer export, sample events,
  and a live visual dashboard
- trace-based validation scenarios
- test-field fixture for demonstrating generic game-development evidence
- Godot adapter plugin skeleton with runtime and editor viewport streaming
- CatSweeper example project profile

## Quick Start

Start the local harness host with the live dashboard:

```bash
npm start
# in another terminal
npm run dashboard
```

Or start it bound to all interfaces so other devices on the LAN can reach it:

```bash
npm run dashboard:lan
```

Then open http://127.0.0.1:8766 in a browser to see the live viewport, current
context, and recent evidence gallery.

In another terminal, emit a synthetic sample trace through the host:

```bash
npm run sample
```

List traces:

```bash
node ./src/cli.js trace list
```

Summarize the latest trace:

```bash
npm run summary
```

## MCP Server

The harness exposes 130+ Godot/harness tools over MCP, via the dashboard's
HTTP endpoint (`http://127.0.0.1:8766/mcp`, press **Start** in the dashboard)
or standalone stdio:

```bash
node ./src/cli.js mcp serve --project-root /path/to/GodotProject
node ./src/cli.js godot tools   # list tools; godot <tool> runs one from the CLI
```

Full tool inventory, IDE configs, custom tools, and the safety model:
[`docs/MCP.md`](docs/MCP.md).

## Agent-Friendly CLI

The CLI is designed to expose enough context for a coding agent without making
MCP the core architecture.

```bash
node ./src/cli.js capabilities
node ./src/cli.js profile show --profile examples/test-field.profile.json
node ./src/cli.js context current latest --profile examples/test-field.profile.json
node ./src/cli.js trace inspect latest --stream all --limit 20
node ./src/cli.js validate scenario --scenario examples/test-field.validation.json --profile examples/test-field.profile.json
node ./src/cli.js viewer export latest --profile examples/test-field.profile.json --output /tmp/game-agent-harness-test-field.html
node ./src/cli.js dashboard start [--dashboard-port 8766]
```

### Live visual dashboard

The dashboard is a single-page, responsive web UI served by the harness host.
It works on desktop and mobile browsers and shows:

- **Live viewport**: the latest captured frame from the Godot editor or runtime.
- **Context panel**: current project, engine, scene, runtime state, selection,
  validations, and recent events.
- **Recent evidence gallery**: persisted screenshots tied to trace events.

Start it from the CLI:

```bash
node ./src/cli.js dashboard start
```

Or start it from the Godot editor using the **Game Agent Harness** dock panel
added by the adapter plugin.

Most inspection commands support `--json` for agent clients:

```bash
node ./src/cli.js context current latest --profile examples/test-field.profile.json --json
```

## Test Field Demo

The test field is a generic game-development fixture. It creates a trace with a
runtime scene, selected player entity, semantic gameplay events, a state
snapshot, a validation result, and an evidence artifact.

```bash
npm run test-field
npm run context
npm run validate:test-field
```

This demonstrates the generic framework without requiring Godot, Unity, Unreal,
or a running game editor.

## Try With Godot

Install the adapter into a Godot project:

```bash
node ./src/cli.js godot install-adapter --project /path/to/GodotProject
```

Then enable the plugin in the Godot editor.

The plugin connects to `ws://127.0.0.1:8765` by default and sends editor/runtime
events to the host. It also adds a dock panel that can start the harness
dashboard with one click, so you do not need to run the harness from a terminal.

While the dashboard is running, the adapter streams viewport screenshots from
both the editor and the running game. Persisted frames are saved as evidence
and shown in the dashboard gallery; live frames update the viewport panel in
near real time.

For CatSweeper-specific testing notes, see `docs/CATSweeper.md`.

## Artifact Layout

Each trace is a local folder:

```text
traces/<trace-id>/
  manifest.json
  context.json
  events.jsonl
  snapshots.jsonl
  logs.jsonl
  validations.jsonl
  summary.md
  evidence/
```

The trace files are intentionally local and readable. They are designed for
humans, coding agents, and future viewers.

The JSON schemas live under `schemas/`.

## Current Boundary

This project is engine-neutral at the host/core layer. Godot is only the first
adapter. CatSweeper is only an example target project.

The core framework is CLI/artifact-first; the MCP server wraps these same
profile, trace, context, validation, and Godot APIs rather than replacing
them. See [`docs/MCP.md`](docs/MCP.md).
