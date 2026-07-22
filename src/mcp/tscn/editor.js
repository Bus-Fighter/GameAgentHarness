import { BLOCKED_PROPS } from "../util.js";

export function normalizeLines(content) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function findSectionEnd(lines, startLine) {
  for (let i = startLine + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith("[")) return i;
  }
  return lines.length;
}

export function escapeTscnAttr(value) {
  if (!value) return "";
  if (/[\r\n]/.test(value)) throw new Error("Attribute value must not contain newlines");
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\]/g, "\\]").replace(/\[/g, "\\[").replace(/\$/g, () => "$$");
}

export function escapeTscnValue(value) {
  if (/[\r\n]/.test(value)) throw new Error("Value must not contain newlines");
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\]/g, "\\]").replace(/\[/g, "\\[");
}

const GODOT_LITERAL_RE = /^(true|false|null|-?\d+(\.\d+)?(e[+-]?\d+)?|0x[0-9a-fA-F]+|ExtResource\([^)]*\)|SubResource\([^)]*\)|NodePath\([^)]*\)|Vector2i?\([^)]*\)|Vector3i?\([^)]*\)|Vector4i?\([^)]*\)|AABB\([^)]*\)|Color\([^)]*\)|Plane\([^)]*\)|Projection\([^)]*\)|Rect2i?\([^)]*\)|Transform2D\([^)]*\)|Transform3D\([^)]*\)|Basis\([^)]*\)|Quaternion\([^)]*\)|Callable\([^)]*\)|Signal\([^)]*\)|StringName\([^)]*\)|Packed\w*Array\([^)]*\)|Array\([^)]*\)|Dictionary\([^)]*\)|RID\([^)]*\)|Object\([^)]*\)|Resource\([^)]*\)|Variant\([^)]*\)|&"[^"]*")$/;

export function formatTscnValue(value) {
  const trimmed = value.trim();
  if (GODOT_LITERAL_RE.test(trimmed)) {
    if (/[\r\n]/.test(value)) throw new Error("Value must not contain newlines");
    return trimmed;
  }
  return `"${escapeTscnValue(value)}"`;
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getBracketAttr(header, attr) {
  const safeAttr = escapeRegExp(attr);
  const re = new RegExp(`(?:^|\\s)${safeAttr}="([^"]*)"`);
  const m = header.match(re);
  return m ? m[1] : null;
}

export function leafName(nodePath) {
  const parts = nodePath.split("/");
  return parts[parts.length - 1];
}

export function parentPath(nodePath) {
  const parts = nodePath.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

export function findNodeSectionLine(lines, nodePath) {
  const targetName = leafName(nodePath);
  const targetParent = parentPath(nodePath);

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith("[node")) continue;

    const name = getBracketAttr(trimmed, "name");
    if (name !== targetName) continue;

    if (!targetParent) {
      const p = getBracketAttr(trimmed, "parent");
      if (p === null || p === "" || p === ".") return i;
      continue;
    }

    const inlineParent = getBracketAttr(trimmed, "parent");
    if (inlineParent === targetParent) return i;

    const end = findSectionEnd(lines, i);
    for (let j = i + 1; j < end; j += 1) {
      const propLine = lines[j].trim();
      if (propLine.startsWith("parent = ") || propLine.startsWith("parent=")) {
        const val = propLine.replace(/^parent\s*=\s*/, "").replace(/"/g, "").trim();
        if (val === targetParent) return i;
      }
    }
  }
  return -1;
}

export function nodeSectionEnd(lines, nodeLine) {
  return findSectionEnd(lines, nodeLine) - 1;
}

export function canSerializeProperty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((v) =>
      v === null || v === undefined ||
      typeof v === "string" || typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v)));
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) {
      if (typeof v === "object" && v !== null) return false;
      if (typeof v === "number" && !Number.isFinite(v)) return false;
    }
    return true;
  }
  return false;
}

