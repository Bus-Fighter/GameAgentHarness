export function mergeTscn(ours, theirs) {
  const parseExt = (content) => {
    const result = [];
    let m;
    const regex = /\[ext_resource\s+([^[\]]+)\]/g;
    while ((m = regex.exec(content)) !== null) {
      const line = m[1];
      const typeMatch = line.match(/type="([^"]+)"/);
      const pathMatch = line.match(/path="([^"]+)"/);
      const idMatch = line.match(/id="([^"]+)"/);
      if (pathMatch) {
        result.push({ type: typeMatch?.[1] ?? "", path: pathMatch[1], originalId: idMatch?.[1] ?? "", line: m[0] });
      }
    }
    return result;
  };

  const parseSub = (content) => {
    const result = [];
    const regex = /\[sub_resource\s+type="([^"]+)"\s+id="([^"]+)"\]([\s\S]*?)(?=\r?\n\[sub_resource|\r?\n\[node|\r?\n\[ext_resource|$)/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
      result.push({ type: m[1], originalId: m[2], body: m[3].trim() });
    }
    return result;
  };

  const parseNodes = (content) => {
    const result = [];
    const sections = content.split(/\n(?=\[node\s)/);
    for (const section of sections) {
      const headerMatch = section.match(/^\[node\s+name="([^"]+)"/);
      if (headerMatch) {
        const parentMatch = section.match(/parent="([^"]*)"/);
        const parent = parentMatch ? parentMatch[1] : ".";
        result.push({ name: headerMatch[1], parent, line: headerMatch[0], body: section.trim() });
      }
    }
    return result;
  };

  const headerMatch = ours.match(/^([\s\S]*?)(?=\n\[ext_resource|\n\[sub_resource|\n\[node)/);
  const header = headerMatch ? headerMatch[1].trim() : "[gd_scene format=3]";

  const oursExt = parseExt(ours);
  const theirsExt = parseExt(theirs);
  const seenPaths = new Set(oursExt.map((e) => e.path));
  const mergedExt = [...oursExt];
  const discardedExtByOurs = {};
  for (const ext of theirsExt) {
    if (!seenPaths.has(ext.path)) {
      mergedExt.push(ext);
      seenPaths.add(ext.path);
    } else if (ext.originalId) {
      const oursSamePath = oursExt.find((o) => o.path === ext.path);
      if (oursSamePath?.originalId && oursSamePath.originalId !== ext.originalId) {
        discardedExtByOurs[ext.originalId] = oursSamePath.originalId;
      }
    }
  }

  const oursSub = parseSub(ours);
  const theirsSub = parseSub(theirs);
  const subSignature = (s) => `${s.type}::${s.body}`;
  const seenSubSigs = new Set(oursSub.map(subSignature));
  const mergedSub = [...oursSub];
  const discardedSubByOurs = {};
  for (const sub of theirsSub) {
    if (!seenSubSigs.has(subSignature(sub))) {
      mergedSub.push(sub);
      seenSubSigs.add(subSignature(sub));
    } else if (sub.originalId) {
      const oursSameSig = oursSub.find((o) => subSignature(o) === subSignature(sub));
      if (oursSameSig?.originalId && oursSameSig.originalId !== sub.originalId) {
        discardedSubByOurs[sub.originalId] = oursSameSig.originalId;
      }
    }
  }

  const usedIds = new Set();
  oursExt.forEach((e) => { if (e.originalId) usedIds.add(e.originalId); });
  oursSub.forEach((s) => { if (s.originalId) usedIds.add(s.originalId); });

  const allocateId = (originalId, isOurs) => {
    if (isOurs || !usedIds.has(originalId)) {
      usedIds.add(originalId);
      return originalId;
    }
    if (/^\d+$/.test(originalId)) {
      const maxNum = [...usedIds].filter((id) => /^\d+$/.test(id)).reduce((max, id) => Math.max(max, parseInt(id, 10)), 0);
      const newId = String(maxNum + 1);
      usedIds.add(newId);
      return newId;
    }
    let seq = 1;
    let candidate = `${originalId}_m${seq}`;
    while (usedIds.has(candidate)) {
      seq += 1;
      candidate = `${originalId}_m${seq}`;
    }
    usedIds.add(candidate);
    return candidate;
  };

  const extIdMap = {};
  const reindexedExt = [];
  mergedExt.forEach((ext) => {
    const isOurs = oursExt.some((o) => o.path === ext.path);
    const newId = allocateId(ext.originalId, isOurs);
    if (ext.originalId && ext.originalId !== newId) extIdMap[ext.originalId] = newId;
    reindexedExt.push(`[ext_resource type="${ext.type}" path="${ext.path}" id="${newId}"]`);
  });
  for (const [discardedId, oursOrigId] of Object.entries(discardedExtByOurs)) {
    extIdMap[discardedId] = extIdMap[oursOrigId] ?? oursOrigId;
  }

  const subIdMap = {};
  const reindexedSub = [];
  mergedSub.forEach((sub) => {
    const isOurs = oursSub.some((o) => o.type === sub.type && o.body === sub.body);
    const newId = allocateId(sub.originalId, isOurs);
    if (sub.originalId && sub.originalId !== newId) subIdMap[sub.originalId] = newId;
    reindexedSub.push(`[sub_resource type="${sub.type}" id="${newId}"]\n${sub.body}`);
  });
  for (const [discardedId, oursOrigId] of Object.entries(discardedSubByOurs)) {
    subIdMap[discardedId] = subIdMap[oursOrigId] ?? oursOrigId;
  }

  const oursNodes = parseNodes(ours);
  const theirsNodes = parseNodes(theirs);
  const oursNodeKeys = new Set(oursNodes.map((n) => `${n.parent}/${n.name}`));
  const mergedNodes = [...oursNodes];
  for (const node of theirsNodes) {
    if (!oursNodeKeys.has(`${node.parent}/${node.name}`)) {
      mergedNodes.push(node);
    }
  }

  const parseConnections = (content) => {
    const result = [];
    const regex = /^\[connection\s+[^\]]+\]/gm;
    let m;
    while ((m = regex.exec(content)) !== null) {
      result.push(m[0]);
    }
    return result;
  };

  const oursConns = parseConnections(ours);
  const theirsConns = parseConnections(theirs);
  const seenConns = new Set(oursConns);
  const mergedConns = [...oursConns];
  for (const conn of theirsConns) {
    if (!seenConns.has(conn)) {
      mergedConns.push(conn);
      seenConns.add(conn);
    }
  }

  const totalResources = mergedExt.length + mergedSub.length;
  const updatedHeader = header.replace(/load_steps=\d+/, `load_steps=${totalResources + 1}`);

  const formatOf = (content) => {
    const m = content.match(/format=(\d+)/);
    return m ? m[1] : null;
  };
  const fmtA = formatOf(ours);
  const fmtB = formatOf(theirs);

  const parts = [updatedHeader, ""];
  if (fmtA && fmtB && fmtA !== fmtB) {
    parts.push(`; WARNING: format mismatch - ours=${fmtA} theirs=${fmtB}`);
  }
  parts.push(...reindexedExt);
  if (reindexedSub.length > 0) {
    parts.push("");
    parts.push(...reindexedSub);
  }
  parts.push("");
  for (const node of mergedNodes) {
    let body = node.body;
    body = body.replace(/^\[connection\s+[^\]]+\]\s*$/gm, "").replace(/\n{3,}/g, "\n\n").trimEnd();
    if (Object.keys(extIdMap).length > 0) {
      body = body.replace(/ExtResource\("([^"]+)"\)/g, (_match, id) => {
        const newId = extIdMap[id];
        return newId ? `ExtResource("${newId}")` : `ExtResource("${id}")`;
      });
    }
    if (Object.keys(subIdMap).length > 0) {
      body = body.replace(/SubResource\("([^"]+)"\)/g, (_match, id) => {
        const newId = subIdMap[id];
        return newId ? `SubResource("${newId}")` : `SubResource("${id}")`;
      });
    }
    parts.push(body);
    parts.push("");
  }

  for (const conn of mergedConns) {
    parts.push(conn);
    parts.push("");
  }

  return parts.join("\n");
}

