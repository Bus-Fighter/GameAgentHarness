const MAX_SPLIT_ELEMENTS = 10000;
const MAX_TSCN_INPUT_SIZE = 10 * 1024 * 1024;
const MAX_PARSE_OPERATIONS = 1000000;

function extractBalancedParenContent(input, typeName) {
  const prefix = typeName + "(";
  if (!input.startsWith(prefix) || !input.endsWith(")")) return null;
  let depth = 0;
  for (let i = prefix.length - 1; i < input.length; i += 1) {
    if (input[i] === "(") depth += 1;
    else if (input[i] === ")") depth -= 1;
    if (depth === 0 && i === input.length - 1) {
      return input.slice(prefix.length, i);
    }
  }
  return null;
}

function createBudget() {
  return { opsRemaining: MAX_PARSE_OPERATIONS };
}

function checkParseBudget(budget) {
  budget.opsRemaining -= 1;
  return budget.opsRemaining >= 0;
}

function parseValue(raw, maxDepth, budget) {
  if (!checkParseBudget(budget)) return raw;
  const trimmed = raw.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "None") return null;

  const extMatch = trimmed.match(/^ExtResource\("([^"]+)"\)$/);
  if (extMatch) {
    const rawId = extMatch[1];
    const numericId = Number(rawId);
    return { __type: "ExtResource", id: !isNaN(numericId) && rawId !== "" ? numericId : rawId };
  }

  const subMatch = trimmed.match(/^SubResource\("([^"]+)"\)$/);
  if (subMatch) return { __type: "SubResource", id: subMatch[1] };

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    if (maxDepth <= 0) return trimmed;
    return parseArrayContent(trimmed.slice(1, -1), maxDepth - 1, budget);
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    if (maxDepth <= 0) return trimmed;
    return parseDictContent(trimmed.slice(1, -1), maxDepth - 1, budget);
  }

  const npMatch = trimmed.match(/^NodePath\("(.*)"\)$/);
  if (npMatch) return { __type: "NodePath", value: npMatch[1] };

  for (const typeName of ["Color", "Vector2", "Vector3"]) {
    if (trimmed.startsWith(`${typeName}(`)) {
      const inner = extractBalancedParenContent(trimmed, typeName);
      if (inner !== null) return { __type: typeName, value: inner };
      return trimmed;
    }
  }

  if (trimmed !== "") {
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
  }

  return trimmed;
}

function splitTopLevel(input) {
  const parts = [];
  let depth = 0;
  const currentChars = [];
  let inString = false;

  for (let i = 0; i < input.length; i += 1) {
    if (parts.length >= MAX_SPLIT_ELEMENTS) break;
    const ch = input[i];
    if (inString) {
      currentChars.push(ch);
      if (ch === '"') {
        if (i + 1 < input.length && input[i + 1] === '"') {
          currentChars.push('"');
          i += 1;
        } else {
          inString = false;
        }
      }
    } else if (ch === '"') {
      inString = true;
      currentChars.push(ch);
    } else if (ch === "[" || ch === "{" || ch === "(") {
      depth += 1;
      currentChars.push(ch);
    } else if (ch === "]" || ch === "}" || ch === ")") {
      depth -= 1;
      currentChars.push(ch);
    } else if (ch === "," && depth === 0) {
      parts.push(currentChars.join("").trim());
      currentChars.length = 0;
    } else {
      currentChars.push(ch);
    }
  }
  if (currentChars.length > 0 && parts.length < MAX_SPLIT_ELEMENTS) {
    const tail = currentChars.join("").trim();
    if (tail) parts.push(tail);
  }
  return parts;
}

function parseArrayContent(inner, maxDepth, budget) {
  const trimmed = inner.trim();
  if (!trimmed) return [];
  return splitTopLevel(trimmed).map((el) => parseValue(el, maxDepth, budget));
}

function parseDictContent(inner, maxDepth, budget) {
  const trimmed = inner.trim();
  if (!trimmed) return {};
  const result = {};
  for (const entry of splitTopLevel(trimmed)) {
    const colonIdx = entry.indexOf(":");
    const eqIdx = entry.indexOf("=");
    let key;
    let valRaw;
    if (colonIdx !== -1) {
      key = entry.slice(0, colonIdx).trim();
      valRaw = entry.slice(colonIdx + 1).trim();
    } else if (eqIdx !== -1) {
      key = entry.slice(0, eqIdx).trim();
      valRaw = entry.slice(eqIdx + 1).trim();
    } else {
      continue;
    }
    if (key.startsWith('"') && key.endsWith('"')) {
      key = key.slice(1, -1).replace(/""/g, '"');
    }
    result[key] = parseValue(valRaw, maxDepth, budget);
  }
  return result;
}

