import fs from "node:fs";
import { textResult, opsErrorResult, normalizeNodePath, ensureDir, writeAtomic, CLASS_NAME_RE, gdEscape, toSnakeCase, BLOCKED_PROPS } from "../util.js";
import { resolveGodotPath, runGodotScript } from "../godot-process.js";
import { requireProjectPath, resolveWithinRoot, normalizeUserProjectPath } from "../path-utils.js";
import { parseTscn, parseTscnSummary, diffTscn } from "../tscn/parser.js";
import { addNode, addNodes, removeNode, editNodeProperties, nodePathToNameAndParent, findInstanceNode, detachInstance } from "../tscn/editor.js";
import { mergeTscn } from "../tscn/merge.js";
import { gateDestructive } from "../guard.js";
import { executeGdscript, parseGdscriptResult, SCENE_TREE_HEADER } from "../gdscript.js";

const GODOT_OPS_ACTIONS = new Set(["create_scene", "batch_add_nodes", "save_scene", "load_sprite"]);

function validateSceneRelPath(projectPath, scenePathRaw) {
  if (typeof scenePathRaw !== "string" || scenePathRaw.trim() === "") {
    throw new Error("scene_path is required");
  }
  const rel = normalizeUserProjectPath(scenePathRaw);
  const abs = resolveWithinRoot(projectPath, rel);
  return { rel, abs };
}

async function runGodotOps(action, params, args, ctx) {
  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
  const result = await runGodotScript("godot_operations.gd", action, params, projectPath, {
    timeout: 60000,
    godotPath: godot,
  });
  if (result.timedOut) {
    return { content: [{ type: "text", text: `${action} timed out.` }], isError: true };
  }
  if (result.exitCode !== 0) {
    return {
      content: [{ type: "text", text: `${action} failed (exit code ${result.exitCode}):\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}` }],
      isError: true,
    };
  }
  return textResult(result.stdout.trim() || `${action} completed successfully.`);
}

function toTscnParent(rawParent) {
  const raw = String(rawParent || "root");
  if (raw === "root" || raw === "/root" || raw === "") return ".";
  const stripped = raw.replace(/^\/?root\/?/, "");
  return stripped || ".";
}

