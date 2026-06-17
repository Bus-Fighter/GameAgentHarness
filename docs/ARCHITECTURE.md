# Architecture

The harness is centered on evidence, not tools.

```text
Agent / CLI / MCP
      |
Trace query API
      |
Harness host
      |
Trace artifact store
      |
Engine adapter connection
      |
Godot / Unity / Unreal / custom engine
```

## Core Responsibilities

- normalize incoming engine messages into trace events
- maintain a trace session
- write portable artifacts
- summarize recent runtime evidence
- keep engine-specific code outside the core

## Engine Adapter Contract

Adapters send JSON messages over a local transport. The current transport is
WebSocket, but the message model is transport-independent.

Common message shape:

```json
{
  "kind": "event",
  "type": "input.pointer.pressed",
  "source": "godot",
  "engine": {
    "name": "godot",
    "version": "4.5"
  },
  "project": {
    "name": "CatSweeper",
    "root": "/path/to/CatSweeper"
  },
  "frame": 120,
  "engineTimeMs": 2400,
  "entity": {
    "id": "godot:node:/root/Stage",
    "kind": "node",
    "name": "Stage"
  },
  "data": {}
}
```

## Trace Categories

The host routes messages to files by type:

- `log.*` -> `logs.jsonl`
- `state.*`, `snapshot.*` -> `snapshots.jsonl`
- `validation.*` -> `validations.jsonl`
- everything else -> `events.jsonl`

## Why Not MCP First

MCP is a good client adapter, but it is not the observability model. The harness
must work even when MCP is absent:

```text
CLI can read traces.
Agents can read trace folders.
A future viewer can open artifacts.
MCP can expose the same data as tools/resources.
```

## Future Packages

The current prototype is intentionally compact. It can later split into:

- `core`: schemas, trace model, summary builder
- `host`: engine connections and artifact store
- `cli`: local commands
- `mcp`: MCP server adapter
- `adapters/godot`: Godot plugin
- `adapters/unity`: Unity plugin
- `viewer`: trace viewer UI