function parseTypedValue(raw, budget) {
  const eqIdx = raw.indexOf("=");
  if (eqIdx !== -1) {
    const name = raw.slice(0, eqIdx).trim();
    const rest = raw.slice(eqIdx + 1).trim();
    return { name, type: "unknown", value: parseValue(rest, 20, budget) };
  }

  const colonIdx = raw.indexOf(":");
  if (colonIdx === -1) {
    return { name: raw.trim(), type: "unknown", value: raw.trim() };
  }
  const name = raw.slice(0, colonIdx).trim();
  const rest = raw.slice(colonIdx + 1).trim();
  const typeMatch = rest.match(/^(\w+)\s+(.+)$/s);
  if (typeMatch) {
    return { name, type: typeMatch[1], value: parseValue(typeMatch[2], 20, budget) };
  }
  return { name, type: "unknown", value: parseValue(rest, 20, budget) };
}

function splitLines(content) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function parseTscn(content) {
  const budget = createBudget();
  if (content.length > MAX_TSCN_INPUT_SIZE) {
    throw new Error(`tscn input too large: ${content.length} bytes exceeds ${MAX_TSCN_INPUT_SIZE} byte limit`);
  }
  const lines = splitLines(content);
  const result = {
    header: {},
    extResources: [],
    subResources: [],
    nodes: [],
    connections: [],
    nodeMap: new Map(),
  };

  let currentSection = "header";
  let sawGdSceneHeader = false;
  let currentExt = null;
  let currentSub = null;
  let currentNode = null;
  let currentConnection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";")) continue;

    if (trimmed.startsWith("[gd_scene")) {
      currentSection = "header";
      sawGdSceneHeader = true;
      const headerMatch = trimmed.match(/\[gd_scene\s+([^\]]*)\]/);
      const attrs = headerMatch ? headerMatch[1] : "";
      const pairs = attrs.match(/(\w+)=(?:"([^"]*)"|((?:(?!\s+\w+=).)+))/g);
      if (pairs) {
        for (const pair of pairs) {
          const eqIdx = pair.indexOf("=");
          const key = pair.slice(0, eqIdx);
          const val = pair.slice(eqIdx + 1).replace(/^"|"$/g, "").replace(/""/g, '"');
          const num = Number(val);
          result.header[key] = isNaN(num) || val === "" ? val : num;
        }
      }
      continue;
    }

    if (trimmed.startsWith("[ext_resource")) {
      if (currentExt && currentExt.id !== undefined) {
        result.extResources.push(currentExt);
      }
      currentExt = {};
      currentSection = "ext_resource";
      const attrMatch = trimmed.match(/\[(\w+)\s+(.*)\]/);
      if (attrMatch) {
        const pairs = attrMatch[2].match(/(\w+)=(?:"([^"]*)"|((?:(?!\s+\w+=).)+))/g);
        if (pairs) {
          for (const pair of pairs) {
            const eq = pair.indexOf("=");
            const key = pair.slice(0, eq);
            const val = pair.slice(eq + 1).replace(/^"|"$/g, "").replace(/""/g, '"');
            if (key === "id") {
              const numericId = Number(val);
              currentExt.id = !isNaN(numericId) && val !== "" ? numericId : val;
            } else if (key === "type") currentExt.type = val;
            else if (key === "path") currentExt.path = val;
            else currentExt[key] = val;
          }
        }
      }
      continue;
    }

    if (trimmed.startsWith("[sub_resource")) {
      if (currentSub && currentSub.id !== undefined) {
        result.subResources.push(currentSub);
      }
      currentSub = {};
      currentSection = "sub_resource";
      const attrMatch = trimmed.match(/\[(\w+)\s+(.*)\]/);
      if (attrMatch) {
        const pairs = attrMatch[2].match(/(\w+)=(?:"([^"]*)"|((?:(?!\s+\w+=).)+))/g);
        if (pairs) {
          for (const pair of pairs) {
            const eq = pair.indexOf("=");
            const key = pair.slice(0, eq);
            const val = pair.slice(eq + 1).replace(/^"|"$/g, "").replace(/""/g, '"');
            if (key === "id") currentSub.id = val;
            else if (key === "type") currentSub.type = val;
            else currentSub[key] = val;
          }
        }
      }
      continue;
    }

    if (trimmed.startsWith("[node")) {
      if (currentNode && currentNode.name) {
        result.nodes.push(currentNode);
      }
      currentNode = { name: "", type: "Node", parent: "", properties: [] };
      currentSection = "node";
      const attrMatch = trimmed.match(/\[(\w+)\s+(.*)\]/);
      if (attrMatch) {
        const pairs = attrMatch[2].match(/(\w+)=(?:"([^"]*)"|((?:(?!\s+\w+=).)+))/g);
        if (pairs) {
          for (const pair of pairs) {
            const eq = pair.indexOf("=");
            const key = pair.slice(0, eq);
            const val = pair.slice(eq + 1).replace(/^"|"$/g, "").replace(/""/g, '"');
            if (key === "name") currentNode.name = val;
            else if (key === "type") currentNode.type = val;
            else if (key === "parent") currentNode.parent = val;
            else if (key === "instance") {
              const erMatch = val.match(/ExtResource\(["']?([^"']+)["']?\)/);
              if (erMatch) {
                const rawId = erMatch[1];
                const numericId = Number(rawId);
                currentNode.instance = !isNaN(numericId) && rawId !== "" ? numericId : rawId;
              }
            }
          }
        }
      }
      continue;
    }

    if (trimmed.startsWith("[connection")) {
      if (currentConnection && currentConnection.signal) {
        result.connections.push(currentConnection);
      }
      currentConnection = {};
      currentSection = "connection";
      const attrMatch = trimmed.match(/\[(\w+)\s+(.*)\]/);
      if (attrMatch) {
        const pairs = attrMatch[2].match(/(\w+)="([^"]*)"/g);
        if (pairs) {
          for (const pair of pairs) {
            const eq = pair.indexOf("=");
            const key = pair.slice(0, eq);
            const val = pair.slice(eq + 1).replace(/^"|"$/g, "").replace(/""/g, '"');
            if (key === "signal") currentConnection.signal = val;
            else if (key === "from") currentConnection.from = val;
            else if (key === "to") currentConnection.to = val;
            else if (key === "method") currentConnection.method = val;
          }
        }
      }
      continue;
    }

    if (trimmed.includes("=") && !trimmed.startsWith("[")) {
      const prop = parseTypedValue(trimmed, budget);
      switch (currentSection) {
        case "ext_resource":
          if (currentExt) currentExt[prop.name] = prop.value;
          break;
        case "sub_resource":
          if (currentSub) currentSub[prop.name] = prop.value;
          break;
        case "node":
          if (currentNode) {
            if (prop.name === "name") currentNode.name = String(prop.value);
            else if (prop.name === "type") currentNode.type = String(prop.value);
            else if (prop.name === "parent") currentNode.parent = String(prop.value);
            else currentNode.properties.push(prop);
          }
          break;
        case "connection":
          if (currentConnection) {
            if (prop.name === "signal") currentConnection.signal = String(prop.value);
            else if (prop.name === "from") currentConnection.from = String(prop.value);
            else if (prop.name === "to") currentConnection.to = String(prop.value);
            else if (prop.name === "method") currentConnection.method = String(prop.value);
          }
          break;
      }
    }
  }

  if (currentExt && currentExt.id !== undefined) result.extResources.push(currentExt);
  if (currentSub && currentSub.id !== undefined) result.subResources.push(currentSub);
  if (currentNode && currentNode.name) result.nodes.push(currentNode);
  if (currentConnection && currentConnection.signal) result.connections.push(currentConnection);

  const nodeMap = new Map();
  const extMap = new Map();
  for (const ext of result.extResources) {
    if (ext.path) extMap.set(ext.id, ext.path);
  }
  for (const node of result.nodes) {
    if (node.instance != null) {
      const extPath = extMap.get(node.instance);
      if (extPath) node.instance_of = extPath;
    }
  }

  let rootNode;
  for (const node of result.nodes) {
    node.children = [];
    if (!node.parent) {
      if (!rootNode) rootNode = node;
      nodeMap.set(node.name, node);
    } else if (node.parent === ".") {
      const uniquePath = rootNode ? `${rootNode.name}/${node.name}` : node.name;
      nodeMap.set(uniquePath, node);
    } else {
      const uniquePath = rootNode ? `${rootNode.name}/${node.parent}/${node.name}` : `${node.parent}/${node.name}`;
      nodeMap.set(uniquePath, node);
    }
  }

  for (const node of result.nodes) {
    if (node.parent) {
      let parent;
      if (node.parent === ".") {
        parent = rootNode;
      } else {
        const fullParentPath = rootNode ? `${rootNode.name}/${node.parent}` : node.parent;
        parent = nodeMap.get(fullParentPath);
      }
      if (parent) parent.children.push(node);
    }
  }

  result.nodeMap = nodeMap;

  if (content.trim() && !sawGdSceneHeader) {
    console.warn("[tscn-parser] input has no [gd_scene] header - malformed .tscn? Returning empty parse.");
  }

  return result;
}