function validNodeName(name) {
  return typeof name === "string" && name.length > 0 && !/[\]["/:\\]/.test(name);
}

export const tools = [
  {
    name: "read_scene",
    description: "Read and parse a .tscn scene file. Returns the full parsed structure (header, resources, node tree, connections) or a text summary.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project (or res:// path)" },
        summary_only: { type: "boolean", description: "Return a text summary instead of full JSON (default: false)", default: false },
      },
      required: ["project_path", "scene_path"],
    },
  },
  {
    name: "create_scene",
    description: "Create a new scene with a root node of the given type via headless Godot.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project (or res:// path)" },
        root_node_type: { type: "string", description: "Root node type (default: Node2D)", default: "Node2D" },
        root_node_name: { type: "string", description: "Root node name (default: root)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path"],
    },
  },
  {
    name: "quick_scene",
    description: "Create a minimal .tscn file directly on disk (no Godot process), optionally with an attached script.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        root_node_type: { type: "string", description: "Root node type (default: Node2D)", default: "Node2D" },
        root_node_name: { type: "string", description: "Root node name (default: PascalCase of file name)" },
        script_path: { type: "string", description: "Optional script path relative to project to attach" },
        script_content: { type: "string", description: "Optional script content to write when the script file does not exist" },
      },
      required: ["project_path", "scene_path"],
    },
  },
  {
    name: "add_node",
    description: "Add a node to an existing scene. Uses pure .tscn text editing when possible, falling back to a headless Godot process for complex property values.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        node_type: { type: "string", description: "Node type, e.g. Sprite2D, Camera2D" },
        node_name: { type: "string", description: "Name for the new node" },
        parent_node_path: { type: "string", description: "Parent node path (default: root)", default: "root" },
        properties: { type: "object", description: "Property key/value pairs to set" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path", "node_type", "node_name"],
    },
  },
  {
    name: "batch_add_nodes",
    description: "Add multiple nodes to a scene in one operation (max 100).",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        nodes: {
          type: "array",
          description: "Node definitions",
          items: {
            type: "object",
            properties: {
              node_type: { type: "string" },
              node_name: { type: "string" },
              parent_node_path: { type: "string", default: "root" },
              properties: { type: "object" },
            },
            required: ["node_type", "node_name"],
          },
        },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path", "nodes"],
    },
  },
  {
    name: "edit_node",
    description: "Edit properties of an existing node in a .tscn scene file.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        node_path: { type: "string", description: "Node path, e.g. root/Player/Sprite2D" },
        properties: { type: "object", description: "Property key/value pairs to set" },
      },
      required: ["project_path", "scene_path", "node_path", "properties"],
    },
  },
  {
    name: "remove_node",
    description: "Remove a node (and its descendants) from a .tscn scene file. Destructive: requires a confirm_token obtained by calling this tool without one first.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        node_path: { type: "string", description: "Node path, e.g. root/Player/Sprite2D" },
        confirm_token: { type: "string", description: "Confirmation token from a previous call" },
      },
      required: ["project_path", "scene_path", "node_path"],
    },
  },
  {
    name: "save_scene",
    description: "Re-save a scene via headless Godot (pack + ResourceSaver.save), optionally to a new path.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        new_path: { type: "string", description: "Optional new scene path (save-as)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path"],
    },
  },
  {
    name: "load_sprite",
    description: "Load a texture into a Sprite2D/Sprite3D/TextureRect node of a scene via headless Godot.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        texture_path: { type: "string", description: "Texture path, e.g. res://assets/player.png" },
        node_path: { type: "string", description: "Target node path (default: root)", default: "root" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path", "texture_path"],
    },
  },
  {
    name: "instance_scene",
    description: "Instance another scene (PackedScene) as a child node inside a scene via headless Godot.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Target scene file path relative to project" },
        instance_path: { type: "string", description: "Scene to instance, res:// path ending in .tscn" },
        parent_node_path: { type: "string", description: "Parent node path (default: root)", default: "root" },
        node_name: { type: "string", description: "Optional name for the instance root" },
        properties: { type: "object", description: "Property overrides for the instance root" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path", "instance_path"],
    },
  },
  {
    name: "detach_instance",
    description: "Detach an instanced scene node: inlines the source scene's nodes into the target scene (property overrides preserved).",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        node_path: { type: "string", description: "Instance root node path" },
      },
      required: ["project_path", "scene_path", "node_path"],
    },
  },
  {
    name: "diff_scenes",
    description: "Diff two .tscn scene files: nodes added, removed, and changed (property-level).",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Base scene path relative to project" },
        other_path: { type: "string", description: "Scene path to compare against, relative to project" },
      },
      required: ["project_path", "scene_path", "other_path"],
    },
  },
  {
    name: "merge_scene",
    description: "Merge two .tscn scene files (theirs into ours): resources are deduplicated and re-indexed, nodes from theirs that are missing in ours are appended. Writes the merged result into scene_path. Destructive: requires a confirm_token.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Ours: scene path merged into, relative to project" },
        new_path: { type: "string", description: "Theirs: scene path to merge from, relative to project" },
        confirm_token: { type: "string", description: "Confirmation token from a previous call" },
      },
      required: ["project_path", "scene_path", "new_path"],
    },
  },
];