function fmtNum(v, fallback) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function formatPropertyValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return formatTscnValue(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => formatPropertyValue(v)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const obj = value;
    const keys = Object.keys(obj);
    if (obj._type && typeof obj._type === "string") {
      const t = obj._type;
      if (t === "Rect2" || t === "Rect2i") {
        return `${t}(${fmtNum(obj.x, 0)}, ${fmtNum(obj.y, 0)}, ${fmtNum(obj.w, 0)}, ${fmtNum(obj.h, 0)})`;
      }
      if (t === "Vector2" || t === "Vector2i" || t === "Vector3" || t === "Vector3i") {
        const args = t.startsWith("Vector3") ? [obj.x, obj.y, obj.z] : [obj.x, obj.y];
        return `${t}(${args.map((a) => fmtNum(a, 0)).join(", ")})`;
      }
      if (t === "Color") {
        return `Color(${fmtNum(obj.r, 1)}, ${fmtNum(obj.g, 1)}, ${fmtNum(obj.b, 1)}, ${fmtNum(obj.a, 1)})`;
      }
    }
    if (keys.includes("r") && keys.includes("g") && keys.includes("b")
      && typeof obj.r === "number" && typeof obj.g === "number" && typeof obj.b === "number") {
      const a = typeof obj.a === "number" && Number.isFinite(obj.a) ? obj.a : 1;
      return `Color(${fmtNum(obj.r, 0)}, ${fmtNum(obj.g, 0)}, ${fmtNum(obj.b, 0)}, ${a})`;
    }
    if (keys.includes("x") && keys.includes("y") && keys.includes("w") && keys.includes("h")) {
      return `Rect2(${fmtNum(obj.x, 0)}, ${fmtNum(obj.y, 0)}, ${fmtNum(obj.w, 0)}, ${fmtNum(obj.h, 0)})`;
    }
    if (keys.includes("x") && keys.includes("y") && keys.includes("z")
      && typeof obj.x === "number" && typeof obj.y === "number" && typeof obj.z === "number") {
      return `Vector3(${fmtNum(obj.x, 0)}, ${fmtNum(obj.y, 0)}, ${fmtNum(obj.z, 0)})`;
    }
    if (keys.includes("x") && keys.includes("y")
      && typeof obj.x === "number" && typeof obj.y === "number") {
      return `Vector2(${fmtNum(obj.x, 0)}, ${fmtNum(obj.y, 0)})`;
    }
    const { _type: _ignored, ...sanitized } = obj;
    void _ignored;
    return formatTscnValue(JSON.stringify(sanitized));
  }
  return formatTscnValue(String(value));
}

function findNodeByName(lines, nodeName) {
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith("[node")) continue;
    if (getBracketAttr(trimmed, "name") === nodeName) return i;
  }
  return -1;
}

function findLastDescendantLine(lines, parentNodeLine, tscnParent) {
  let lastDescendantEnd = nodeSectionEnd(lines, parentNodeLine);

  for (let i = parentNodeLine + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith("[node")) continue;

    let effectiveParent = getBracketAttr(trimmed, "parent");
    if (effectiveParent === null) {
      const end = findSectionEnd(lines, i);
      for (let j = i + 1; j < end; j += 1) {
        const pl = lines[j].trim();
        if (pl.startsWith("parent = ") || pl.startsWith("parent=")) {
          effectiveParent = pl.replace(/^parent\s*=\s*/, "").replace(/"/g, "").trim();
          break;
        }
      }
    }

    const isDescendant = effectiveParent === tscnParent ||
      (effectiveParent !== null && effectiveParent.startsWith(tscnParent + "/"));

    if (isDescendant) {
      lastDescendantEnd = nodeSectionEnd(lines, i);
    } else {
      return lastDescendantEnd;
    }
  }

  return lastDescendantEnd;
}

function incrementLoadSteps(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith("[gd_scene")) continue;
    if (trimmed.includes("load_steps=")) {
      lines[i] = lines[i].replace(/load_steps=-?\d+/, (m) => {
        const n = parseInt(m.split("=")[1], 10);
        return `load_steps=${Math.max(1, n) + 1}`;
      });
    } else {
      lines[i] = lines[i].replace("]", " load_steps=2]");
    }
    return;
  }
}

export function addNode(tscnContent, params) {
  try {
    return addNodeInner(tscnContent, params);
  } catch (err) {
    return { success: false, message: `tscn-editor error: ${err.message}`, fallback: false };
  }
}

