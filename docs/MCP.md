# MCP Server

The Game Agent Harness ships a full [Model Context Protocol](https://modelcontextprotocol.io) server that exposes **132 built-in tools** (plus declarative per-project custom tools) for driving the Godot editor/runtime, editing scenes and scripts, validating projects, and reading harness trace evidence.

Source of truth for the tool layer internals: [`src/mcp/CONTRACT.md`](../src/mcp/CONTRACT.md). Engine command channel: [`adapters/godot/COMMANDS.md`](../adapters/godot/COMMANDS.md).

## Quick start

Two transports serve the same tool registry:

### HTTP (via the dashboard)

```bash
node ./src/cli.js dashboard start
```

Then open the dashboard (`http://127.0.0.1:8766`) and press the MCP **Start** button. The MCP endpoint is served at `http://127.0.0.1:8766/mcp` (Streamable HTTP). The dashboard panel also shows per-IDE config snippets and one-click config install.

### stdio (standalone)

```bash
harness mcp serve [--project-root <path>] [--trace-dir traces] [--profile file]
```

## IDE setup

These snippets match what `src/mcp/ide-configs.js` generates (`listIdeConfigs` / `installIdeConfig`). Server key: `game-agent-harness`.

### Claude Code — `<project>/.mcp.json`

HTTP variant (dashboard must be running):

```json
{
  "mcpServers": {
    "game-agent-harness": { "type": "http", "url": "http://127.0.0.1:8766/mcp" }
  }
}
```

stdio variant:

```json
{
  "mcpServers": {
    "game-agent-harness": { "command": "node", "args": ["<abs path>/Tools/GameAgentHarness/src/cli.js", "mcp", "serve"] }
  }
}
```

### Codex — `~/.codex/config.toml`

```toml
[mcp_servers.game-agent-harness]
command = "node"
args = ["<abs path>/Tools/GameAgentHarness/src/cli.js", "mcp", "serve"]
```

### OpenCode — `<project>/opencode.json`

```json
{
  "mcp": {
    "game-agent-harness": {
      "type": "local",
      "command": ["node", "<abs path>/Tools/GameAgentHarness/src/cli.js", "mcp", "serve"],
      "enabled": true
    }
  }
}
```

### Cursor — `<project>/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "game-agent-harness": { "command": "node", "args": ["<abs path>/Tools/GameAgentHarness/src/cli.js", "mcp", "serve"] }
  }
}
```

### Generic client

- HTTP: `{ "type": "http", "url": "http://127.0.0.1:8766/mcp" }`
- stdio: `{ "command": "node", "args": ["<abs path>/Tools/GameAgentHarness/src/cli.js", "mcp", "serve"] }`

## Tool inventory

Built-in tools are auto-discovered from `src/mcp/operations/*.js` by `registry.js`. Most tools take `project_path`; the Godot binary resolves as: tool arg `godot_path` > ctx `godotPath` > `GODOT_PATH` env > auto-detect.

**"Runtime only"** means the change affects the headless/live execution context and is *not* persisted to `.tscn` — edit the scene file to persist.

### Scene (`scene.js`) — file-level `.tscn` editing

| Tool | Description |
|---|---|
| `read_scene` | Parse a .tscn scene: full structure (header, resources, nodes, connections) or a text summary |
| `create_scene` | Create a new scene with a root node of the given type (headless Godot) |
| `quick_scene` | Create a minimal .tscn directly on disk (no Godot process), optional attached script |
| `add_node` | Add a node to an existing scene (pure text edit, headless fallback for complex values) |
| `batch_add_nodes` | Add multiple nodes in one operation (max 100) |
| `edit_node` | Edit properties of an existing node in a .tscn file |
| `remove_node` | Remove a node + descendants from a .tscn. **Confirm-token gated** |
| `save_scene` | Re-save a scene via headless Godot, optionally to a new path |
| `load_sprite` | Load a texture into a Sprite2D/Sprite3D/TextureRect node |
| `instance_scene` | Instance another PackedScene as a child node |
| `detach_instance` | Inline an instanced scene's nodes (property overrides preserved) |
| `diff_scenes` | Diff two .tscn files: nodes added/removed/changed (property-level) |
| `merge_scene` | Merge two .tscn files (theirs into ours), deduping resources. **Confirm-token gated** |

### Script (`script.js`)

| Tool | Description |
|---|---|
| `read_script` | Read a GDScript (or any text) file from the project |
| `write_script` | Write a GDScript file (creates parents; refuses overwrite unless `overwrite=true`) |
| `edit_script` | Literal search-and-replace in an existing script (must match exactly once unless `allow_multiple`) |
| `project_replace` | Project-wide literal search-and-replace across text files. **Confirm-token gated** |

### Dynamic / introspection (`dynamic.js`)

| Tool | Description |
|---|---|
| `execute_gdscript` | Execute arbitrary GDScript headlessly (auto-wrapped in a SceneTree script; `_mcp_output(key, value)` for structured output). **Sandbox-scanned** |
| `query_scene_tree` | Query a scene's node tree with resolved runtime property values (loads headlessly, up to `max_depth`) |
| `inspect_node` | Deep-inspect a node: properties, signal connections, available signals, children |

### Execution (`execution.js`)

| Tool | Description |
|---|---|
| `launch_editor` | Launch the Godot editor for a project |
| `run_project` | Run a project (windowed) and capture stdout/stderr |
| `stop_project` | Stop the running project process |
| `get_debug_output` | Get the captured stdout/stderr line buffer |
| `capture_screenshot` | Screenshot a scene via the screenshot_capture.gd script. Experimental — headless rendering may be unavailable on some platforms |
| `get_godot_version` | Installed Godot version string |

### Project (`project.js`)

| Tool | Description |
|---|---|
| `list_projects` | Scan a directory for Godot projects |
| `get_project_info` | Project metadata: name, features, main scene, autoloads, file counts |
| `list_files` | List project files, filterable by extension/directory |
| `read_project_config` | Parse project.godot |
| `create_project` | Create a new minimal Godot project |
| `import_resources` | Headless `--import` pass to refresh `.godot/imported` |

### Harness / engine bridge (`harness.js`)

| Tool | Description |
|---|---|
| `harness_list_traces` | List all traces with per-stream event counts |
| `harness_trace_summarize` | Markdown summary of a trace (default latest) |
| `harness_trace_inspect` | Inspect trace timeline items (stream/type/limit filters) |
| `harness_get_context` | Agent-facing context JSON for a trace |
| `harness_validate_scenario` | Run a validation scenario JSON against a trace |
| `harness_capture_frame` | Capture the latest live frame via the engine bridge (`game.screenshot`) |
| `harness_editor_logs` | Recent log-stream events from a trace |
| `engine_command` | Generic passthrough to the live engine bridge (`editor.*`/`game.*`; see `adapters/godot/COMMANDS.md`) |

### Validation (`validation.js`)

| Tool | Description |
|---|---|
| `run_and_verify` | Run the project headlessly for a fixed duration; structured errors/warnings + fix suggestions |
| `analyze_error` | Analyze raw Godot output text into structured errors/warnings/suggestions |
| `validate_scripts` | Batch-validate GDScript files via a headless parse pass |
| `validate_project` | Static project validation: config, missing resource refs, scene structure, script pitfalls, shader syntax |

### Workflow (`workflow.js`)

| Tool | Description |
|---|---|
| `dev_loop` | Execute GDScript headlessly, optionally verify clean project load, capture outputs; `save_state` writes a session-state markdown under traceDir |
| `scene_snapshot` | Structured scene-tree snapshot; pass a previous snapshot in `before` for a diff |
| `batch_validate` | Validate multiple GDScript files in one call (`--check-only` parse) |
| `validate_gdd` | Validate a GDD markdown against the 8-section standard. Pure file parsing |
| `chain_verify` | Chain-of-Verification self-challenge on a review conclusion. Pure logic |
| `list_templates` | List built-in GDScript templates (core 4: T001, T002, T008, T010). Pure JS |
| `apply_template` | Apply a built-in code template to a script path |

### Animation (`animation.js`) & AnimationTree (`animtree.js`)

| Tool | Description |
|---|---|
| `animation` | Query/control/edit animations on AnimationPlayer: `list_players`, `get_info`, `get_details`, `get_keyframes`, `play`, `stop`, `seek`, `create`, `delete`, `update_props`, `add_track`, `remove_track`, ... |
| `animtree_create` | Create an AnimationTree (chosen root type) wired to an AnimationPlayer. Runtime only |
| `animtree_add_state` | Add a state to an AnimationTree state machine. Runtime only |
| `animtree_add_transition` | Add a transition (xfade, conditions). Runtime only |
| `animtree_set_blend` | Set a blend parameter (float or `{x,y}`). Runtime only |
| `animtree_play` | Travel to a state in state-machine playback. Runtime only |

### Physics & spatial (`physics.js`, `spatial.js`)

| Tool | Description |
|---|---|
| `physics_raycast` | Cast a 3D ray; hit position/normal/collider; mask + exclusion support. Runtime only |
| `physics_body_info` | Collision layer/mask and CollisionShape3D details for a body. Runtime only |
| `diagnose_physics` | Body diagnostics: velocity, contact probe, shapes, concave-shape warnings. Runtime only |
| `query_spatial` | Physics bodies within a sphere, sorted by distance, with shape details. Runtime only |
| `collision_overlay` | Temporary debug overlay of all CollisionShape3D under a node, color-coded by body type |
| `spatial_info` | Node transform, global origin, merged world-space AABB. Runtime only |
| `node_create_3d` | Create a whitelisted 3D node (Node3D, MeshInstance3D, bodies, cameras, lights, CollisionShape3D, RayCast3D, ...) |

### UI & themes (`ui.js`)

| Tool | Description |
|---|---|
| `ui_create_control` | Create a Control-derived node (whitelisted types). Runtime only |
| `ui_build_layout` | Build a declarative UI tree; simplified flexbox (row/column/grid → HBox/VBox/GridContainer + alignment + gap). **Full flexbox (wrap/reverse/justify/align-self/grow) deferred** |
| `ui_set_layout` | Set anchors/offsets/min-size/grow-direction. Runtime only |
| `ui_get_layout` | Read anchor/offset/position/size info |
| `ui_anchor_preset` | Apply one of the 16 anchor presets. Runtime only |
| `ui_set_theme` | Manage a Control's Theme: `set_params` / `create` / `save` / `load`. Runtime only |
| `ui_container_add` | Add a Control child to a container. Runtime only |
| `theme_create` | Create a Theme (empty or extracted from a Control), optional save to .tres. Runtime only |
| `theme_set_property` | Set a theme item (font/color/constant/stylebox). Runtime only |

### Tilemap (`tilemap.js`) — all runtime only

| Tool | Description |
|---|---|
| `tilemap_read` | Read cells (region or all used) from a TileMap/TileMapLayer |
| `tilemap_set_cell` / `tilemap_erase_cell` | Set/erase a single cell |
| `tilemap_fill_rect` / `tilemap_clear` | Fill a rect / clear one or all layers |
| `tilemap_copy` / `tilemap_paste` | Copy a region to a portable pattern / paste it elsewhere |
| `tilemap_set_transform` | Set flip_h/flip_v/transpose bits on a cell's alternative tile |

### Navigation (`navigation.js`)

| Tool | Description |
|---|---|
| `nav_create_region` | Create a NavigationRegion3D (optional immediate bake). Runtime only |
| `nav_bake_mesh` | Bake a region's nav mesh (slow for large geometry). Runtime only |
| `nav_create_agent` | Create a NavigationAgent3D with target/distance settings. Runtime only |
| `nav_set_params` | Set parameters on an existing agent. Runtime only |
| `nav_create_link` | Create a NavigationLink3D (one-way or bidirectional). Runtime only |
| `nav_query_path` | Query a 3D path via NavigationServer3D |

### Particles (`particles.js`) — all runtime only

| Tool | Description |
|---|---|
| `particles_create` | Create GPUParticles2D/3D, optionally with a preset in the same pass |
| `particles_set_emission` | Emission params: amount, shape, direction, spread |
| `particles_set_process` | Process params: gravity, speed, explosiveness, randomness, lifetime, damping |
| `particles_load_preset` | Apply a preset: fire/smoke/rain/snow/sparkle/explosion |
| `particles_set_material` | Assign a fresh ParticleProcessMaterial |

### Material & shaders (`material.js`)

| Tool | Description |
|---|---|
| `material_read` | Read material type, resource path, shader uniforms / stored properties |
| `material_write` | `set_params` / `create` / `save` material data. Runtime only (in-memory) |
| `shader_edit` | Shader code `read` / `write` (with compile diagnostics) / `apply_template` / `list_templates` |

### Audio (`audio.js`) — runtime only

| Tool | Description |
|---|---|
| `audio_play` | Play on an AudioStreamPlayer/2D/3D node or a standalone stream via a temp player |
| `audio_stop` | Stop playback on a player node |
| `audio_set_param` | Set volume_db / pitch_scale / bus |
| `audio_query` | Query playback state, position, stream length |

### Signals (`signals.js`) — runtime only, headless

| Tool | Description |
|---|---|
| `signal_connect` / `signal_disconnect` | Connect/disconnect signal → method (main scene or `scene_path`) |
| `signal_emit` | Emit a signal (basic-typed args only) |
| `signal_list` | List signals available on a node |

### IK (`ik.js`)

| Tool | Description |
|---|---|
| `ik_modifier_create` | Create TwoBoneIK3D/FABRIK3D/CCDIK3D/SplineIK3D/JacobianIK3D under a parent. Runtime only |
| `ik_modifier_get` / `ik_modifier_set` | Read/set IK modifier properties (active, influence, bone, target, magnet) |
| `ik_list_bones` | List Skeleton3D bones (index, name, rest position) |

### Profiler (`profiler.js`)

| Tool | Description |
|---|---|
| `profiler` | Actions: `snapshot` (FPS/memory/draw calls/physics), `sample` (frame-time percentiles over `duration_ms`), signal-based sampling |

### Recording (`recording.js`)

| Tool | Description |
|---|---|
| `recording_start` / `recording_stop` | Input recording session markers under traceDir/recordings. **Live in-game capture deferred** (needs the in-editor bridge) |
| `recording_save` / `recording_load` | Save/load event JSON under `res://recordings/` |
| `recording_play` | Headless replay via `Input.parse_input_event` with timing + speed multiplier. **Bridge-based playback deferred** |

### API docs (`apidocs.js`)

| Tool | Description |
|---|---|
| `get_class_info` | Class methods/properties/signals/constants/enums via headless ClassDB. **No doc database; reflects the installed binary** |
| `search_classes` | Substring search over class names |
| `find_method` | Find a method up the inheritance chain |
| `get_inheritance` | Inheritance chain of a class |

### UID (`uid.js`)

| Tool | Description |
|---|---|
| `get_uid` | UID for a file (Godot 4.4+ .uid files) |
| `update_project_uids` | Resave all resources to update/generate UID references (4.4+) |

### Test & export (`testexport.js`)

| Tool | Description |
|---|---|
| `run_tests` | Run a GUT suite headlessly (requires `addons/gut`) |
| `test_assert` | Assert on the main scene tree: node_exists, property_equals, signal_connected, node_count |
| `test_stress` | Node create/destroy stress cycles for leak detection |
| `export_list_presets` / `export_get_preset` | Parse export_presets.cfg (no Godot process) |
| `export_build` | Headless `--export-release` build (requires export templates) |

### Game-specific custom tools (`custom.js`)

These require the game running with the adapter installed and the game-side C# `HarnessBridge` (`Scripts/Core/Harness/HarnessBridge.cs` in CatSweeper; lazily instantiated under `/root` by the adapter's `bridge_commands.gd`). They route over the live `game.*` command channel.

| Tool | Description |
|---|---|
| `console_list_commands` | List all commands registered in the game's CommandService |
| `console_execute` | Execute a CommandService command (`-param value` syntax); generic get/call access |
| `actor_list` / `actor_get` | List Actor nodes in the live scene tree / details for one by path |
| `binding_list_sources` | List live nodes implementing IBindingSource |
| `binding_list_types` | Registered binding source type names (BindingSourceRegistryHost) |
| `binding_get_keys` | Binding keys registered for a source type |

### Declarative custom tools (`custom-declared.js`)

Registers zero built-in tools; loads extra tools per project from `.harness/custom-tools.json` (see below).

## Custom tools (declarative)

Projects can declare their own MCP tools in `<projectRoot>/.harness/custom-tools.json`. Missing file → no tools, no error. Dispatch routes to `ctx.bridge.cmd(domain, command, mappedParams)`, so these require the game running with the adapter + `HarnessBridge`.

```json
{
  "tools": [
    {
      "name": "set_player_hp",
      "description": "Set the player HP via the game's console service.",
      "inputSchema": {
        "type": "object",
        "properties": { "hp": { "type": "number" } },
        "required": ["hp"]
      },
      "target": {
        "domain": "game",
        "command": "console_exec",
        "paramMap": { "hp": "value" }
      }
    }
  ]
}
```

- `name` must be unique snake_case (`/^[a-z][a-z0-9_]*$/`) and must not collide with a built-in tool; invalid/colliding entries are skipped with a stderr warning.
- `paramMap` renames tool args into engine params; unmapped args pass through unchanged.
- Tools are resolved at module load using `process.cwd()` as the project root and re-resolved per-dispatch against `ctx.projectRoot`.

## MCP resources

Read-only resources from `src/mcp/resources.js`:

| URI | Content |
|---|---|
| `harness://traces` | JSON list of traces (id, startedAt, endedAt, counts) |
| `harness://trace/{id}/summary` | Markdown trace summary (`latest` allowed) |
| `harness://trace/{id}/context` | Agent-facing context JSON (`latest` allowed) |
| `godot://project/info` | JSON project metadata (only when ctx.projectRoot has project.godot) |
| `godot://project/config` | Raw project.godot text |
| `godot://file/{path}` | UTF-8 text file under ctx.projectRoot; rejects `..`, absolute paths, escapes, binary extensions (.png/.import/.res/.tres/...), and files > 256KB |

## CLI equivalents

Every MCP tool can also be invoked directly from the CLI — same registry, same dispatch:

```bash
harness godot tools                      # list all tools (--json for schemas)
harness godot <tool-name> [--key value ...] [--params-json '<json>'] [--json]
```

Examples:

```bash
harness godot get_project_info --project-path . --json
harness godot read_scene --project-path . --scene-path Scenes/Main.tscn
```

Engine command channel (what `engine_command` and custom tools use under the hood):

```bash
harness engine cmd <domain> <command> [--params '<json>'] [--host 127.0.0.1] [--port 8765]
harness engine cmd game get_tree --params '{"depth": 4}'
```

## Safety model

- **Project paths**: `requireProjectPath()` requires an existing directory containing `project.godot`.
- **Path traversal**: project-relative params go through `resolveWithinRoot()` — rejects `..`, UNC paths, Windows device names, URL-encoded traversal, and symlink escapes.
- **Class names**: must match `/^[A-Za-z_][A-Za-z0-9_]*$/`.
- **Blocked node properties**: `script`, `owner`, `name`, `meta`, process hooks, etc. are silently skipped with a warning (`BLOCKED_PROPS` in `util.js`).
- **GDScript sandbox**: `execute_gdscript` code is scanned by `scanGdscriptSandbox` (`guard.js`); internal trusted wrappers pass `trusted: true` to `executeGdscript` to bypass the scan.
- **Confirm-token gating**: destructive tools `remove_node`, `merge_scene`, `project_replace` refuse to run on first call and return a `confirm_token`; re-call with the token to execute (`gateDestructive()` in `guard.js`).

## Known limitations

- `capture_screenshot` is experimental; headless rendering is unavailable on some platforms (Windows headless returns null).
- `recording_start`/`recording_play`: live in-game capture and upstream bridge-based playback are deferred (no in-editor bridge yet).
- `ui_build_layout` ports only simplified flexbox (row/column/grid + alignment + separation); full flexbox (wrap/reverse/justify/align-self/flex grow) is deferred.
- `apidocs` tools use headless ClassDB introspection only — no doc database; descriptions reflect the installed Godot binary.
- Most runtime tools do **not** persist changes to `.tscn` files (edit scene files via the `scene.js` tools to persist).

## Attribution

The MCP tool layer under `src/mcp/` is ported from MIT-licensed `godot-mcp-enhanced` and `godot-mcp`; the GDScript files in `src/mcp/scripts/` are verbatim upstream copies. See [`NOTICE.md`](../NOTICE.md).