export function parseTscnSummary(content) {
  const parsed = parseTscn(content);
  const lines = [];

  lines.push("=== Scene Summary ===");
  if (Object.keys(parsed.header).length > 0) {
    lines.push(`Format: ${parsed.header.format ?? "unknown"}, Steps: ${parsed.header.load_steps ?? "unknown"}`);
    if (parsed.header.uid) lines.push(`UID: ${parsed.header.uid}`);
  }

  lines.push(`\nExternal Resources: ${parsed.extResources.length}`);
  for (const r of parsed.extResources) {
    lines.push(`  [${r.id}] ${r.type}: ${r.path}`);
  }

  lines.push(`Sub Resources: ${parsed.subResources.length}`);
  for (const r of parsed.subResources) {
    lines.push(`  [${r.id}] ${r.type}`);
  }

  const roots = parsed.nodes.filter((n) => !n.parent);
  const printNode = (node, indent) => {
    const pad = "  ".repeat(indent);
    const inst = node.instance ? ` (instance: ExtResource(${node.instance}))` : "";
    lines.push(`${pad}${node.name} [${node.type}]${inst}`);
    for (const child of node.children) {
      printNode(child, indent + 1);
    }
  };
  lines.push(`\nNodes (${parsed.nodes.length} total):`);
  for (const root of roots) {
    printNode(root, 1);
  }

  if (parsed.connections.length > 0) {
    lines.push(`\nConnections: ${parsed.connections.length}`);
    for (const c of parsed.connections) {
      lines.push(`  ${c.from}.${c.signal} -> ${c.to}.${c.method}`);
    }
  }

  return lines.join("\n");
}

