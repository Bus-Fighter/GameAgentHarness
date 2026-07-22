# MCP Tool Layer Contract (Wave 1 -> Wave 2)

This document is the exact contract Wave 2 agents (MCP stdio server, bridge)
must follow when integrating with `Tools/GameAgentHarness/src/mcp/`.

## Operations module shape

Each file in `src/mcp/operations/*.js` is auto-discovered by `registry.js`
(synchronous readdir at import time, modules loaded via top-level await before
any `listTools()`/`dispatch()` call returns).

```js
export const tools = [
  {
    name: "tool_name",            // snake_case, unique across all modules
    description: "...",           // English, single-paragraph
    inputSchema: {                // JSON Schema, type "object"
      type: "object",
      properties: { ... },
      required: [ ... ],
    },
  },
];

export async function handle(toolName, args, ctx) {
  // Return MCP result or throw. registry.dispatch wraps throws into isError results.
  return { content: [{ type: "text", text: "..." }], isError?: true };
}
```

- A module may register multiple tools; `handle` switches on `toolName`.
- `inputSchema.type` MUST be `"object"` (validated at registration).
- Duplicate tool names throw at registration time.

## Result shape

MCP result format (same as `@modelcontextprotocol/sdk` CallToolResult):

```js
{ content: [{ type: "text", text: string }, ...], isError?: boolean }
```

Errors MAY be returned as `{ content, isError: true }` or thrown; the registry
converts thrown errors into `isError` results. Use helpers from
`src/mcp/util.js`: `textResult(text)`, `errorResult(text)`,
`opsErrorResult(code, message, extra?)`.

## ctx object

`dispatch(toolName, args, ctx)` receives a ctx with:

| field            | type              | notes |
|------------------|-------------------|-------|
| `godotPath`      | `string \| null`  | explicit Godot binary override; may be null (resolution order: tool arg `godot_path` > ctx.godotPath > `GODOT_PATH` env > `findGodotBin()`) |
| `projectRoot`    | `string`          | fallback project root (tools usually require explicit `project_path` arg) |
| `traceDir`       | `string`          | harness trace directory |
| `profile`        | `object \| null`  | loaded harness profile (see src/core/profile.js) |
| `bridge`         | `object \| null`  | reserved for Wave 2 in-editor bridge; pass through, may be null |
| `processManager` | `GodotProcessManager` | shared run/stop/output state for execution tools (from `operations/execution.js`); handlers fall back to a module-level singleton if absent |

## Registry API

```js
import { listTools, dispatch } from "./mcp/registry.js";

listTools();                       // -> Tool[] (name/description/inputSchema)
await dispatch(name, args, ctx);   // -> { content, isError? }
```

Importing `registry.js` uses top-level await; importers get a fully loaded
registry.

## Safety rules (enforced everywhere)

- Project paths: `requireProjectPath()` requires an existing dir with
  `project.godot`.
- Project-relative params: `resolveWithinRoot()` rejects `..`, UNC paths,
  Windows device names, URL-encoded traversal, and symlink escapes.
- Class names: must match `/^[A-Za-z_][A-Za-z0-9_]*$/` (`CLASS_NAME_RE`).
- Blocked node properties: `script`, `owner`, `name`, `meta`, process hooks,
  etc. (`BLOCKED_PROPS` in `util.js`) are silently skipped with a warning.
- `execute_gdscript` is sandbox-scanned (`scanGdscriptSandbox` in `guard.js`);
  internal trusted wrappers pass `trusted: true` to `executeGdscript`.
- Destructive tools (`remove_node`, `merge_scene`, `project_replace`) are
  confirm-token gated via `gateDestructive()` in `guard.js`.

## Godot invocation helpers (`src/mcp/godot-process.js`)

- `resolveGodotPath(explicit?)` — binary resolution.
- `spawnGodot(godot, args, { timeoutMs })` — buffered spawn, never shell.
- `execGodot(args, godot, { timeout })` — execFile variant.
- `runGodotScript(scriptName, operation, params, projectPath, { timeout, godotPath })`
  — `--headless --path <p> --script <scripts/<scriptName>> [operation] <json>`.
- `GodotProcessManager` — `runProject`, `stopProject`, `getDebugOutput`.

## GDScript scripts (`src/mcp/scripts/`)

Verbatim copies from upstream; do not edit in place — changes must stay in
sync with the port lineage. Structured output markers:
`___MCP_RESULT___<json>` / `___MCP_ERROR___<json>` (parsed by
`parseMcpScriptOutput` in `util.js`).

## Wave 2 reserved

- `harness mcp serve` — stdio MCP server (SDK dep already in package.json).
- `ctx.bridge` — in-editor bridge client.

## Declarative custom tools

`operations/custom-declared.js` loads extra MCP tools from
`<projectRoot>/.harness/custom-tools.json`. Missing file → the module registers
zero tools (no error). Schema:

```json
{
  "tools": [
    {
      "name": "my_tool",
      "description": "...",
      "inputSchema": { "type": "object", "properties": { } },
      "target": {
        "domain": "game",
        "command": "some_command",
        "paramMap": { "toolArg": "engineParam" }
      }
    }
  ]
}
```

- `name` must be unique snake_case (`/^[a-z][a-z0-9_]*$/`) and must not collide
  with a built-in tool name; invalid/duplicate/colliding entries are skipped
  with a warning to stderr.
- `paramMap` renames tool args into engine params; unmapped args pass through
  under the same name.
- Dispatch calls `ctx.bridge.cmd(target.domain, target.command, mappedParams)`.
- The exported `tools` array is resolved at module load using `process.cwd()`
  as the default projectRoot; `handle(toolName, args, ctx)` re-resolves the
  declarations against `ctx.projectRoot` so per-project dispatch works even
  when the server was started elsewhere.

## Resources

`src/mcp/resources.js` exposes read-only MCP resources over the harness trace
system and the Godot project at `ctx.projectRoot`.

API:

```js
import { listResources, readResource, attachResourceHandlers } from "./mcp/resources.js";

listResources(ctx);              // -> Resource[] ({ uri, name, description, mimeType })
readResource(uri, ctx);          // -> { contents: [{ uri, text, mimeType }] }; throws on unknown/invalid URIs
attachResourceHandlers(server, ctx);
// server: an SDK `Server` instance (from "@modelcontextprotocol/sdk/server/index.js").
// Registers ListResourcesRequestSchema and ReadResourceRequestSchema handlers via
// server.setRequestHandler(...). Call once after constructing the Server; safe to
// call conditionally (`if (typeof attachResourceHandlers === "function")`).
```

Resource URIs:

| URI | Content |
|-----|---------|
| `harness://traces` | JSON list of traces (id, startedAt, endedAt, counts) |
| `harness://trace/{id}/summary` | Markdown trace summary (`latest` allowed as id) |
| `harness://trace/{id}/context` | Agent-facing context JSON (`latest` allowed) |
| `godot://project/info` | JSON project metadata (only when ctx.projectRoot has project.godot) |
| `godot://project/config` | Raw project.godot text |
| `godot://file/{path}` | UTF-8 text file under ctx.projectRoot; rejects `..`, absolute paths, escapes outside the root, binary extensions (.png/.jpg/.import/.uid/.res/.tres/.scn/...), and files over 256KB |