function addNodeInner(tscnContent, { parent, name, type, properties }) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    return { success: false, message: `Invalid node name: ${name}`, fallback: false };
  }
  if (!/^[A-Za-z0-9_]+$/.test(type)) {
    return { success: false, message: `Invalid node type: ${type}`, fallback: false };
  }
  if (parent !== "." && !/^[A-Za-z0-9_./]+$/.test(parent)) {
    return { success: false, message: `Invalid parent path: ${parent}`, fallback: false };
  }

  if (properties) {
    for (const value of Object.values(properties)) {
      if (!canSerializeProperty(value)) {
        return { success: true, fallback: true, message: `Unsupported property type for node ${name}, requires Godot process` };
      }
    }
  }

  const lines = normalizeLines(tscnContent);
  const tscnParent = parent;

  let parentNodeLine = -1;
  if (parent === ".") {
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (!trimmed.startsWith("[node")) continue;
      const p = getBracketAttr(trimmed, "parent");
      if (p === null || p === "" || p === ".") {
        parentNodeLine = i;
        break;
      }
    }
  } else if (parent.includes("/")) {
    parentNodeLine = findNodeSectionLine(lines, parent);
  } else {
    parentNodeLine = findNodeByName(lines, parent);
  }

  if (parentNodeLine === -1) {
    return { success: false, message: `Parent node not found: ${parent}`, fallback: false };
  }

  const insertAfter = findLastDescendantLine(lines, parentNodeLine, tscnParent);

  const nodeLines = [];
  if (tscnParent === ".") {
    nodeLines.push(`[node name="${escapeTscnAttr(name)}" type="${escapeTscnAttr(type)}" parent="."]`);
  } else {
    nodeLines.push(`[node name="${escapeTscnAttr(name)}" type="${escapeTscnAttr(type)}" parent="${escapeTscnAttr(tscnParent)}"]`);
  }

  const blockedProps = [];
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      if (BLOCKED_PROPS.has(key)) {
        blockedProps.push(key);
        continue;
      }
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        return { success: false, message: `Invalid property name: ${key}`, fallback: false };
      }
      nodeLines.push(`${key} = ${formatPropertyValue(value)}`);
    }
  }

  nodeLines.unshift("");
  lines.splice(insertAfter + 1, 0, ...nodeLines);
  incrementLoadSteps(lines);

  return {
    success: true,
    fallback: false,
    message: `Added node ${name} (type=${type}) as child of ${parent}`,
    scene: lines.join("\n"),
    blockedProps: blockedProps.length > 0 ? blockedProps : undefined,
  };
}

export function addNodes(tscnContent, nodes) {
  try {
    if (nodes.length === 0) {
      return { success: true, fallback: false, scene: tscnContent, message: "No nodes to add" };
    }
    for (const node of nodes) {
      if (node.properties) {
        for (const value of Object.values(node.properties)) {
          if (!canSerializeProperty(value)) {
            return { success: true, fallback: true, message: `Unsupported property type in node ${node.name}, requires Godot process` };
          }
        }
      }
    }
    let content = tscnContent;
    const allBlocked = [];
    for (const node of nodes) {
      const result = addNode(content, node);
      if (!result.success) return result;
      if (result.scene) content = result.scene;
      if (result.blockedProps) allBlocked.push(...result.blockedProps);
    }
    return {
      success: true,
      fallback: false,
      message: `Added ${nodes.length} node(s)`,
      scene: content,
      blockedProps: allBlocked.length > 0 ? allBlocked : undefined,
    };
  } catch (err) {
    return { success: false, message: `tscn-editor error: ${err.message}`, fallback: false };
  }
}

export function removeNode(tscnContent, nodePath) {
  try {
    const lines = normalizeLines(tscnContent);
    const nodeLine = findNodeSectionLine(lines, nodePath);
    if (nodeLine === -1) {
      return { success: false, message: `Node not found: ${nodePath}` };
    }

    const targetName = leafName(nodePath);
    const targetParent = parentPath(nodePath);
    const tscnPathOf = targetParent ? `${targetParent}/${targetName}` : targetName;

    const end = nodeSectionEnd(lines, nodeLine);
    let removeEnd = end;

    for (let i = end + 1; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (!trimmed.startsWith("[node")) break;
      let effectiveParent = getBracketAttr(trimmed, "parent");
      if (effectiveParent === null) continue;
      if (effectiveParent === tscnPathOf || effectiveParent.startsWith(tscnPathOf + "/")) {
        removeEnd = nodeSectionEnd(lines, i);
      } else {
        break;
      }
    }

    let start = nodeLine;
    while (start > 0 && lines[start - 1].trim() === "") {
      start -= 1;
    }

    lines.splice(start, removeEnd - start + 1);
    return { success: true, message: `Removed node ${nodePath}`, scene: lines.join("\n") };
  } catch (err) {
    return { success: false, message: `tscn-editor error: ${err.message}` };
  }
}

export function editNodeProperties(tscnContent, nodePath, properties) {
  try {
    const lines = normalizeLines(tscnContent);
    const nodeLine = findNodeSectionLine(lines, nodePath);
    if (nodeLine === -1) {
      return { success: false, message: `Node not found: ${nodePath}` };
    }

    const end = nodeSectionEnd(lines, nodeLine);
    const existing = new Map();
    for (let i = nodeLine + 1; i <= end; i += 1) {
      const trimmed = lines[i].trim();
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        existing.set(trimmed.slice(0, eqIdx).trim(), i);
      }
    }

    const blockedProps = [];
    for (const [key, value] of Object.entries(properties)) {
      if (BLOCKED_PROPS.has(key)) {
        blockedProps.push(key);
        continue;
      }
      if (!/^[a-zA-Z_][a-zA-Z0-9_/]*$/.test(key)) {
        return { success: false, message: `Invalid property name: ${key}` };
      }
      const line = `${key} = ${formatPropertyValue(value)}`;
      if (existing.has(key)) {
        lines[existing.get(key)] = line;
      } else {
        lines.splice(end + 1, 0, line);
        existing.set(key, end + 1);
      }
    }

    return {
      success: true,
      message: `Edited node ${nodePath} (${Object.keys(properties).length} propert${Object.keys(properties).length === 1 ? "y" : "ies"})`,
      scene: lines.join("\n"),
      blockedProps: blockedProps.length > 0 ? blockedProps : undefined,
    };
  } catch (err) {
    return { success: false, message: `tscn-editor error: ${err.message}` };
  }
}

