import { opsErrorResult, gdEscape, CLASS_NAME_RE } from "../util.js";
import { requireProjectPath } from "../path-utils.js";
import { resolveGodotPath } from "../godot-process.js";
import { executeGdscript, parseGdscriptResult, SCENE_TREE_HEADER } from "../gdscript.js";

export function genGetClassInfoScript(className, includeInherited) {
  return `${SCENE_TREE_HEADER}
func _initialize():
\tif not ClassDB.class_exists("${gdEscape(className)}"):
\t\t_mcp_output("error", "Class not found: ${gdEscape(className)}")
\t\t_mcp_done()
\t\treturn
\tvar info = {}
\tinfo["name"] = "${gdEscape(className)}"
\tinfo["inherits"] = ClassDB.get_parent_class("${gdEscape(className)}")
\tvar methods = []
\tfor m in ClassDB.class_get_method_list("${gdEscape(className)}", ${includeInherited}):
\t\tvar margs = []
\t\tfor a in m["args"]:
\t\t\tmargs.append({"name": a["name"], "type": a["type"], "default": a.get("default_value", null)})
\t\tmethods.append({"name": m["name"], "return_type": m["return"]["type"], "arguments": margs, "flags": m["flags"]})
\tinfo["methods"] = methods
\tvar props = []
\tfor p in ClassDB.class_get_property_list("${gdEscape(className)}", ${includeInherited}):
\t\tprops.append({"name": p["name"], "type": p["type"], "hint": p["hint"], "hint_string": p["hint_string"]})
\tinfo["properties"] = props
\tvar signals = []
\tfor s in ClassDB.class_get_signal_list("${gdEscape(className)}", ${includeInherited}):
\t\tvar sargs = []
\t\tfor a in s["args"]:
\t\t\tsargs.append({"name": a["name"], "type": a["type"]})
\t\tsignals.append({"name": s["name"], "arguments": sargs})
\tinfo["signals"] = signals
\tvar constants = []
\tfor c in ClassDB.class_get_integer_constant_list("${gdEscape(className)}", ${includeInherited}):
\t\tconstants.append({"name": c, "value": ClassDB.class_get_integer_constant("${gdEscape(className)}", c)})
\tinfo["constants"] = constants
\tinfo["enums"] = ClassDB.class_get_enum_list("${gdEscape(className)}", ${includeInherited})
\t_mcp_output("class_info", info)
\t_mcp_done()
`;
}

export function genSearchClassesScript(query, limit) {
  return `${SCENE_TREE_HEADER}
func _initialize():
\tvar q = "${gdEscape(query)}".to_lower()
\tvar matches = []
\tfor c in ClassDB.get_class_list():
\t\tif c.to_lower().contains(q):
\t\t\tmatches.append({"name": c, "inherits": ClassDB.get_parent_class(c)})
\t\t\tif matches.size() >= ${limit}:
\t\t\t\tbreak
\tmatches.sort_custom(func(a, b): return a["name"] < b["name"])
\t_mcp_output("matches", matches)
\t_mcp_output("count", matches.size())
\t_mcp_done()
`;
}

export function genFindMethodScript(className, methodName) {
  return `${SCENE_TREE_HEADER}
func _initialize():
\tif not ClassDB.class_exists("${gdEscape(className)}"):
\t\t_mcp_output("error", "Class not found: ${gdEscape(className)}")
\t\t_mcp_done()
\t\treturn
\tvar found = null
\tvar found_in = ""
\tvar cur = "${gdEscape(className)}"
\twhile cur != "" and found == null:
\t\tfor m in ClassDB.class_get_method_list(cur, true):
\t\t\tif m["name"] == "${gdEscape(methodName)}":
\t\t\t\tfound = m
\t\t\t\tfound_in = cur
\t\t\t\tbreak
\t\tif found != null:
\t\t\tbreak
\t\tcur = ClassDB.get_parent_class(cur)
\tif found == null:
\t\t_mcp_output("error", "Method not found: ${gdEscape(methodName)} on ${gdEscape(className)}")
\t\t_mcp_done()
\t\treturn
\tvar margs = []
\tfor a in found["args"]:
\t\tmargs.append({"name": a["name"], "type": a["type"], "default": a.get("default_value", null)})
\t_mcp_output("method", {"class": "${gdEscape(className)}", "defined_in": found_in, "name": found["name"], "return_type": found["return"]["type"], "arguments": margs})
\t_mcp_done()
`;
}

