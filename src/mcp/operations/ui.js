import { opsErrorResult, gdEscape, normalizeNodePath, BLOCKED_PROPS } from "../util.js";
import { requireProjectPath, resolveWithinRoot, normalizeUserProjectPath } from "../path-utils.js";
import { resolveGodotPath } from "../godot-process.js";
import { executeGdscript, parseGdscriptResult, SCENE_TREE_HEADER } from "../gdscript.js";
import { valueToGd } from "./animation.js";

const NON_PERSIST = " Runtime effect only: changes do NOT persist to .tscn files (edit the scene file to persist).";

export const CONTROL_TYPES = [
  "Button", "Label", "Panel", "LineEdit", "TextEdit", "RichTextLabel",
  "LinkButton", "HSlider", "VSlider", "CheckBox", "CheckButton",
  "OptionButton", "SpinBox", "ProgressBar", "TextureRect",
  "ColorPickerButton", "TabContainer", "Tree", "ItemList",
  "MarginContainer", "HBoxContainer", "VBoxContainer", "GridContainer",
  "CenterContainer", "ScrollContainer", "PanelContainer",
  "HSplitContainer", "VSplitContainer", "NinePatchRect",
];

export const ANCHOR_PRESETS = {
  top_left: 0, top_right: 1, bottom_left: 2, bottom_right: 3,
  center_left: 4, center_top: 5, center_right: 6, center_bottom: 7,
  center: 8, left_wide: 9, top_wide: 10, right_wide: 11, bottom_wide: 12,
  vcenter_wide: 13, hcenter_wide: 14, full_rect: 15,
};

const MAX_NESTING_DEPTH = 10;
const VALID_DIRECTIONS = ["row", "column", "grid"];
const VALID_ALIGNMENTS = ["begin", "center", "end"];

function findBlockedProps(properties) {
  if (!properties) return [];
  return Object.keys(properties).filter((k) => BLOCKED_PROPS.has(k));
}

function genPropertyLines(properties, varName = "node") {
  let lines = "";
  for (const [key, value] of Object.entries(properties)) {
    lines += `\n\t${varName}.set("${gdEscape(key)}", ${valueToGd(value)})`;
  }
  return lines;
}

function sanitizeResPath(raw, field) {
  if (!raw || typeof raw !== "string" || !raw.startsWith("res://")) {
    throw new Error(`${field} must be a string starting with res://`);
  }
  const decoded = decodeURIComponent(raw);
  if (decoded.includes("/../") || decoded.endsWith("/..") || decoded.includes("\\")) {
    throw new Error(`${field} contains path traversal: ${raw}`);
  }
  return decoded;
}

export function genUiCreateControlScript(scenePath, nodeType, nodeName, parentPath, properties) {
  const propLines = properties && Object.keys(properties).length > 0 ? genPropertyLines(properties) : "";

  return `${SCENE_TREE_HEADER}
func _initialize():
\tif not _mcp_load_scene("${gdEscape(scenePath)}"):
\t\t_mcp_done()
\t\treturn
\tvar parent = _mcp_get_scene_node("${gdEscape(parentPath)}")
\tif parent == null:
\t\t_mcp_output("error", "Parent node not found: ${gdEscape(parentPath)}")
\t\t_mcp_done()
\t\treturn
\tvar node = ClassDB.instantiate("${gdEscape(nodeType)}")
\tif node == null:
\t\t_mcp_output("error", "Failed to instantiate: ${gdEscape(nodeType)}")
\t\t_mcp_done()
\t\treturn
\tnode.name = "${gdEscape(nodeName)}"${propLines}
\tparent.add_child(node)
\tnode.owner = parent.owner if parent.owner != null else parent
\t_mcp_output("created", {"type": "${gdEscape(nodeType)}", "name": "${gdEscape(nodeName)}", "path": str(node.get_path()) if node.is_inside_tree() else "${gdEscape(nodeName)}"})
\t_mcp_done()
`;
}

export function genUiContainerAddScript(scenePath, nodePath, childType, childName, childProperties) {
  if (!CONTROL_TYPES.includes(childType)) {
    throw new Error(`INVALID_CONTROL_TYPE: "${childType}" is not a whitelisted Control type`);
  }
  const propLines = childProperties && Object.keys(childProperties).length > 0 ? genPropertyLines(childProperties, "child") : "";

  return `${SCENE_TREE_HEADER}
func _initialize():
\tif not _mcp_load_scene("${gdEscape(scenePath)}"):
\t\t_mcp_done()
\t\treturn
\tvar container = _mcp_get_scene_node("${gdEscape(nodePath)}")
\tif container == null:
\t\t_mcp_output("error", "Container node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar child = ClassDB.instantiate("${gdEscape(childType)}")
\tif child == null:
\t\t_mcp_output("error", "Failed to instantiate: ${gdEscape(childType)}")
\t\t_mcp_done()
\t\treturn
\tchild.name = "${gdEscape(childName)}"${propLines}
\tcontainer.add_child(child)
\tchild.owner = container.owner if container.owner != null else container
\t_mcp_output("child_added", {"container": "${gdEscape(nodePath)}", "child_type": "${gdEscape(childType)}", "child_name": "${gdEscape(childName)}", "child_path": str(child.get_path()) if child.is_inside_tree() else "${gdEscape(childName)}"})
\t_mcp_done()
`;
}

