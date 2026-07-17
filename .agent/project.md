# Project

## What we are building

Game Agent Harness is a trace-first runtime evidence harness for game development agents. It is not an MCP server; MCP can be added as one client adapter later. The core product is a local evidence pipeline:

```text
engine plugin -> harness host -> trace artifacts -> CLI/MCP/agent summary
```

It helps coding agents understand a running game through engine context, traces, and verification proof instead of screenshots, pasted logs, and manual descriptions.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Host | Node.js | Dependency-free runtime |
| Artifacts | JSON/JSONL | Human- and agent-readable |
| CLI | `src/cli.js` | Lists, summarizes, inspects, validates, exports, starts dashboard |
| Dashboard | React + TypeScript + Vite + Tailwind | Built static client served from `dist/dashboard` |
| Godot adapter | GDScript plugin | Connects to host via WebSocket/SSE fallback |
| Build/test | `npm start`, `npm test`, `npm run build:dashboard` | |

## Domain in one paragraph

A **trace** is a local folder of artifacts (`manifest.json`, `context.json`, `events.jsonl`, `snapshots.jsonl`, `logs.jsonl`, `validations.jsonl`, `summary.md`, `evidence/`). A **project profile** describes the engine, project root, important entities, semantic event types, and validation scenarios. The **host** accepts engine messages, normalizes them into trace events, writes artifacts, and serves the dashboard. **Validation scenarios** assert expectations against trace evidence without requiring a running editor.

## Non-obvious constraints

- Engine-neutral at the host/core layer; Godot is only the first adapter.
- Default behavior is read-only observation plus local artifact writing. Riskier features (saving scenes, mutating assets, executing engine scripts) must remain explicit and approval-bound.
- The harness is a developer-experience tool, not a CatSweeper gameplay mechanic.
- Checked out inside CatSweeper as the `Tools/GameAgentHarness` Git subtree.

## CatSweeper usage

From the CatSweeper repo root:

```bash
node Tools/GameAgentHarness/src/cli.js trace list --trace-dir Tools/GameAgentHarness/traces
node Tools/GameAgentHarness/src/cli.js trace summarize latest --trace-dir Tools/GameAgentHarness/traces
```

Start the host from `Tools/GameAgentHarness/` with `npm start`. The dashboard runs at `http://127.0.0.1:8766`.

See also CatSweeper's `systems/game-agent-harness.md` for CatSweeper-specific integration notes.
