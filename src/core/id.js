export function safeSlug(value) {
  return String(value ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "unknown";
}

export function utcStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function makeTraceId({ projectName, engineName } = {}) {
  return `${utcStamp()}-${safeSlug(engineName)}-${safeSlug(projectName)}`;
}
