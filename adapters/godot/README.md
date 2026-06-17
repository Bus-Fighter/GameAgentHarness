# Godot Adapter

This adapter is a Godot 4 plugin that sends editor and runtime evidence to the
local Game Agent Harness host.

## Install Into A Godot Project

Copy this folder:

```text
addons/game_agent_harness
```

into the target Godot project under:

```text
<project>/addons/game_agent_harness
```

Then enable **Game Agent Harness** in:

```text
Project > Project Settings > Plugins
```

Start the host before opening/running the project:

```bash
npm start
```

## What It Emits

- `engine.connected`
- `project.opened`
- `selection.changed`
- `runtime.started`
- `runtime.stopped`
- `scene.changed`
- `input.pointer.pressed`
- `input.action.pressed`
- `state.sampled`

The adapter is intentionally read-only. It does not modify gameplay code.