export function genUiAnchorPresetScript(scenePath, nodePath, presetValue, presetName) {
  return `${SCENE_TREE_HEADER}
func _initialize():
\tif not _mcp_load_scene("${gdEscape(scenePath)}"):
\t\t_mcp_done()
\t\treturn
\tvar node = _mcp_get_scene_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif not node is Control:
\t\t_mcp_output("error", "Node is not a Control: " + node.get_class())
\t\t_mcp_done()
\t\treturn
\tnode.set_anchors_preset(${presetValue})
\t_mcp_output("preset_applied", {"node": "${gdEscape(nodePath)}", "preset": "${gdEscape(presetName)}", "value": ${presetValue}})
\t_mcp_done()
`;
}

export function genUiSetLayoutScript(scenePath, nodePath, anchors, offsets, minSize, customMinSize, growDirection) {
  let lines = "";

  if (anchors) {
    if (anchors.left !== undefined) lines += `\n\tnode.anchor_left = ${anchors.left}`;
    if (anchors.right !== undefined) lines += `\n\tnode.anchor_right = ${anchors.right}`;
    if (anchors.top !== undefined) lines += `\n\tnode.anchor_top = ${anchors.top}`;
    if (anchors.bottom !== undefined) lines += `\n\tnode.anchor_bottom = ${anchors.bottom}`;
  }
  if (offsets) {
    if (offsets.left !== undefined) lines += `\n\tnode.offset_left = ${offsets.left}`;
    if (offsets.right !== undefined) lines += `\n\tnode.offset_right = ${offsets.right}`;
    if (offsets.top !== undefined) lines += `\n\tnode.offset_top = ${offsets.top}`;
    if (offsets.bottom !== undefined) lines += `\n\tnode.offset_bottom = ${offsets.bottom}`;
  }
  if (minSize) {
    if (minSize.x !== undefined) lines += `\n\tnode.custom_minimum_size = Vector2(${minSize.x}, node.custom_minimum_size.y)`;
    if (minSize.y !== undefined) lines += `\n\tnode.custom_minimum_size = Vector2(node.custom_minimum_size.x, ${minSize.y})`;
  }
  if (customMinSize) {
    lines += `\n\tnode.custom_minimum_size = Vector2(${customMinSize.x ?? "node.custom_minimum_size.x"}, ${customMinSize.y ?? "node.custom_minimum_size.y"})`;
  }
  if (growDirection) {
    const dir = String(growDirection).toLowerCase();
    const dirMap = {
      both: "Control.GROW_DIRECTION_BOTH",
      up: "Control.GROW_DIRECTION_UP",
      down: "Control.GROW_DIRECTION_DOWN",
      left: "Control.GROW_DIRECTION_LEFT",
      right: "Control.GROW_DIRECTION_RIGHT",
    };
    const gdDir = dirMap[dir];
    if (gdDir) {
      if (dir === "left" || dir === "right" || dir === "both") lines += `\n\tnode.grow_horizontal = ${gdDir}`;
      if (dir === "up" || dir === "down" || dir === "both") lines += `\n\tnode.grow_vertical = ${gdDir}`;
    }
  }

  return `${SCENE_TREE_HEADER}
func _initialize():
\tif not _mcp_load_scene("${gdEscape(scenePath)}"):
\t\t_mcp_done()
\t\treturn
\tvar node = _mcp_get_scene_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif not node is Control:
\t\t_mcp_output("error", "Node is not a Control: " + node.get_class())
\t\t_mcp_done()
\t\treturn${lines}
\t_mcp_output("layout_set", {"node": "${gdEscape(nodePath)}"})
\t_mcp_done()
`;
}

export function genUiGetLayoutScript(scenePath, nodePath) {
  return `${SCENE_TREE_HEADER}
func _initialize():
\tif not _mcp_load_scene("${gdEscape(scenePath)}"):
\t\t_mcp_done()
\t\treturn
\tvar node = _mcp_get_scene_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif not node is Control:
\t\t_mcp_output("error", "Node is not a Control: " + node.get_class())
\t\t_mcp_done()
\t\treturn
\tvar info = {
\t\t"anchor_left": node.anchor_left,
\t\t"anchor_right": node.anchor_right,
\t\t"anchor_top": node.anchor_top,
\t\t"anchor_bottom": node.anchor_bottom,
\t\t"offset_left": node.offset_left,
\t\t"offset_right": node.offset_right,
\t\t"offset_top": node.offset_top,
\t\t"offset_bottom": node.offset_bottom,
\t\t"global_position": {"x": node.global_position.x, "y": node.global_position.y},
\t\t"size": {"x": node.size.x, "y": node.size.y}
\t}
\t_mcp_output("layout", info)
\t_mcp_done()
`;
}