export function nodePathToNameAndParent(nodePath) {
  const raw = String(nodePath).replace(/^\/+/, "").replace(/^root\/?/, "");
  if (!raw) {
    throw new Error(`Invalid node_path: ${nodePath}`);
  }
  const parts = raw.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) {
    throw new Error(`Invalid node_path: ${nodePath}`);
  }
  const nodeName = parts[parts.length - 1];
  const parent = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
  return { nodeName, parent };
}

export function findInstanceNode(tscnContent, nodeName, tscnParent) {
  const lines = normalizeLines(tscnContent);

  const extResources = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[ext_resource")) continue;
    const id = getBracketAttr(trimmed, "id");
    const type = getBracketAttr(trimmed, "type");
    const resPath = getBracketAttr(trimmed, "path");
    if (id && type === "PackedScene" && resPath) {
      extResources.set(id, resPath);
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith("[node")) continue;
    const name = getBracketAttr(trimmed, "name");
    if (name !== nodeName) continue;
    const parent = getBracketAttr(trimmed, "parent");
    const normalizedParent = parent === null || parent === "" ? "." : parent;
    if (tscnParent !== "." && normalizedParent !== tscnParent) continue;

    const instanceAttr = trimmed.match(/instance=ExtResource\("([^"]+)"\)/);
    if (!instanceAttr) continue;

    const sourcePath = extResources.get(instanceAttr[1]);
    if (!sourcePath) continue;

    const end = nodeSectionEnd(lines, i);
    const propertyOverrides = [];
    for (let j = i + 1; j <= end; j += 1) {
      const propLine = lines[j].trim();
      if (propLine && !propLine.startsWith("[") && propLine.includes("=")) {
        propertyOverrides.push(propLine);
      }
    }

    return { sourcePath, propertyOverrides, lineIndex: i, endIndex: end };
  }

  return null;
}

export function detachInstance(targetContent, sourceContent, nodeName, tscnParent) {
  const info = findInstanceNode(targetContent, nodeName, tscnParent);
  if (!info) {
    throw new Error(`Node "${nodeName}" is not an instance or not found`);
  }

  const targetLines = normalizeLines(targetContent);
  const sourceLines = normalizeLines(sourceContent);

  const sourceNodes = [];
  for (let i = 0; i < sourceLines.length; i += 1) {
    const trimmed = sourceLines[i].trim();
    if (!trimmed.startsWith("[node")) continue;
    const end = findSectionEnd(sourceLines, i);
    sourceNodes.push({
      header: trimmed,
      name: getBracketAttr(trimmed, "name"),
      type: getBracketAttr(trimmed, "type"),
      parent: getBracketAttr(trimmed, "parent"),
      body: sourceLines.slice(i + 1, end).filter((l) => l.trim() !== ""),
    });
  }

  if (sourceNodes.length === 0) {
    throw new Error(`Source scene has no nodes: ${info.sourcePath}`);
  }

  const rootNode = sourceNodes[0];
  const inlinedSections = [];

  const rootHeader = tscnParent === "."
    ? `[node name="${escapeTscnAttr(nodeName)}" type="${escapeTscnAttr(rootNode.type ?? "Node")}" parent="."]`
    : `[node name="${escapeTscnAttr(nodeName)}" type="${escapeTscnAttr(rootNode.type ?? "Node")}" parent="${escapeTscnAttr(tscnParent)}"]`;
  inlinedSections.push([rootHeader, ...info.propertyOverrides].join("\n"));

  const targetRootPrefix = tscnParent === "." ? nodeName : `${tscnParent}/${nodeName}`;
  for (const node of sourceNodes.slice(1)) {
    const srcParent = node.parent === null || node.parent === "" || node.parent === "."
      ? targetRootPrefix
      : `${targetRootPrefix}/${node.parent}`;
    const header = `[node name="${escapeTscnAttr(node.name)}" type="${escapeTscnAttr(node.type ?? "Node")}" parent="${escapeTscnAttr(srcParent)}"]`;
    inlinedSections.push([header, ...node.body].join("\n"));
  }

  let start = info.lineIndex;
  while (start > 0 && targetLines[start - 1].trim() === "") {
    start -= 1;
  }
  targetLines.splice(start, info.endIndex - start + 1, "", inlinedSections.join("\n\n"));

  return targetLines.join("\n");
}
