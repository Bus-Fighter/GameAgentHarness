import { opsErrorResult, gdEscape, CLASS_NAME_RE } from "../util.js";
import { resolveGodotPath } from "../godot-process.js";
import { requireProjectPath, normalizeUserProjectPath } from "../path-utils.js";
import { executeGdscript, parseGdscriptResult } from "../gdscript.js";

const NON_PERSIST = "Runtime operation: affects only the current headless execution context and is not persisted to .tscn files. To persist changes, edit the scene files instead.";

const HEADER = [
  "extends SceneTree",
  "var _mcp_root: Node = null",
  "var _mcp_scene_instance: Node = null",
  "func _mcp_get_root() -> Node:",
  "\tif _mcp_root != null:",
  "\t\treturn _mcp_root",
  "\tif self.root != null:",
  "\t\t_mcp_root = self.root",
  "\t\treturn _mcp_root",
  "\treturn null",
  "func _mcp_get_node(path) -> Node:",
  "\tvar _p: String = str(path)",
  "\twhile _p.begins_with(\"/\"):",
  "\t\t_p = _p.substr(1)",
  "\tvar _r: Node = _mcp_get_root()",
  "\tif _r == null:",
  "\t\treturn null",
  "\tif _p == \"\" or _p == \"root\":",
  "\t\treturn _r",
  "\tvar _node: Node = _r.get_node_or_null(_p)",
  "\tif _node != null:",
  "\t\treturn _node",
  "\tvar _parts: PackedStringArray = _p.split(\"/\")",
  "\t_node = _r",
  "\tfor _part in _parts:",
  "\t\tif _part == \"\" or (_part == \"root\" and _node == _r):",
  "\t\t\tcontinue",
  "\t\tvar _next: Node = null",
  "\t\tfor _ch in _node.get_children():",
  "\t\t\tif _ch.name == _part:",
  "\t\t\t\t_next = _ch",
  "\t\t\t\tbreak",
  "\t\tif _next == null:",
  "\t\t\treturn null",
  "\t\t_node = _next",
  "\treturn _node",
  "func _mcp_load_main_scene() -> void:",
  "\tvar _r: Node = _mcp_get_root()",
  "\tif _r == null:",
  "\t\treturn",
  "\tvar _sp = ProjectSettings.get_setting(\"application/run/main_scene\")",
  "\tif _sp != null and _sp != \"\":",
  "\t\tvar _sr = load(_sp)",
  "\t\tif _sr:",
  "\t\t\t_r.add_child(_sr.instantiate())",
  "func _mcp_load_scene(sp: String) -> bool:",
  "\tvar _r: Node = _mcp_get_root()",
  "\tif _r == null:",
  "\t\t_mcp_output(\"error\", \"Scene root not available\")",
  "\t\treturn false",
  "\tvar _sr = load(sp)",
  "\tif _sr == null:",
  "\t\t_mcp_output(\"error\", \"Failed to load scene: \" + sp)",
  "\t\treturn false",
  "\tif _mcp_scene_instance != null:",
  "\t\t_mcp_scene_instance.queue_free()",
  "\t_mcp_scene_instance = _sr.instantiate()",
  "\t_r.add_child(_mcp_scene_instance)",
  "\treturn true",
  "func _mcp_get_scene_node(path: String) -> Node:",
  "\tif _mcp_scene_instance != null:",
  "\t\tvar _p: String = path",
  "\t\twhile _p.begins_with(\"/\"):",
  "\t\t\t_p = _p.substr(1)",
  "\t\tif _p.begins_with(\"root/\"):",
  "\t\t\t_p = _p.substr(5)",
  "\t\telif _p == \"root\":",
  "\t\t\t_p = \"\"",
  "\t\tif _p != \"\" and _mcp_scene_instance.name.length() > 0:",
  "\t\t\tvar _sn: String = _mcp_scene_instance.name + \"/\"",
  "\t\t\tif _p.begins_with(_sn):",
  "\t\t\t\t_p = _p.substr(_sn.length())",
  "\t\t\telif _p == _mcp_scene_instance.name:",
  "\t\t\t\t_p = \"\"",
  "\t\tif _p == \"\":",
  "\t\t\treturn _mcp_scene_instance",
  "\t\tvar _n: Node = _mcp_scene_instance.get_node_or_null(_p)",
  "\t\tif _n != null:",
  "\t\t\treturn _n",
  "\treturn _mcp_get_node(path)",
  "",
].join("\n");

function contextOf(scenePath) {
  if (scenePath) {
    return { setup: `\t_mcp_load_scene("${gdEscape(scenePath)}")`, lookup: "_mcp_get_scene_node" };
  }
  return { setup: "\t_mcp_load_main_scene()", lookup: "_mcp_get_node" };
}