// ─── ui_build_layout (simplified flexbox: row/column/grid + alignment + separation) ──

export function resolveFlexContainer(layout) {
  if (layout.direction === "grid") return { containerType: "GridContainer", isGrid: true };
  const isRow = layout.direction === "row";
  return { containerType: isRow ? "HBoxContainer" : "VBoxContainer", isGrid: false };
}

function validateUiNodeSpec(spec, depth, warnings) {
  if (depth > MAX_NESTING_DEPTH) {
    throw new Error(`Maximum nesting depth is ${MAX_NESTING_DEPTH}, exceeded at node "${spec.name}"`);
  }
  if (!spec.layout && !CONTROL_TYPES.includes(spec.type)) {
    throw new Error(`INVALID_CONTROL_TYPE: "${spec.type}" is not a whitelisted Control type`);
  }
  if (!spec.name) throw new Error("name is required for each UiNodeSpec");
  if (spec.anchor_preset && !(spec.anchor_preset in ANCHOR_PRESETS)) {
    throw new Error(`INVALID_ANCHOR_PRESET: "${spec.anchor_preset}"`);
  }
  if (spec.layout) {
    const l = spec.layout;
    if (!VALID_DIRECTIONS.includes(l.direction)) {
      throw new Error(`INVALID_LAYOUT: direction must be one of: ${VALID_DIRECTIONS.join(", ")}, got "${l.direction}"`);
    }
    if (l.gap !== undefined && (typeof l.gap !== "number" || l.gap < 0 || !Number.isFinite(l.gap))) {
      throw new Error("INVALID_LAYOUT: gap must be a non-negative finite number");
    }
    if (l.alignment !== undefined && !VALID_ALIGNMENTS.includes(l.alignment)) {
      throw new Error(`INVALID_LAYOUT: alignment must be one of: ${VALID_ALIGNMENTS.join(", ")}, got "${l.alignment}"`);
    }
    if (l.columns !== undefined && (!Number.isInteger(l.columns) || l.columns <= 0)) {
      throw new Error("INVALID_LAYOUT: columns must be a positive integer");
    }
    if (l.direction === "grid" && (l.columns === undefined || l.columns <= 0)) {
      warnings.push("Grid layout without columns: GridContainer defaults to 1 column");
    }
    if (l.direction === "grid" && l.alignment) {
      warnings.push("layout.alignment is ignored for grid direction");
    }
  }
  if (spec.children) {
    for (const child of spec.children) validateUiNodeSpec(child, depth + 1, warnings);
  }
}

function genContainerPropLines(layout, indent) {
  let lines = "";
  if (layout.direction === "grid") {
    if (layout.columns !== undefined && layout.columns > 0) {
      lines += `\n${indent}node.columns = ${Math.floor(layout.columns)}`;
    }
    if (layout.gap !== undefined) {
      lines += `\n${indent}node.add_theme_constant_override("h_separation", ${layout.gap})`;
      lines += `\n${indent}node.add_theme_constant_override("v_separation", ${layout.gap})`;
    }
    return lines;
  }
  if (layout.alignment) {
    const alignMap = { begin: 0, center: 1, end: 2 };
    lines += `\n${indent}node.alignment = ${alignMap[layout.alignment]}`;
  }
  if (layout.gap !== undefined) {
    lines += `\n${indent}node.add_theme_constant_override("separation", ${layout.gap})`;
  }
  return lines;
}

function uiNodeToGd(spec, parentVar, ownerVar, indent, warnings, nextId) {
  const isLayout = !!spec.layout;
  const type = isLayout ? resolveFlexContainer(spec.layout).containerType : spec.type;
  const anchorLine = `\n${indent}node.set_anchors_preset(${spec.anchor_preset ? ANCHOR_PRESETS[spec.anchor_preset] : isLayout ? 15 : ANCHOR_PRESETS.top_left})`;

  let propLines = "";
  if (spec.properties && Object.keys(spec.properties).length > 0) {
    const safeEntries = Object.entries(spec.properties).filter(([k]) => {
      if (BLOCKED_PROPS.has(k)) {
        warnings.push(`properties.${k} is blocked (BLOCKED_PROPS security policy) — dropped`);
        return false;
      }
      return true;
    });
    if (safeEntries.length > 0) {
      propLines = "\n" + safeEntries.map(([k, v]) => `${indent}node.set("${gdEscape(k)}", ${valueToGd(v)})`).join("\n");
    }
  }

  let lines = `${indent}node = ClassDB.instantiate("${gdEscape(type)}")
${indent}if node == null:
${indent}\t_mcp_output("error", "Failed to instantiate: ${gdEscape(type)}")
${indent}\t_mcp_done()
${indent}\treturn
${indent}node.name = "${gdEscape(spec.name)}"${anchorLine}${propLines}`;

  if (isLayout) lines += genContainerPropLines(spec.layout, indent);

  if (spec.children && spec.children.length > 0) {
    const savedVar = `_saved_${nextId()}`;
    lines += `\n${indent}var ${savedVar} = node`;
    for (const child of spec.children) {
      lines += "\n" + uiNodeToGd(child, savedVar, ownerVar, indent, warnings, nextId);
    }
    lines += `\n${indent}node = ${savedVar}`;
  }

  lines += `\n${indent}${parentVar}.add_child(node)
${indent}node.owner = ${ownerVar}`;

  return lines;
}

