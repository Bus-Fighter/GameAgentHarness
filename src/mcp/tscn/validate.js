export function validateSceneFileStructure(content, relPath) {
  const errors = [];

  if (!content.trim()) {
    return ["Empty scene/resource file"];
  }

  if (!/^\[gd_(scene|resource)\b/m.test(content)) {
    errors.push(`Missing [gd_scene] or [gd_resource] header in ${relPath}`);
  }

  const extIds = new Set();
  const extRegex = /\[ext_resource[^[]*id="([^"]+)"/g;
  let match;
  while ((match = extRegex.exec(content)) !== null) {
    const id = match[1];
    if (extIds.has(id)) {
      errors.push(`Duplicate ext_resource id: ${id} in ${relPath}`);
    } else {
      extIds.add(id);
    }
  }

  const subIds = new Set();
  const subRegex = /\[sub_resource[^[]*id="([^"]+)"/g;
  while ((match = subRegex.exec(content)) !== null) {
    const id = match[1];
    if (subIds.has(id)) {
      errors.push(`Duplicate sub_resource id: ${id} in ${relPath}`);
    } else {
      subIds.add(id);
    }
  }

  return errors;
}