export function genSignalConnectScript({ sourcePath, signalName, targetPath, methodName, flags, scenePath }) {
  const { setup, lookup } = contextOf(scenePath);
  const flagsArg = flags !== undefined ? `, ${flags}` : "";
  return `${HEADER}
func _initialize():
${setup}
\tvar source = ${lookup}("${gdEscape(sourcePath)}")
\tvar target = ${lookup}("${gdEscape(targetPath)}")
\tif source == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(sourcePath)}")
\t\t_mcp_done()
\t\treturn
\tif target == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(targetPath)}")
\t\t_mcp_done()
\t\treturn
\tsource.connect("${gdEscape(signalName)}", Callable(target, "${gdEscape(methodName)}")${flagsArg})
\t_mcp_output("connected", {"source": "${gdEscape(sourcePath)}", "signal": "${gdEscape(signalName)}", "target": "${gdEscape(targetPath)}", "method": "${gdEscape(methodName)}"})
\t_mcp_done()
`;
}

export function genSignalDisconnectScript({ sourcePath, signalName, targetPath, methodName, scenePath }) {
  const { setup, lookup } = contextOf(scenePath);
  return `${HEADER}
func _initialize():
${setup}
\tvar source = ${lookup}("${gdEscape(sourcePath)}")
\tvar target = ${lookup}("${gdEscape(targetPath)}")
\tif source == null or target == null:
\t\t_mcp_output("error", "Node not found")
\t\t_mcp_done()
\t\treturn
\tsource.disconnect("${gdEscape(signalName)}", Callable(target, "${gdEscape(methodName)}"))
\t_mcp_output("disconnected", {"source": "${gdEscape(sourcePath)}", "signal": "${gdEscape(signalName)}"})
\t_mcp_done()
`;
}

export function genSignalEmitScript({ sourcePath, signalName, args, scenePath }) {
  const { setup, lookup } = contextOf(scenePath);
  let argsStr = "";
  if (args && args.length > 0) {
    const serialized = [];
    for (const arg of args) {
      if (arg === null || arg === undefined) serialized.push("null");
      else if (typeof arg === "number") serialized.push(String(arg));
      else if (typeof arg === "boolean") serialized.push(String(arg));
      else if (typeof arg === "string") serialized.push(`"${gdEscape(arg)}"`);
      else throw new Error("signal_emit args only support basic types (string/number/bool/null)");
    }
    argsStr = ", " + serialized.join(", ");
  }
  return `${HEADER}
func _initialize():
${setup}
\tvar source = ${lookup}("${gdEscape(sourcePath)}")
\tif source == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(sourcePath)}")
\t\t_mcp_done()
\t\treturn
\tsource.emit_signal("${gdEscape(signalName)}"${argsStr})
\t_mcp_output("emitted", {"source": "${gdEscape(sourcePath)}", "signal": "${gdEscape(signalName)}"})
\t_mcp_done()
`;
}

export function genSignalListScript({ nodePath, scenePath }) {
  const { setup, lookup } = contextOf(scenePath);
  return `${HEADER}
func _initialize():
${setup}
\tvar node = ${lookup}("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar signals = node.get_signal_list()
\t_mcp_output("signals", signals)
\t_mcp_done()
`;
}

function cleanNodePath(value, fallback = "root") {
  const raw = value == null || String(value).trim() === "" ? fallback : String(value).trim();
  if (raw.includes("..")) return { error: `node path must not contain "..": ${raw}` };
  return { path: raw.replace(/^\/+/, "") || "root" };
}

function cleanIdentifier(value, label) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || !CLASS_NAME_RE.test(raw) || raw.length > 64) {
    return { error: `${label} must be a valid GDScript identifier (1-64 chars)` };
  }
  return { value: raw };
}

function cleanScenePath(value) {
  if (value == null || String(value).trim() === "") return { scenePath: undefined };
  const rel = normalizeUserProjectPath(String(value));
  if (!rel || rel.includes("..") || rel.includes("\\")) {
    return { error: "scene_path must be a project-relative scene path (no traversal)" };
  }
  return { scenePath: `res://${rel}` };
}

