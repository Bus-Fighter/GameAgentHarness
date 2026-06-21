# Architecture

The harness is centered on evidence, not tools.

```text
Agent / CLI / MCP / Viewer
      |
Profile + trace query + validation APIs
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
- load project profiles that describe engine, project, important entities, and
  semantic event vocabulary
- build current context from the latest trace
- validate scenario expectations against trace evidence
- export static HTML trace reports for human review
- keep engine-specific code outside the core

## Project Profiles

Profiles keep the harness generic while letting each game define its own context
vocabulary.

A profile can describe:

- project identity
- engine identity
- trace directory
- important entities and how to recognize them
- semantic event types
- validation scenario files
- safety defaults

See `examples/test-field.profile.json` and `examples/catsweeper.profile.json`.

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

## Current Context

`harness context current` reads a trace and profile to answer what the agent
needs before editing code:

- current scene
- runtime started/stopped state
- selected entity
- latest state snapshot
- important project entities observed in the trace
- recent semantic events
- errors
- validation pass/fail state
- recent timeline

## Validation Scenarios

Validation scenarios are trace-based assertions. They do not require direct
engine control, so they are useful for agents even when a game editor is not
running.

The first check types are:

- `event`
- `latestSnapshot`
- `validation`
- `entitySeen`
- `timelineOrder`
- `noErrors`

See `examples/test-field.validation.json`.

## Viewer Export

`harness viewer export` writes a static HTML report from an existing trace. It
uses the same context builder and trace reader as the CLI, so it is a human
review surface over agent-readable artifacts rather than a separate product.

## Safety Model

Default behavior is read-only observation plus local artifact writing. Riskier
features should remain explicit and approval-bound:

- saving game scenes
- changing project settings
- executing arbitrary engine scripts
- deleting traces
- triggering editor actions that mutate assets

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

- `core`: schemas, profile, trace model, context builder, validation runner
- `host`: engine connections and artifact store
- `cli`: local commands
- `mcp`: MCP server adapter
- `adapters/godot`: Godot plugin
- `adapters/unity`: Unity plugin
- `viewer`: trace viewer UI