export function genUiBuildLayoutScript(scenePath, parentPath, tree) {
  const warnings = [];
  validateUiNodeSpec(tree, 1, warnings);

  let idCounter = 0;
  const nextId = () => idCounter++;
  const buildBlock = uiNodeToGd(tree, "parent", "root", "\t", warnings, nextId);

  const warningLines = warnings.length > 0
    ? `\n\t_mcp_output("warnings", ${JSON.stringify(warnings)})`
    : "";

  const rootType = tree.layout ? resolveFlexContainer(tree.layout).containerType : tree.type;

  return `${SCENE_TREE_HEADER}
func _initialize():
\tif not _mcp_load_scene("${gdEscape(scenePath)}"):
\t\t_mcp_done()
\t\treturn
\tvar root = _mcp_get_scene_node("${gdEscape(parentPath)}")
\tif root == null:
\t\t_mcp_output("error", "Parent not found: ${gdEscape(parentPath)}")
\t\t_mcp_done()
\t\treturn
\tvar parent = root
\tvar node: Node
${buildBlock}${warningLines}
\t_mcp_output("layout_built", {"parent": "${gdEscape(parentPath)}", "root_type": "${gdEscape(rootType)}", "root_name": "${gdEscape(tree.name)}"})
\t_mcp_done()
`;
}

// ─── Theme generators ────────────────────────────────────────────────────────

export function genUiSetThemeScript(scenePath, nodePath, action, themePath, params) {
  let actionBlock;

  switch (action) {
    case "create":
      actionBlock = `
\tvar theme = Theme.new()
\tnode.theme = theme`;
      break;
    case "set_params": {
      const paramLines = [];
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          if (value === null || value === undefined) paramLines.push(`\ttheme.set("${gdEscape(key)}", null)`);
          else if (typeof value === "number") paramLines.push(`\ttheme.set("${gdEscape(key)}", ${value})`);
          else if (typeof value === "boolean") paramLines.push(`\ttheme.set("${gdEscape(key)}", ${String(value)})`);
          else if (typeof value === "string") paramLines.push(`\ttheme.set("${gdEscape(key)}", "${gdEscape(value)}")`);
          else if (Array.isArray(value) && value.length === 4) paramLines.push(`\ttheme.set("${gdEscape(key)}", Color(${value[0]}, ${value[1]}, ${value[2]}, ${value[3]}))`);
        }
      }
      actionBlock = `
\tvar theme = node.theme
\tif theme == null:
\t\t_mcp_output("error", "Node has no theme assigned")
\t\t_mcp_done()
\t\treturn${paramLines.length > 0 ? "\n" + paramLines.join("\n") : ""}`;
      break;
    }
    case "save":
      if (!themePath) throw new Error("theme_path is required for save action");
      actionBlock = `
\tvar theme = node.theme
\tif theme == null:
\t\t_mcp_output("error", "Node has no theme to save")
\t\t_mcp_done()
\t\treturn
\tvar dir = "${gdEscape(themePath)}".get_base_dir()
\tif not DirAccess.dir_exists_absolute(dir):
\t\tDirAccess.make_dir_recursive_absolute(dir)
\tvar err = ResourceSaver.save(theme, "${gdEscape(themePath)}")
\tif err != OK:
\t\t_mcp_output("error", "Failed to save theme: " + str(err))
\t\t_mcp_done()
\t\treturn`;
      break;
    case "load":
      if (!themePath) throw new Error("theme_path is required for load action");
      actionBlock = `
\tvar res = load("${gdEscape(themePath)}")
\tif res == null:
\t\t_mcp_output("error", "Failed to load theme from: ${gdEscape(themePath)}")
\t\t_mcp_done()
\t\treturn
\tnode.theme = res`;
      break;
    default:
      throw new Error(`Unknown theme action: ${action}`);
  }

  const outputKey = action === "save" ? "saved" : action === "load" ? "loaded" : "theme_set";
  const outputValue = (action === "save" || action === "load")
    ? `{"resource_path": "${gdEscape(themePath || "")}"}`
    : `{"node": "${gdEscape(nodePath)}", "action": "${action}"}`;

  return `${SCENE_TREE_HEADER}
func _initialize():
\tif not _mcp_load_scene("${gdEscape(scenePath)}"):
\t\t_mcp_done()
\t\treturn
\tvar node = _mcp_get_scene_node("${gdEscape(nodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(nodePath)}")
\t\t_mcp_done()
\t\treturn
\tif not node is Control:
\t\t_mcp_output("error", "Node is not a Control: " + node.get_class())
\t\t_mcp_done()
\t\treturn${actionBlock}
\t_mcp_output("${outputKey}", ${outputValue})
\t_mcp_done()
`;
}