export async function handle(toolName, args, ctx) {
  switch (toolName) {
    case "read_scene": {
      const projectPath = requireProjectPath(args);
      const { abs } = validateSceneRelPath(projectPath, args.scene_path);
      if (!fs.existsSync(abs)) {
        return opsErrorResult("FILE_NOT_FOUND", `Scene file not found: ${args.scene_path}`);
      }
      const content = fs.readFileSync(abs, "utf8");
      if (args.summary_only) {
        return textResult(parseTscnSummary(content));
      }
      const parsed = parseTscn(content);
      const roots = parsed.nodes.filter((n) => !n.parent);
      return textResult(JSON.stringify({
        header: parsed.header,
        extResources: parsed.extResources,
        subResources: parsed.subResources,
        nodeTree: roots,
        connections: parsed.connections,
        totalNodes: parsed.nodes.length,
      }, null, 2));
    }

    case "create_scene": {
      const projectPath = requireProjectPath(args);
      const { rel } = validateSceneRelPath(projectPath, args.scene_path);
      const rootNodeType = String(args.root_node_type || "Node2D");
      if (!CLASS_NAME_RE.test(rootNodeType)) {
        return opsErrorResult("INVALID_PARAMS", `root_node_type contains invalid characters: "${rootNodeType}"`);
      }
      const params = { scene_path: rel, root_node_type: rootNodeType };
      if (args.root_node_name) params.root_node_name = String(args.root_node_name);
      return runGodotOps("create_scene", params, args, ctx);
    }

    case "quick_scene": {
      const projectPath = requireProjectPath(args);
      const { rel: sceneRel, abs: sceneAbs } = validateSceneRelPath(projectPath, args.scene_path);
      const rootNodeType = String(args.root_node_type || "Node2D");
      if (!CLASS_NAME_RE.test(rootNodeType)) {
        return opsErrorResult("INVALID_PARAMS", `root_node_type contains invalid characters: "${rootNodeType}"`);
      }
      let rootNodeName = args.root_node_name;
      if (!rootNodeName) {
        const baseName = sceneRel.split("/").pop().replace(/\.tscn$/i, "");
        rootNodeName = baseName
          ? baseName.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("")
          : "Root";
      }
      if (!CLASS_NAME_RE.test(rootNodeName)) {
        return opsErrorResult("INVALID_PARAMS", `root_node_name must match ${CLASS_NAME_RE}, got: "${rootNodeName}"`);
      }
      if (fs.existsSync(sceneAbs)) {
        return opsErrorResult("ALREADY_EXISTS", `Scene already exists: ${sceneRel}. Remove it first or use a different path.`);
      }

      const scriptRel = args.script_path ? normalizeUserProjectPath(String(args.script_path)) : undefined;
      let tscnContent;
      if (scriptRel) {
        resolveWithinRoot(projectPath, scriptRel);
        tscnContent = [
          "[gd_scene load_steps=2 format=3]",
          "",
          `[ext_resource type="Script" path="res://${scriptRel.replace(/\\/g, "/")}" id="1"]`,
          "",
          `[node name="${rootNodeName}" type="${rootNodeType}"]`,
          'script = ExtResource("1")',
          "",
        ].join("\n");
      } else {
        tscnContent = ["[gd_scene format=3]", "", `[node name="${rootNodeName}" type="${rootNodeType}"]`, ""].join("\n");
      }

      ensureDir(sceneAbs);
      fs.writeFileSync(sceneAbs, tscnContent, "utf8");

      const parts = [`Created scene: ${sceneRel}`, `Root: ${rootNodeName} [${rootNodeType}]`];
      if (scriptRel) {
        parts.push(`Script: res://${scriptRel.replace(/\\/g, "/")}`);
        if (args.script_content) {
          const scriptAbs = resolveWithinRoot(projectPath, scriptRel);
          if (!fs.existsSync(scriptAbs)) {
            ensureDir(scriptAbs);
            fs.writeFileSync(scriptAbs, String(args.script_content), "utf8");
            parts.push("Script file created");
          }
        }
      }
      return textResult(parts.join("\n"));
    }

    case "add_node": {
      const projectPath = requireProjectPath(args);
      const { rel: sceneRel, abs: sceneAbs } = validateSceneRelPath(projectPath, args.scene_path);
      const nodeType = String(args.node_type ?? "");
      const nodeName = String(args.node_name ?? "");
      if (!CLASS_NAME_RE.test(nodeType)) {
        return opsErrorResult("INVALID_PARAMS", `node_type contains invalid characters: "${nodeType}"`);
      }
      if (!validNodeName(nodeName)) {
        return opsErrorResult("INVALID_PARAMS", `node_name contains invalid characters: "${nodeName}"`);
      }
      if (!fs.existsSync(sceneAbs)) {
        return opsErrorResult("FILE_NOT_FOUND", `Scene file not found: ${sceneRel}`);
      }

      const tscnParent = toTscnParent(args.parent_node_path);
      const content = fs.readFileSync(sceneAbs, "utf8");
      const result = addNode(content, {
        parent: tscnParent,
        name: nodeName,
        type: nodeType,
        properties: args.properties,
      });

      if (result.success && result.fallback) {
        return runGodotOps("add_node", {
          scene_path: sceneRel,
          node_type: nodeType,
          node_name: nodeName,
          parent_node_path: String(args.parent_node_path || "root"),
          ...(args.properties ? { properties: args.properties } : {}),
        }, args, ctx);
      }

      if (!result.success) {
        return opsErrorResult("EDIT_FAILED", result.message);
      }

      fs.writeFileSync(sceneAbs, result.scene, "utf8");
      if (result.blockedProps && result.blockedProps.length > 0) {
        const hint = result.blockedProps.includes("script")
          ? " For scripts use quick_scene script_path, or add an [ext_resource] + script = ExtResource(...) line directly."
          : "";
        return textResult(`WARNING: Blocked properties NOT written (security policy): ${result.blockedProps.join(", ")}.${hint}\n${result.message}`);
      }
      return textResult(result.message);
    }

    case "batch_add_nodes": {
      const projectPath = requireProjectPath(args);
      const { rel: sceneRel, abs: sceneAbs } = validateSceneRelPath(projectPath, args.scene_path);
      const nodes = args.nodes;
      if (!Array.isArray(nodes) || nodes.length === 0) {
        return opsErrorResult("INVALID_PARAMS", '"nodes" must be a non-empty array of node definitions.');
      }
      if (nodes.length > 100) {
        return opsErrorResult("INVALID_PARAMS", `Too many nodes (${nodes.length}). Maximum: 100`);
      }
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        if (!n.node_type || !CLASS_NAME_RE.test(String(n.node_type))) {
          return opsErrorResult("INVALID_PARAMS", `nodes[${i}].node_type contains invalid characters: "${n.node_type}"`);
        }
        if (!validNodeName(n.node_name)) {
          return opsErrorResult("INVALID_PARAMS", `nodes[${i}].node_name contains invalid characters: "${n.node_name}"`);
        }
      }
      if (!fs.existsSync(sceneAbs)) {
        return opsErrorResult("FILE_NOT_FOUND", `Scene file not found: ${sceneRel}`);
      }

      const content = fs.readFileSync(sceneAbs, "utf8");
      const result = addNodes(content, nodes.map((n) => ({
        parent: toTscnParent(n.parent_node_path),
        name: String(n.node_name),
        type: String(n.node_type),
        properties: n.properties,
      })));

      if (result.success && result.fallback) {
        return runGodotOps("batch_add_nodes", { scene_path: sceneRel, nodes }, args, ctx);
      }
      if (!result.success) {
        return opsErrorResult("EDIT_FAILED", result.message);
      }
      fs.writeFileSync(sceneAbs, result.scene, "utf8");
      if (result.blockedProps && result.blockedProps.length > 0) {
        return textResult(`WARNING: Blocked properties NOT written (security policy): ${[...new Set(result.blockedProps)].join(", ")}.\n${result.message}`);
      }
      return textResult(result.message);
    }

    case "edit_node": {
      const projectPath = requireProjectPath(args);
      const { abs: sceneAbs, rel: sceneRel } = validateSceneRelPath(projectPath, args.scene_path);
      if (!fs.existsSync(sceneAbs)) {
        return opsErrorResult("FILE_NOT_FOUND", `Scene file not found: ${sceneRel}`);
      }
      const properties = args.properties;
      if (!properties || typeof properties !== "object" || Array.isArray(properties) || Object.keys(properties).length === 0) {
        return opsErrorResult("INVALID_PARAMS", '"properties" must be a non-empty object.');
      }
      let parsed;
      try {
        parsed = nodePathToNameAndParent(normalizeNodePath(args.node_path));
      } catch (err) {
        return opsErrorResult("INVALID_PARAMS", err.message);
      }
      const nodePath = parsed.parent === "." ? parsed.nodeName : `${parsed.parent}/${parsed.nodeName}`;

      const content = fs.readFileSync(sceneAbs, "utf8");
      const result = editNodeProperties(content, nodePath, properties);
      if (!result.success) {
        return opsErrorResult("EDIT_FAILED", result.message);
      }
      fs.writeFileSync(sceneAbs, result.scene, "utf8");
      if (result.blockedProps && result.blockedProps.length > 0) {
        return textResult(`WARNING: Blocked properties NOT applied (security policy): ${result.blockedProps.join(", ")}.\n${result.message}`);
      }
      return textResult(result.message);
    }

    case "remove_node": {
      return gateDestructive("remove_node", args, (confirmedArgs) => {
        const projectPath = requireProjectPath(confirmedArgs);
        const { abs: sceneAbs, rel: sceneRel } = validateSceneRelPath(projectPath, confirmedArgs.scene_path);
        if (!fs.existsSync(sceneAbs)) {
          return opsErrorResult("FILE_NOT_FOUND", `Scene file not found: ${sceneRel}`);
        }
        let parsed;
        try {
          parsed = nodePathToNameAndParent(normalizeNodePath(confirmedArgs.node_path));
        } catch (err) {
          return opsErrorResult("INVALID_PARAMS", err.message);
        }
        if (parsed.parent === "." && !fs.readFileSync(sceneAbs, "utf8").includes(`parent="."`)) {
          return opsErrorResult("INVALID_PARAMS", "Cannot remove the root node");
        }
        const nodePath = parsed.parent === "." ? parsed.nodeName : `${parsed.parent}/${parsed.nodeName}`;
        const content = fs.readFileSync(sceneAbs, "utf8");
        const result = removeNode(content, nodePath);
        if (!result.success) {
          return opsErrorResult("EDIT_FAILED", result.message);
        }
        fs.writeFileSync(sceneAbs, result.scene, "utf8");
        return textResult(result.message);
      });
    }

    case "save_scene": {
      const projectPath = requireProjectPath(args);
      const { rel: sceneRel } = validateSceneRelPath(projectPath, args.scene_path);
      const params = { scene_path: sceneRel };
      if (args.new_path) {
        try {
          const np = normalizeUserProjectPath(String(args.new_path));
          resolveWithinRoot(projectPath, np);
          params.new_path = np;
        } catch {
          return opsErrorResult("INVALID_PATH", "new_path contains path traversal");
        }
      }
      return runGodotOps("save_scene", params, args, ctx);
    }

    case "load_sprite": {
      const projectPath = requireProjectPath(args);
      const { rel: sceneRel } = validateSceneRelPath(projectPath, args.scene_path);
      const texturePath = String(args.texture_path ?? "");
      if (texturePath.replace(/\\/g, "/").split("/").includes("..")) {
        return opsErrorResult("INVALID_PATH", "texture_path contains path traversal");
      }
      return runGodotOps("load_sprite", {
        scene_path: sceneRel,
        texture_path: texturePath,
        node_path: args.node_path || "root",
      }, args, ctx);
    }

    case "instance_scene": {
      const projectPath = requireProjectPath(args);
      const { rel: sceneRel, abs: sceneAbs } = validateSceneRelPath(projectPath, args.scene_path);
      const instancePath = String(args.instance_path ?? "");
      if (!/^res:\/\/[a-zA-Z0-9_\-/.]+\.tscn$/.test(instancePath)) {
        return opsErrorResult("INVALID_PARAMS", "instance_path must be a valid res:// path ending in .tscn");
      }
      const instanceAbs = resolveWithinRoot(projectPath, normalizeUserProjectPath(instancePath));
      if (sceneAbs === instanceAbs) {
        return opsErrorResult("CIRCULAR_REFERENCE", "scene_path and instance_path must not be the same");
      }
      if (!fs.existsSync(sceneAbs)) {
        return opsErrorResult("FILE_NOT_FOUND", `Scene file not found: ${sceneRel}`);
      }
      if (!fs.existsSync(instanceAbs)) {
        return opsErrorResult("FILE_NOT_FOUND", `Instance scene not found: ${instancePath}`);
      }

      const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
      const parentNodePath = normalizeNodePath(args.parent_node_path || "root");
      const nodeName = args.node_name ? String(args.node_name) : "";

      const rawProps = args.properties;
      if (rawProps !== undefined && rawProps !== null && (typeof rawProps !== "object" || Array.isArray(rawProps))) {
        return opsErrorResult("INVALID_PARAMS", "properties must be an object");
      }
      const properties = rawProps ?? {};

      const gdValue = (value) => {
        if (value === null || value === undefined) return "null";
        if (typeof value === "boolean") return value ? "true" : "false";
        if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
        if (typeof value === "string") return `"${gdEscape(value)}"`;
        return JSON.stringify(value);
      };

      let propLines = "";
      for (const [key, value] of Object.entries(properties)) {
        if (BLOCKED_PROPS.has(key)) continue;
        const gdKey = toSnakeCase(key);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(gdKey)) continue;
        const gd = gdValue(value);
        if (gd === null) continue;
        propLines += `\n\t_inst.set("${gdKey}", ${gd})`;
      }
      const nameLine = nodeName ? `\n\t_inst.name = "${gdEscape(nodeName)}"` : "";

      const script = `${SCENE_TREE_HEADER}
func _initialize():
\tif not _mcp_load_scene("${gdEscape(sceneAbs)}"):
\t\t_mcp_done()
\t\treturn
\tvar _scene_res = load("${gdEscape(instancePath)}")
\tif _scene_res == null:
\t\t_mcp_output("error", "Failed to load instance: ${gdEscape(instancePath)}")
\t\t_mcp_done()
\t\treturn
\tif not (_scene_res is PackedScene):
\t\t_mcp_output("error", "Resource is not a PackedScene: ${gdEscape(instancePath)}")
\t\t_mcp_done()
\t\treturn
\tvar _inst = _scene_res.instantiate()
\tif _inst == null:
\t\t_mcp_output("error", "Failed to instantiate: ${gdEscape(instancePath)}")
\t\t_mcp_done()
\t\treturn${nameLine}${propLines}
\tvar _parent = _mcp_get_scene_node("${gdEscape(parentNodePath)}")
\tif _parent == null:
\t\t_mcp_output("error", "Parent node not found: ${gdEscape(parentNodePath)}")
\t\t_mcp_done()
\t\treturn
\t_parent.add_child(_inst, true)
\t_inst.owner = _mcp_scene_instance
\tvar _packed = PackedScene.new()
\tvar _pack_err = _packed.pack(_mcp_scene_instance)
\tif _pack_err != OK:
\t\t_mcp_output("error", "Failed to pack scene: " + str(_pack_err))
\t\t_mcp_done()
\t\treturn
\tvar _save_err = ResourceSaver.save(_packed, "${gdEscape(sceneAbs)}")
\tif _save_err != OK:
\t\t_mcp_output("error", "Failed to save scene: " + str(_save_err))
\t\t_mcp_done()
\t\treturn
\t_mcp_output("instanced", {"node_name": str(_inst.name), "node_type": _inst.get_class(), "instance_of": "${gdEscape(instancePath)}", "path": str(_inst.get_path())})
\t_mcp_done()
`;

      const result = await executeGdscript({
        godotPath: godot,
        projectPath,
        code: script,
        timeout: 30,
        trusted: true,
      });
      return parseGdscriptResult(result, {
        mapError: (msg) => {
          if (msg.includes("not found")) return "NODE_NOT_FOUND";
          if (msg.includes("not a PackedScene")) return "INVALID_RESOURCE";
          if (msg.includes("Failed to load")) return "LOAD_FAILED";
          return "SCRIPT_EXEC_FAILED";
        },
      });
    }

    case "detach_instance": {
      const projectPath = requireProjectPath(args);
      const { abs: sceneAbs, rel: sceneRel } = validateSceneRelPath(projectPath, args.scene_path);
      if (!fs.existsSync(sceneAbs)) {
        return opsErrorResult("FILE_NOT_FOUND", `Scene file not found: ${sceneRel}`);
      }
      let parsed;
      try {
        parsed = nodePathToNameAndParent(String(args.node_path));
      } catch (err) {
        return opsErrorResult("INVALID_PARAMS", err.message);
      }

      const targetContent = fs.readFileSync(sceneAbs, "utf8");
      const info = findInstanceNode(targetContent, parsed.nodeName, parsed.parent);
      if (!info) {
        return opsErrorResult("NOT_AN_INSTANCE", `Node "${parsed.nodeName}" (parent: "${parsed.parent}") is not an instance or not found`);
      }

      const sourceRel = info.sourcePath.replace(/^res:\/\//, "");
      if (sourceRel.split(/[/\\]/).includes("..")) {
        return opsErrorResult("INVALID_PATH", `Source scene path must not escape project root: ${info.sourcePath}`);
      }
      const sourceAbs = resolveWithinRoot(projectPath, sourceRel);
      if (!fs.existsSync(sourceAbs)) {
        return opsErrorResult("FILE_NOT_FOUND", `Source scene not found: ${info.sourcePath} (${sourceAbs})`);
      }

      const sourceContent = fs.readFileSync(sourceAbs, "utf8");
      let result;
      try {
        result = detachInstance(targetContent, sourceContent, parsed.nodeName, parsed.parent);
      } catch (err) {
        return opsErrorResult("EDIT_FAILED", `Error detaching instance: ${err.message}`);
      }

      writeAtomic(sceneAbs, result);
      return textResult(`Detached instance "${parsed.nodeName}" - inlined from ${info.sourcePath} (${info.propertyOverrides.length} property override(s) preserved)`);
    }

    case "diff_scenes": {
      const projectPath = requireProjectPath(args);
      const { abs: absA } = validateSceneRelPath(projectPath, args.scene_path);
      const { abs: absB } = validateSceneRelPath(projectPath, args.other_path);
      if (!fs.existsSync(absA)) return opsErrorResult("FILE_NOT_FOUND", `Scene not found: ${args.scene_path}`);
      if (!fs.existsSync(absB)) return opsErrorResult("FILE_NOT_FOUND", `Scene not found: ${args.other_path}`);
      const diff = diffTscn(fs.readFileSync(absA, "utf8"), fs.readFileSync(absB, "utf8"));
      return textResult(JSON.stringify(diff, null, 2));
    }

    case "merge_scene": {
      return gateDestructive("merge_scene", args, (confirmedArgs) => {
        const projectPath = requireProjectPath(confirmedArgs);
        const { abs: absA } = validateSceneRelPath(projectPath, confirmedArgs.scene_path);
        const { abs: absB } = validateSceneRelPath(projectPath, confirmedArgs.new_path);
        if (!fs.existsSync(absA)) return opsErrorResult("FILE_NOT_FOUND", `Scene A not found: ${confirmedArgs.scene_path}`);
        if (!fs.existsSync(absB)) return opsErrorResult("FILE_NOT_FOUND", `Scene B not found: ${confirmedArgs.new_path}`);
        const MAX = 10 * 1024 * 1024;
        if (fs.statSync(absA).size > MAX || fs.statSync(absB).size > MAX) {
          return opsErrorResult("FILE_TOO_LARGE", "Scene file exceeds 10MB merge limit");
        }
        const merged = mergeTscn(fs.readFileSync(absA, "utf8"), fs.readFileSync(absB, "utf8"));
        writeAtomic(absA, merged);
        return textResult(JSON.stringify({ merged_into: confirmedArgs.scene_path, source: confirmedArgs.new_path, status: "ok" }, null, 2));
      });
    }

    default:
      return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
  }
}

export { GODOT_OPS_ACTIONS };
