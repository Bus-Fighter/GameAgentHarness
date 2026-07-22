# Godot Adapter Command Channel

Request/response commands sent from the harness host to the live Godot editor or running game.

## Protocol

Host → engine (WebSocket):

```json
{ "kind": "control", "action": "cmd", "id": "<uuid>", "domain": "<editor|game>", "command": "<name>", "params": { } }
```

Engine → host:

```json
{ "kind": "event", "type": "cmd.result", "id": "<same id>", "ok": true, "data": { }, "error": null }
```

`cmd.result` events are intercepted by the host and never appended to the trace.

- Host API: `HarnessHost.sendEngineCommand(domain, command, params, { timeoutMs = 15000 })` → Promise resolving with `data`, rejecting on error/timeout.
- Standalone/CLI: `harness engine cmd <domain> <command> [--params '<json>'] [--host 127.0.0.1] [--port 8765]`.
- MCP glue: `src/mcp/bridge.js` → `new EngineBridge({ harnessHost })` or `new EngineBridge({ host, port })`, `.cmd(domain, command, params)`, `.isAvailable()`.
- Unknown domain/command → `{ ok: false, error: "unknown domain|command: ..." }`.
- Tree queries clamp `depth` (default 8, max 32) and `maxNodes` (default 2000, max 10000); results include `truncated: true` when capped.
- Composite values (Vector2/3, Color, etc.) are passed as `{ "x": 1, "y": 2 }` / `{ "r": 1, "g": 0, "b": 0, "a": 1 }` in params and results.

## `editor` domain

Only functional when `Engine.is_editor_hint()` (editor plugin context). Mutations go through the editor `UndoRedo`.

| Command | Params | Result `data` |
|---|---|---|
| `editor.ping` | — | `{ version, scenePath, playing }` |
| `editor.get_scene_tree` | `{ depth?, maxNodes? }` | `{ root, nodeCount, truncated }` — recursive node tree of the edited scene root (name, type, path, childCount, children) |
| `editor.open_scene` | `{ path }` (res:// or relative) | `{ path }` |
| `editor.save_scene` | — | `{ path }` |
| `editor.play_scene` | — | `{ playing: true, scenePath }` |
| `editor.stop_play` | — | `{ playing: false }` |
| `editor.add_node` | `{ parent_path, node_type, node_name, properties? }` | `{ node }` (node summary). Parent path relative to edited scene root (empty = root). Undoable. |
| `editor.remove_node` | `{ path, confirm: true }` | `{ removed }`. Requires `confirm=true`. Undoable. |
| `editor.set_property` | `{ node_path, property, value }` | `{ node, property, value }`. Undoable. |
| `editor.undo` | — | `{ action }` |
| `editor.redo` | — | `{ action }` |
| `editor.select` | `{ node_path }` | `{ selected }` — syncs editor selection |

## `game` domain

Functional wherever the adapter client runs inside a scene tree (runtime recorder / in-game context). Paths accept `/root/...` absolute or root-relative.

| Command | Params | Result `data` |
|---|---|---|
| `game.get_tree` | `{ depth?, maxNodes?, includeInternal? }` | `{ root, nodeCount, truncated }` — live scene tree from `/root` |
| `game.get_node` | `{ path }` | Node summary: `name, type, path, childCount`, plus `position/rotation/scale` (Node2D/Node3D), `size` (Control), `visible` (CanvasItem), `text` (Label/Button/LineEdit), `value/minValue/maxValue` (Range) |
| `game.set_property` | `{ path, property, value }` | `{ node, property, value }` |
| `game.call_method` | `{ path, method, args? }` | `{ node, method, result }`. Methods starting with `_` rejected; max 4 args. |
| `game.input_key` | `{ keycode, pressed? }` (e.g. `"Space"`, `"A"`) | `{ keycode, pressed }` via `Input.parse_input_event` |
| `game.input_action` | `{ action, pressed? }` | `{ action, pressed }` via `Input.action_press/release` |
| `game.input_text` | `{ text }` | `{ length }` — press/release key events per character |
| `game.get_performance` | — | `{ fps, frameTimeMs, physicsFrameTimeMs, memoryStaticBytes, memoryStaticMaxBytes, objectCount, nodeCount }` |
| `game.screenshot` | `{ persist? }` | `{ width, height, format: "jpeg", persist }` — also sends a `{ kind: "frame", format: "jpeg", source: "bridge", persist }` frame message over the socket |
| `game.console_list` | — | `{ commands: [string] }` — all registered CommandService commands (scopes flattened with space separators) |
| `game.console_exec` | `{ input }` | `{ success, logs: [{ message, level }], events: [{ command, success, error }] }` — executes via the game's `CommandService`; bridge exceptions surface as `{ success: false, error }` |
| `game.actor_list` | — | `[{ name, type, path, childCount }]` — all `Actor` nodes under `/root` |
| `game.actor_get` | `{ path }` | `{ name, type, path, childCount }` — error if missing or not an `Actor` |
| `game.binding_list_types` | — | `[string]` — registered binding source type names |
| `game.binding_get_keys` | `{ type }` | `[string]` — binding keys for a type name (empty array for unknown types) |
| `game.binding_list_sources` | — | `[{ name, type, path }]` — nodes implementing `IBindingSource` |

The `console_*`, `actor_*`, and `binding_*` commands require the game-side C# bridge node
(`HarnessBridge`, e.g. `res://Scripts/Core/Harness/HarnessBridge.cs`). The adapter lazily
instantiates it under `/root` on first use (located via `ProjectSettings.get_global_class_list()`,
with a constant-path fallback). If the class is missing from the project, these commands return
`{ ok: false, error: "HarnessBridge class not found in project (game-side bridge missing)" }`.

## Files

- `addons/game_agent_harness/command_router.gd` — shared router, instantiated lazily by `harness_client.gd` on first `cmd` control message (works in both editor plugin and runtime recorder contexts).
- `addons/game_agent_harness/editor_commands.gd` — `editor` domain handlers.
- `addons/game_agent_harness/bridge_commands.gd` — `game` domain handlers.
- `addons/game_agent_harness/command_util.gd` — value decode/serialize + node summary helpers.