export function genThemeCreateScript(scenePath, action, sourceNodePath, savePath) {
  let actionBlock;

  if (action === "create") {
    actionBlock = `
\tvar theme = Theme.new()`;
  } else {
    if (!sourceNodePath) throw new Error("source_node_path is required for extract action");
    actionBlock = `
\tvar source = _mcp_get_scene_node("${gdEscape(sourceNodePath)}")
\tif source == null:
\t\t_mcp_output("error", "Source node not found: ${gdEscape(sourceNodePath)}")
\t\t_mcp_done()
\t\treturn
\tif not source is Control:
\t\t_mcp_output("error", "Source node is not a Control: " + source.get_class())
\t\t_mcp_done()
\t\treturn
\tvar theme = source.theme
\tif theme == null:
\t\t_mcp_output("error", "Source node has no theme")
\t\t_mcp_done()
\t\treturn`;
  }

  let saveBlock = "";
  if (savePath) {
    saveBlock = `
\tvar dir = "${gdEscape(savePath)}".get_base_dir()
\tif not DirAccess.dir_exists_absolute(dir):
\t\tDirAccess.make_dir_recursive_absolute(dir)
\tvar err = ResourceSaver.save(theme, "${gdEscape(savePath)}")
\tif err != OK:
\t\t_mcp_output("error", "Failed to save theme: " + str(err))
\t\t_mcp_done()
\t\treturn
\t_mcp_output("saved", {"resource_path": "${gdEscape(savePath)}"})
\t_mcp_done()
\treturn`;
  }

  return `${SCENE_TREE_HEADER}
func _initialize():
\tif not _mcp_load_scene("${gdEscape(scenePath)}"):
\t\t_mcp_done()
\t\treturn${actionBlock}${saveBlock}
\t_mcp_output("theme_created", {"action": "${action}"})
\t_mcp_done()
`;
}

