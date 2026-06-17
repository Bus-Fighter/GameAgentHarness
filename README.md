# Game Agent Harness

Game Agent Harness is a trace-first runtime evidence harness for game
development agents.

It is not a Godot MCP server. MCP can be added as one client adapter later. The
core product is the local evidence pipeline:

```text
engine plugin -> harness host -> trace artifacts -> CLI/MCP/agent summary
```

The first implementation includes:

- dependency-free Node.js host
- JSON/JSONL trace artifacts
- CLI for host, trace listing, summaries, and sample events
- Godot adapter plugin skeleton
- CatSweeper example project profile

## Quick Start

Start the local harness host:

```bash
npm start
```

In another terminal, emit a synthetic sample trace:

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

The initial JSON schemas live under `schemas/`.

## Current Boundary

This project is engine-neutral at the host/core layer. Godot is only the first
adapter. CatSweeper is only an example target project.
