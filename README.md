# Game Agent Harness

Game Agent Harness is a trace-first runtime evidence harness for game
development agents.

It is not a Godot MCP server. MCP can be added as one client adapter later. The
core product is the local evidence pipeline:

```text
engine plugin -> harness host -> trace artifacts -> CLI/MCP/agent summary
```

The current implementation includes:

- dependency-free Node.js host
- JSON/JSONL trace artifacts
- project profiles for engine-neutral game context
- CLI for host, profile inspection, trace listing/summaries/inspection,
  current context, validation scenarios, static viewer export, and sample events
- trace-based validation scenarios
- test-field fixture for demonstrating generic game-development evidence
- Godot adapter plugin skeleton
- CatSweeper example project profile

## Quick Start

Start the local harness host:

```bash
npm start
```

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
```

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
events to the host.

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

The core framework is now CLI/artifact-first. A future MCP adapter should wrap
these same profile, trace, context, and validation APIs rather than replace
them.
