# CatSweeper Test Notes

CatSweeper is a target project for testing the harness. The harness remains a
separate project, but it is usually checked out inside CatSweeper as the
`Tools/GameAgentHarness` submodule.

## Manual Test From CatSweeper

From the CatSweeper repo root:

```bash
cd Tools/GameAgentHarness
npm start
```

CatSweeper already contains the Godot adapter under `addons/game_agent_harness`.
If a fresh project needs the adapter installed, run this from the harness root:

```bash
node ./src/cli.js godot install-adapter --project ../..
```

Then in Godot:

1. Open CatSweeper.
2. Enable **Game Agent Harness** in Project Settings > Plugins.
3. Open the **Game Agent Harness** dock panel (left dock by default) and click
   **Start Dashboard**.
4. Open the dashboard URL in your browser.
5. Select a node such as `StageController`.
6. Run the stage scene.
7. Click or tap in the running game.

Expected trace evidence:

- `engine.connected`
- `project.opened`
- `selection.changed`
- `editor.context`
- `runtime.started`
- `scene.changed`
- `input.pointer.pressed`
- `state.sampled`
- `evidence.frame` (editor and runtime screenshots)

Useful agent commands from the harness root:

```bash
node ./src/cli.js dashboard start --profile examples/catsweeper.profile.json
node ./src/cli.js trace list --profile examples/catsweeper.profile.json
node ./src/cli.js trace summarize latest --profile examples/catsweeper.profile.json
node ./src/cli.js context current latest --profile examples/catsweeper.profile.json
node ./src/cli.js trace inspect latest --profile examples/catsweeper.profile.json --stream all --limit 30
```

## Generic Harness Test Field

The generic test field does not require Godot. It demonstrates profile loading,
semantic events, snapshots, validation, evidence artifacts, and viewer export:

```bash
npm run test-field
npm run context
npm run validate:test-field
node ./src/cli.js viewer export latest --profile examples/test-field.profile.json --output /tmp/game-agent-harness-test-field.html
```

## Current CatSweeper Scope

The first adapter records generic Godot editor/runtime context. It does not yet
instrument CatSweeper gameplay classes directly.

The next useful CatSweeper-specific layer is semantic events around:

- `StageController` input-to-grid conversion
- `StageSession.RevealGrid`
- `GridSession` reveal result
- player HP/EXP/level changes
- HUD state updates