export function genGetInheritanceScript(className) {
  return `${SCENE_TREE_HEADER}
func _initialize():
\tif not ClassDB.class_exists("${gdEscape(className)}"):
\t\t_mcp_output("error", "Class not found: ${gdEscape(className)}")
\t\t_mcp_done()
\t\treturn
\tvar chain = []
\tvar cur = "${gdEscape(className)}"
\twhile cur != "":
\t\tchain.append(cur)
\t\tcur = ClassDB.get_parent_class(cur)
\t_mcp_output("inheritance_chain", chain)
\t_mcp_done()
`;
}

export const tools = [
  {
    name: "get_class_info",
    description: "Get Godot class info (methods, properties, signals, constants, enums) via headless ClassDB introspection. No doc database is used; data reflects the installed Godot binary.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        class_name: { type: "string", description: "Godot class name, e.g. Node2D" },
        include_inherited: { type: "boolean", description: "Include inherited members (default true)", default: true },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "class_name"],
    },
  },
  {
    name: "search_classes",
    description: "Search Godot class names via headless ClassDB introspection (substring match, case-insensitive).",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        query: { type: "string", description: "Search query (substring match)" },
        limit: { type: "number", description: "Max results (default 20)", default: 20 },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "query"],
    },
  },
  {
    name: "find_method",
    description: "Find a method on a Godot class (searching up the inheritance chain) via headless ClassDB introspection.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        class_name: { type: "string", description: "Godot class name" },
        method_name: { type: "string", description: "Method name to find" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "class_name", "method_name"],
    },
  },
  {
    name: "get_inheritance",
    description: "Get the inheritance chain of a Godot class via headless ClassDB introspection.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        class_name: { type: "string", description: "Godot class name" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "class_name"],
    },
  },
];

async function runScript(script, args, ctx) {
  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
  const result = await executeGdscript({ godotPath: godot, projectPath, code: script, timeout: 60, trusted: true });
  return parseGdscriptResult(result, {
    mapError: (msg) => (msg.includes("not found") ? "CLASS_NOT_FOUND" : "SCRIPT_EXEC_FAILED"),
  });
}

function validClassName(name) {
  return typeof name === "string" && CLASS_NAME_RE.test(name);
}

export async function handle(toolName, args, ctx) {
  try {
    switch (toolName) {
      case "get_class_info": {
        if (!validClassName(args.class_name)) {
          return opsErrorResult("INVALID_PARAMS", "class_name must be a valid class identifier");
        }
        return runScript(genGetClassInfoScript(args.class_name, args.include_inherited !== false), args, ctx);
      }
      case "search_classes": {
        const query = String(args.query ?? "");
        if (!query) return opsErrorResult("INVALID_PARAMS", "query is required");
        let limit = 20;
        if (args.limit !== undefined) {
          if (!Number.isInteger(args.limit) || args.limit <= 0 || args.limit > 500) {
            return opsErrorResult("INVALID_PARAMS", "limit must be a positive integer (max 500)");
          }
          limit = args.limit;
        }
        return runScript(genSearchClassesScript(query, limit), args, ctx);
      }
      case "find_method": {
        if (!validClassName(args.class_name)) {
          return opsErrorResult("INVALID_PARAMS", "class_name must be a valid class identifier");
        }
        if (!validClassName(args.method_name)) {
          return opsErrorResult("INVALID_PARAMS", "method_name must be a valid identifier");
        }
        return runScript(genFindMethodScript(args.class_name, args.method_name), args, ctx);
      }
      case "get_inheritance": {
        if (!validClassName(args.class_name)) {
          return opsErrorResult("INVALID_PARAMS", "class_name must be a valid class identifier");
        }
        return runScript(genGetInheritanceScript(args.class_name), args, ctx);
      }
      default:
        return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
    }
  } catch (err) {
    return opsErrorResult("INVALID_PARAMS", err.message);
  }
}