export function diffTscn(beforeContent, afterContent) {
  const before = parseTscn(beforeContent);
  const after = parseTscn(afterContent);

  const keyOf = (node, rootName) => {
    if (!node.parent) return node.name;
    if (node.parent === ".") return `${rootName}/${node.name}`;
    return `${rootName}/${node.parent}/${node.name}`;
  };

  const collectNodes = (parsed) => {
    const root = parsed.nodes.find((n) => !n.parent);
    const rootName = root ? root.name : "";
    const map = new Map();
    for (const node of parsed.nodes) {
      map.set(keyOf(node, rootName), node);
    }
    return map;
  };

  const propSignature = (node) => {
    const sig = {};
    for (const prop of node.properties) {
      sig[prop.name] = JSON.stringify(prop.value);
    }
    return sig;
  };

  const beforeNodes = collectNodes(before);
  const afterNodes = collectNodes(after);

  const added = [];
  const removed = [];
  const changed = [];

  for (const [pathKey, node] of afterNodes) {
    if (!beforeNodes.has(pathKey)) {
      added.push({ path: pathKey, name: node.name, type: node.type });
    } else {
      const prev = beforeNodes.get(pathKey);
      const prevProps = propSignature(prev);
      const nextProps = propSignature(node);
      const diffs = [];
      for (const name of new Set([...Object.keys(prevProps), ...Object.keys(nextProps)])) {
        if (prevProps[name] !== nextProps[name]) {
          diffs.push({ property: name, before: prevProps[name] ?? null, after: nextProps[name] ?? null });
        }
      }
      if (prev.type !== node.type) {
        diffs.push({ property: "type", before: prev.type, after: node.type });
      }
      if (diffs.length > 0) {
        changed.push({ path: pathKey, diffs });
      }
    }
  }
  for (const [pathKey, node] of beforeNodes) {
    if (!afterNodes.has(pathKey)) {
      removed.push({ path: pathKey, name: node.name, type: node.type });
    }
  }

  return {
    added,
    removed,
    changed,
    summary: `${added.length} added, ${removed.length} removed, ${changed.length} changed`,
  };
}