export function genThemeSetPropertyScript(themeNodePath, itemType, name, value, themeType, scenePath) {
  const sceneLine = scenePath
    ? `\tif not _mcp_load_scene("${gdEscape(scenePath)}"):\n\t\t_mcp_done()\n\t\treturn\n`
    : "";

  let setLine = "";
  const tt = themeType ? `"${gdEscape(themeType)}"` : '""';
  const safeName = gdEscape(name);

  switch (itemType) {
    case "default_font": {
      const fontPath = sanitizeResPath(String(value), "font_path");
      setLine = `\ttheme.set_default_font(load("${gdEscape(fontPath)}"))`;
      break;
    }
    case "color": {
      let c = value;
      if (typeof c === "string") { try { c = JSON.parse(c); } catch { /* fall through */ } }
      if (!Array.isArray(c) || c.length < 3) throw new Error("Color value must be array [r, g, b] or [r, g, b, a]");
      const a = c.length >= 4 ? c[3] : 1.0;
      const nums = [c[0], c[1], c[2], a].map(Number);
      if (nums.some((n) => !Number.isFinite(n))) throw new Error("Color array elements must be finite numbers");
      setLine = `\ttheme.set_color("${safeName}", ${tt}, Color(${nums[0]}, ${nums[1]}, ${nums[2]}, ${nums[3]}))`;
      break;
    }
    case "constant": {
      const constNum = Number(value);
      if (!Number.isFinite(constNum)) throw new Error("constant value must be a finite number");
      setLine = `\ttheme.set_constant("${safeName}", ${tt}, ${constNum})`;
      break;
    }
    case "stylebox": {
      const sbPath = sanitizeResPath(String(value), "stylebox_path");
      setLine = `\ttheme.set_stylebox("${safeName}", ${tt}, load("${gdEscape(sbPath)}"))`;
      break;
    }
    default:
      throw new Error(`Unknown item_type: ${itemType}`);
  }

  return `${SCENE_TREE_HEADER}
func _initialize():
${sceneLine}\tvar node = _mcp_get_scene_node("${gdEscape(themeNodePath)}")
\tif node == null:
\t\t_mcp_output("error", "Node not found: ${gdEscape(themeNodePath)}")
\t\t_mcp_done()
\t\treturn
\tvar theme = node.theme
\tif theme == null:
\t\t_mcp_output("error", "Node has no theme assigned")
\t\t_mcp_done()
\t\treturn
\tif not theme is Theme:
\t\t_mcp_output("error", "Node.theme is not a Theme")
\t\t_mcp_done()
\t\treturn
${setLine}
\t_mcp_output("property_set", {"node": "${gdEscape(themeNodePath)}", "item_type": "${itemType}", "name": "${safeName}"})
\t_mcp_done()
`;
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const CONTROL_TYPE_PROP = { type: "string", enum: CONTROL_TYPES, description: "Control subclass type" };

export const tools = [
  {
    name: "ui_create_control",
    description: `Create a Control-derived node in a scene (type whitelisted to Control subclasses).${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        node_type: CONTROL_TYPE_PROP,
        node_name: { type: "string", description: "Name for the new node" },
        parent_node_path: { type: "string", description: "Parent node path (default: root)", default: "root" },
        properties: { type: "object", description: "Optional properties (string/number/bool/null)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path", "node_type", "node_name"],
    },
  },
  {
    name: "ui_build_layout",
    description: `Build a declarative UI tree in a scene. Supports Control nodes plus simplified flexbox layouts: direction row/column/grid mapped to HBox/VBox/GridContainer with alignment and separation (gap). NOTE: upstream's full flexbox model (wrap/reverse/justify/align-self/flex grow) is deferred — only row/column/grid + alignment + separation is ported.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        parent_path: { type: "string", description: "Parent node path (default: root)", default: "root" },
        tree: {
          type: "object",
          description: "UI node tree (max depth 10). Node: {type, name, properties?, anchor_preset?, children?} or layout node: {name, layout: {direction: row|column|grid, alignment?: begin|center|end, gap?: number, columns?: number}, children?}",
          properties: {
            type: { type: "string" },
            name: { type: "string" },
            properties: { type: "object" },
            anchor_preset: { type: "string", enum: Object.keys(ANCHOR_PRESETS) },
            layout: {
              type: "object",
              properties: {
                direction: { type: "string", enum: VALID_DIRECTIONS },
                alignment: { type: "string", enum: VALID_ALIGNMENTS },
                gap: { type: "number" },
                columns: { type: "number" },
              },
              required: ["direction"],
            },
            children: { type: "array", items: { type: "object" } },
          },
          required: ["name"],
        },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path", "tree"],
    },
  },
  {
    name: "ui_set_layout",
    description: `Set anchors/offsets/min-size/grow-direction on a Control node.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        node_path: { type: "string", description: "Control node path" },
        anchors: { type: "object", description: "Anchors {left, right, top, bottom}, values 0-1", properties: { left: { type: "number" }, right: { type: "number" }, top: { type: "number" }, bottom: { type: "number" } } },
        offsets: { type: "object", description: "Offsets {left, right, top, bottom} in pixels", properties: { left: { type: "number" }, right: { type: "number" }, top: { type: "number" }, bottom: { type: "number" } } },
        min_size: { type: "object", description: "Min size {x, y}", properties: { x: { type: "number" }, y: { type: "number" } } },
        custom_minimum_size: { type: "object", description: "Custom minimum size {x, y}", properties: { x: { type: "number" }, y: { type: "number" } } },
        grow_direction: { type: "string", enum: ["both", "up", "down", "left", "right"], description: "Grow direction" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path", "node_path"],
    },
  },
  {
    name: "ui_get_layout",
    description: "Read anchor/offset/position/size info from a Control node.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        node_path: { type: "string", description: "Control node path" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path", "node_path"],
    },
  },
  {
    name: "ui_anchor_preset",
    description: `Apply one of the 16 anchor presets to a Control node.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        node_path: { type: "string", description: "Control node path" },
        preset: { type: "string", enum: Object.keys(ANCHOR_PRESETS), description: "Anchor preset name (16 presets)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path", "node_path", "preset"],
    },
  },
  {
    name: "ui_set_theme",
    description: `Manage a Control node's Theme: set_params (set values on existing theme), create (new empty Theme), save (to .tres), load (from .tres).${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        node_path: { type: "string", description: "Control node path" },
        theme_action: { type: "string", enum: ["set_params", "create", "save", "load"], description: "Theme operation" },
        theme_path: { type: "string", description: "res:// theme resource path (save/load)" },
        params: { type: "object", description: "set_params: key/value pairs (number/bool/string/[r,g,b,a])" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path", "node_path", "theme_action"],
    },
  },
  {
    name: "ui_container_add",
    description: `Add a Control child to a container node in a scene.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        node_path: { type: "string", description: "Container node path" },
        child_type: { ...CONTROL_TYPE_PROP, description: "Child Control type" },
        child_name: { type: "string", description: "Child node name" },
        child_properties: { type: "object", description: "Child properties" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path", "node_path", "child_type", "child_name"],
    },
  },
  {
    name: "theme_create",
    description: `Create a new Theme (empty) or extract one from a Control node, optionally saving to a .tres resource.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project" },
        theme_create_action: { type: "string", enum: ["create", "extract"], description: "create empty Theme | extract from node" },
        source_node_path: { type: "string", description: "extract: source Control node path" },
        save_path: { type: "string", description: "Optional res:// save path (.tres)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "scene_path", "theme_create_action"],
    },
  },
  {
    name: "theme_set_property",
    description: `Set a theme item (default_font/color/constant/stylebox) on a Control node's Theme.${NON_PERSIST}`,
    inputSchema: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "Path to the Godot project directory" },
        scene_path: { type: "string", description: "Scene file path relative to project (optional)" },
        theme_node_path: { type: "string", description: "Node path owning the Theme" },
        item_type: { type: "string", enum: ["default_font", "color", "constant", "stylebox"], description: "Theme item type" },
        prop_name: { type: "string", description: "Item name" },
        theme_type: { type: "string", description: "Theme type name (optional)" },
        value: { description: "Item value (res:// path for default_font/stylebox, [r,g,b,a] for color, number for constant)" },
        godot_path: { type: "string", description: "Optional explicit path to the Godot binary" },
      },
      required: ["project_path", "theme_node_path", "item_type", "prop_name", "value"],
    },
  },
];