export const tools = [
  {
    name: "signal_connect",
    description: `Connect a signal from a source node to a target node method at runtime in a headless Godot process. Operates on the project's main scene, or on a specific scene when scene_path is given. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        source_node: { type: "string", description: "Source node path (e.g. root/Player)" },
        signal_name: { type: "string", description: "Signal name to connect" },
        target_node: { type: "string", description: "Target node path" },
        method_name: { type: "string", description: "Target method name (defaults to _on_<source>_<signal> convention is NOT applied; required)" },
        flags: { type: "number", description: "Optional connection flags (default 0)" },
        scene_path: { type: "string", description: "Optional scene file (res:// or project-relative) to load instead of the main scene" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "source_node", "signal_name", "target_node", "method_name"],
    },
  },
  {
    name: "signal_disconnect",
    description: `Disconnect a signal from a source node to a target node method at runtime in a headless Godot process. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        source_node: { type: "string", description: "Source node path" },
        signal_name: { type: "string", description: "Signal name to disconnect" },
        target_node: { type: "string", description: "Target node path" },
        method_name: { type: "string", description: "Target method name" },
        scene_path: { type: "string", description: "Optional scene file to load instead of the main scene" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "source_node", "signal_name", "target_node", "method_name"],
    },
  },
  {
    name: "signal_emit",
    description: `Emit a signal on a node at runtime in a headless Godot process. Signal arguments are limited to basic types (string/number/bool/null). ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        source_node: { type: "string", description: "Source node path" },
        signal_name: { type: "string", description: "Signal name to emit" },
        args: { type: "array", description: "Signal arguments (string/number/bool/null only)", items: {} },
        scene_path: { type: "string", description: "Optional scene file to load instead of the main scene" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "source_node", "signal_name"],
    },
  },
  {
    name: "signal_list",
    description: `List the signals available on a node at runtime in a headless Godot process. ${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        node_path: { type: "string", description: "Node path (default: root)" },
        scene_path: { type: "string", description: "Optional scene file to load instead of the main scene" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path"],
    },
  },
];

async function runTrusted(args, ctx, code, mapError) {
  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path ?? ctx?.godotPath);
  const result = await executeGdscript({ godotPath: godot, projectPath, code, timeout: 30, trusted: true });
  return parseGdscriptResult(result, { mapError });
}

const mapSignalError = (msg) => (msg.includes("not found") ? "NODE_NOT_FOUND" : "SCRIPT_EXEC_FAILED");

export async function handle(toolName, args, ctx) {
  const sp = cleanScenePath(args.scene_path);
  if (sp.error) return opsErrorResult("INVALID_PATH", sp.error);
  const scenePath = sp.scenePath;

  switch (toolName) {
    case "signal_connect":
    case "signal_disconnect": {
      const source = cleanNodePath(args.source_node, "");
      if (source.error || source.path === "root" && !args.source_node) return opsErrorResult("INVALID_SIGNAL", source.error || "source_node is required");
      const target = cleanNodePath(args.target_node, "");
      if (target.error || !args.target_node) return opsErrorResult("INVALID_SIGNAL", target.error || "target_node is required");
      const sig = cleanIdentifier(args.signal_name, "signal_name");
      if (sig.error) return opsErrorResult("INVALID_SIGNAL", sig.error);
      const method = cleanIdentifier(args.method_name, "method_name");
      if (method.error) return opsErrorResult("INVALID_SIGNAL", method.error);
      let flags;
      if (args.flags !== undefined) {
        const f = Number(args.flags);
        if (!Number.isFinite(f)) return opsErrorResult("INVALID_SIGNAL", "flags must be a number");
        flags = Math.trunc(f);
      }
      const code = toolName === "signal_connect"
        ? genSignalConnectScript({ sourcePath: source.path, signalName: sig.value, targetPath: target.path, methodName: method.value, flags, scenePath })
        : genSignalDisconnectScript({ sourcePath: source.path, signalName: sig.value, targetPath: target.path, methodName: method.value, scenePath });
      return runTrusted(args, ctx, code, mapSignalError);
    }

    case "signal_emit": {
      const source = cleanNodePath(args.source_node, "");
      if (source.error || !args.source_node) return opsErrorResult("INVALID_SIGNAL", source.error || "source_node is required");
      const sig = cleanIdentifier(args.signal_name, "signal_name");
      if (sig.error) return opsErrorResult("INVALID_SIGNAL", sig.error);
      const emitArgs = args.args;
      if (emitArgs !== undefined && !Array.isArray(emitArgs)) {
        return opsErrorResult("INVALID_SIGNAL", "args must be an array");
      }
      let code;
      try {
        code = genSignalEmitScript({ sourcePath: source.path, signalName: sig.value, args: emitArgs, scenePath });
      } catch (err) {
        return opsErrorResult("INVALID_SIGNAL", err.message);
      }
      return runTrusted(args, ctx, code, mapSignalError);
    }

    case "signal_list": {
      const node = cleanNodePath(args.node_path);
      if (node.error) return opsErrorResult("INVALID_PATH", node.error);
      const code = genSignalListScript({ nodePath: node.path, scenePath });
      return runTrusted(args, ctx, code, mapSignalError);
    }

    default:
      return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  }
}
