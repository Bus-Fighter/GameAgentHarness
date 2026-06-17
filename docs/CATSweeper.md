# CatSweeper Test Notes

CatSweeper is a target project for testing the harness. The harness remains a
separate project.

## Manual Test

From the harness project:

```bash
npm start
```

Install the Godot adapter into CatSweeper:

```bash
node ./src/cli.js godot install-adapter --project /Users/yuenlamfelix/Documents/CS/Godot/CatSweeper
```

Then in Godot:

1. Open CatSweeper.
2. Enable **Game Agent Harness** in Project Settings > Plugins.
3. Select a node such as `StageController`.
4. Run the stage scene.
5. Click or tap in the running game.

Expected trace evidence:

- `engine.connected`
- `project.opened`
- `selection.changed`
- `runtime.started`
- `scene.changed`
- `input.pointer.pressed`
- `state.sampled`

Summarize the latest trace:

```bash
node ./src/cli.js trace summarize latest
```

## Current Scope

This first adapter records generic Godot editor/runtime context. It does not
instrument CatSweeper gameplay classes directly.

The next useful CatSweeper-specific layer is semantic events around:

- `StageController` input-to-grid conversion
- `StageSession.RevealGrid`
- `GridSession` reveal result
- player HP/EXP/level changes
- HUD state updates