// ─── Handler ─────────────────────────────────────────────────────────────────

async function runScript(script, args, ctx) {
  const projectPath = requireProjectPath(args);
  const godot = await resolveGodotPath(args.godot_path ?? ctx.godotPath);
  const result = await executeGdscript({ godotPath: godot, projectPath, code: script, timeout: 30, trusted: true });
  return parseGdscriptResult(result, {
    mapError: (msg) => {
      if (msg.includes("not found")) return "NODE_NOT_FOUND";
      if (msg.includes("not a Control")) return "INVALID_PARAMS";
      if (msg.includes("no theme") || msg.includes("not a Theme")) return "THEME_NOT_FOUND";
      return "SCRIPT_EXEC_FAILED";
    },
  });
}

function resolveScene(projectPath, scenePathRaw) {
  if (typeof scenePathRaw !== "string" || scenePathRaw.trim() === "") {
    throw new Error("scene_path is required");
  }
  const rel = normalizeUserProjectPath(scenePathRaw);
  resolveWithinRoot(projectPath, rel);
  return rel;
}

export async function handle(toolName, args, ctx) {
  try {
    const projectPath = requireProjectPath(args);
    switch (toolName) {
      case "ui_create_control": {
        const scenePath = resolveScene(projectPath, args.scene_path);
        const nodeType = String(args.node_type ?? "");
        if (!CONTROL_TYPES.includes(nodeType)) {
          return opsErrorResult("INVALID_CONTROL_TYPE", `Invalid node_type "${nodeType}". Must be one of: ${CONTROL_TYPES.join(", ")}`);
        }
        const nodeName = String(args.node_name ?? "");
        if (!nodeName) return opsErrorResult("INVALID_PARAMS", "node_name is required");
        const parentPath = normalizeNodePath(args.parent_node_path || "root");
        const blocked = findBlockedProps(args.properties);
        if (blocked.length) {
          return opsErrorResult("INVALID_PARAMS", `Property key(s) blocked (security policy): ${blocked.join(", ")}`);
        }
        return runScript(genUiCreateControlScript(scenePath, nodeType, nodeName, parentPath, args.properties), args, ctx);
      }
      case "ui_build_layout": {
        const scenePath = resolveScene(projectPath, args.scene_path);
        const parentPath = normalizeNodePath(args.parent_path || "root");
        const tree = args.tree;
        if (!tree || typeof tree !== "object") {
          return opsErrorResult("INVALID_PARAMS", "tree is required and must be an object");
        }
        let script;
        try {
          script = genUiBuildLayoutScript(scenePath, parentPath, tree);
        } catch (err) {
          const msg = err.message;
          if (msg.includes("INVALID_CONTROL_TYPE")) return opsErrorResult("INVALID_CONTROL_TYPE", msg);
          if (msg.includes("INVALID_ANCHOR_PRESET")) return opsErrorResult("INVALID_ANCHOR_PRESET", msg);
          if (msg.includes("INVALID_LAYOUT")) return opsErrorResult("INVALID_LAYOUT", msg);
          return opsErrorResult("INVALID_PARAMS", msg);
        }
        return runScript(script, args, ctx);
      }
      case "ui_set_layout": {
        const scenePath = resolveScene(projectPath, args.scene_path);
        const nodePath = normalizeNodePath(args.node_path);
        return runScript(genUiSetLayoutScript(scenePath, nodePath, args.anchors, args.offsets, args.min_size, args.custom_minimum_size, args.grow_direction), args, ctx);
      }
      case "ui_get_layout": {
        const scenePath = resolveScene(projectPath, args.scene_path);
        const nodePath = normalizeNodePath(args.node_path);
        return runScript(genUiGetLayoutScript(scenePath, nodePath), args, ctx);
      }
      case "ui_anchor_preset": {
        const scenePath = resolveScene(projectPath, args.scene_path);
        const nodePath = normalizeNodePath(args.node_path);
        const presetName = String(args.preset ?? "");
        if (!(presetName in ANCHOR_PRESETS)) {
          return opsErrorResult("INVALID_ANCHOR_PRESET", `Invalid preset "${presetName}". Must be one of: ${Object.keys(ANCHOR_PRESETS).join(", ")}`);
        }
        return runScript(genUiAnchorPresetScript(scenePath, nodePath, ANCHOR_PRESETS[presetName], presetName), args, ctx);
      }
      case "ui_set_theme": {
        const scenePath = resolveScene(projectPath, args.scene_path);
        const nodePath = normalizeNodePath(args.node_path);
        const themeAction = String(args.theme_action ?? "");
        if (!["set_params", "create", "save", "load"].includes(themeAction)) {
          return opsErrorResult("INVALID_PARAMS", `Invalid theme_action "${themeAction}". Must be one of: set_params, create, save, load`);
        }
        const themePath = args.theme_path;
        if ((themeAction === "save" || themeAction === "load") && !themePath) {
          return opsErrorResult("INVALID_PARAMS", `theme_path is required for ${themeAction} action`);
        }
        if (themePath) {
          try { sanitizeResPath(themePath, "theme_path"); } catch {
            return opsErrorResult("INVALID_PARAMS", "theme_path must be a res:// path without traversal");
          }
        }
        return runScript(genUiSetThemeScript(scenePath, nodePath, themeAction, themePath, args.params), args, ctx);
      }
      case "ui_container_add": {
        const scenePath = resolveScene(projectPath, args.scene_path);
        const nodePath = normalizeNodePath(args.node_path);
        const childType = String(args.child_type ?? "");
        if (!CONTROL_TYPES.includes(childType)) {
          return opsErrorResult("INVALID_CONTROL_TYPE", `Invalid child_type "${childType}". Must be one of: ${CONTROL_TYPES.join(", ")}`);
        }
        const childName = String(args.child_name ?? "");
        if (!childName) return opsErrorResult("INVALID_PARAMS", "child_name is required");
        const blocked = findBlockedProps(args.child_properties);
        if (blocked.length) {
          return opsErrorResult("INVALID_PARAMS", `Child property key(s) blocked (security policy): ${blocked.join(", ")}`);
        }
        return runScript(genUiContainerAddScript(scenePath, nodePath, childType, childName, args.child_properties), args, ctx);
      }
      case "theme_create": {
        const themeCreateAction = String(args.theme_create_action ?? "");
        if (!["create", "extract"].includes(themeCreateAction)) {
          return opsErrorResult("INVALID_PARAMS", `Invalid theme_create_action "${themeCreateAction}". Must be one of: create, extract`);
        }
        const savePath = args.save_path;
        if (savePath) {
          try { sanitizeResPath(savePath, "save_path"); } catch {
            return opsErrorResult("INVALID_PARAMS", "save_path must be a res:// path without traversal");
          }
        }
        if (themeCreateAction === "extract" && !args.source_node_path) {
          return opsErrorResult("INVALID_PARAMS", "source_node_path is required for extract action");
        }
        const scenePath = resolveScene(projectPath, args.scene_path);
        const sourcePath = args.source_node_path ? normalizeNodePath(args.source_node_path) : undefined;
        return runScript(genThemeCreateScript(scenePath, themeCreateAction, sourcePath, savePath), args, ctx);
      }
      case "theme_set_property": {
        const themeNodePath = normalizeNodePath(args.theme_node_path);
        const itemType = String(args.item_type ?? "");
        if (!["default_font", "color", "constant", "stylebox"].includes(itemType)) {
          return opsErrorResult("INVALID_THEME_ITEM_TYPE", `Invalid item_type "${itemType}". Must be one of: default_font, color, constant, stylebox`);
        }
        const propName = args.prop_name;
        if (!propName) return opsErrorResult("INVALID_THEME_PROPERTY", "prop_name is required");
        if (args.value === undefined || args.value === null) {
          return opsErrorResult("INVALID_THEME_PROPERTY", "value is required");
        }
        const scenePath = args.scene_path ? resolveScene(projectPath, args.scene_path) : undefined;
        let script;
        try {
          script = genThemeSetPropertyScript(themeNodePath, itemType, String(propName), args.value, args.theme_type, scenePath);
        } catch (err) {
          return opsErrorResult("INVALID_THEME_PROPERTY", err.message);
        }
        return runScript(script, args, ctx);
      }
      default:
        return opsErrorResult("UNKNOWN_TOOL", `No handler for tool: ${toolName}`);
    }
  } catch (err) {
    const msg = err.message;
    if (msg.includes("project_path") || msg.includes("project.godot") || msg.includes("traversal")) return opsErrorResult("INVALID_PATH", msg);
    return opsErrorResult("INVALID_PARAMS", msg);
  }
}