export function checkSceneHealth(content, scenePath) {
  const issues = [];
  const lines = content.split("\n");

  const nodeRegex = /^\[node\s+name="([^"]+)"(?:\s+type="([^"]+)")?(?:\s+parent="([^"]*)")?\]/;
  const nodes = [];

  let currentSection = "";
  let currentNode = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();

    if (line.startsWith("[node ")) {
      const match = line.match(nodeRegex);
      if (match) {
        currentNode = { name: match[1], type: match[2], parent: match[3], hasScript: false, line: i + 1 };
        nodes.push(currentNode);
      }
      currentSection = "node";
      continue;
    }

    if (line.startsWith("[")) {
      currentSection = line.startsWith("[gd_") ? "header" : "resource";
      currentNode = null;
      continue;
    }

    if (currentNode && currentSection === "node") {
      if (/^script\s*=/.test(line)) {
        currentNode.hasScript = true;
      }
    }
  }

  const extSceneRegex = /\[ext_resource[^[]*type="PackedScene"[^[]*path="([^"]+)"/g;
  let extMatch;
  while ((extMatch = extSceneRegex.exec(content)) !== null) {
    const resPath = extMatch[1];
    const normalizedScene = scenePath.replace(/\\/g, "/");
    if (resPath.endsWith(normalizedScene) || normalizedScene.endsWith(resPath.replace("res://", ""))) {
      issues.push(`Circular self-reference: scene instances itself via ${resPath}`);
    }
  }

  const childrenByParent = {};
  for (const node of nodes) {
    const parent = node.parent || ".";
    if (!childrenByParent[parent]) childrenByParent[parent] = [];
    childrenByParent[parent].push(node.name);
  }
  for (const [parent, names] of Object.entries(childrenByParent)) {
    const seen = new Set();
    for (const name of names) {
      if (seen.has(name)) {
        issues.push(`Duplicate node name "${name}" under parent "${parent}"`);
      }
      seen.add(name);
    }
  }

  const builtInTypes = new Set(["Camera2D", "Camera3D", "CollisionShape2D", "CollisionShape3D",
    "VisibleOnScreenNotifier2D", "VisibleOnScreenNotifier3D", "AudioListener2D", "AudioListener3D"]);

  for (const node of nodes) {
    const hasChildren = nodes.some((n) => {
      if (!n.parent) return false;
      const expected = node.parent ? `${node.parent}/${node.name}` : node.name;
      return n.parent === expected || (node.parent === "." && n.parent === node.name);
    });
    if (!node.hasScript && !hasChildren && node.type && !builtInTypes.has(node.type)) {
      issues.push(`Orphan node "${node.name}" (${node.type}) has no script and no children`);
    }
  }

  return { issues, nodesChecked: nodes.length };
}
