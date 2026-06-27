import fs from "node:fs";
import path from "node:path";

export function loadJsonFile(filePath) {
  const resolved = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function normalizeEngine(engine) {
  if (!engine) {
    return { name: "generic" };
  }

  if (typeof engine === "string") {
    return { name: engine };
  }

  return {
    name: engine.name ?? "generic",
    ...engine,
  };
}

function normalizeProject(raw) {
  const project = raw.project ?? {};
  return {
    name: project.name ?? raw.projectName ?? "UnknownProject",
    root: project.root ?? raw.projectRoot ?? null,
    ...project,
  };
}

function normalizeSemanticEvents(raw) {
  if (Array.isArray(raw.semanticEvents)) {
    return raw.semanticEvents.map((item) => (typeof item === "string" ? { type: item } : item));
  }

  return (raw.interestingEventTypes ?? []).map((type) => ({ type }));
}

export function normalizeProfile(raw = {}, { profilePath = null } = {}) {
  const resolvedProfilePath = profilePath ? path.resolve(profilePath) : null;
  return {
    schemaVersion: raw.schemaVersion ?? 1,
    profilePath: resolvedProfilePath,
    profileDir: resolvedProfilePath ? path.dirname(resolvedProfilePath) : null,
    project: normalizeProject(raw),
    engine: normalizeEngine(raw.engine),
    traceDir: raw.traceDir ?? null,
    importantEntities: raw.importantEntities ?? raw.semanticEntities ?? [],
    interestingSignals: raw.interestingSignals ?? [],
    interestingEventTypes: raw.interestingEventTypes ?? [],
    semanticEvents: normalizeSemanticEvents(raw),
    signalSubscriptions: raw.signalSubscriptions ?? [],
    validationScenarios: raw.validationScenarios ?? raw.scenarios ?? [],
    safety: raw.safety ?? {},
    raw,
  };
}

export function loadProfile(profilePath) {
  if (!profilePath) {
    return null;
  }

  return normalizeProfile(loadJsonFile(profilePath), { profilePath });
}

export function defaultProfile() {
  return normalizeProfile({});
}

export function profileOrDefault(profile) {
  return profile ?? defaultProfile();
}

export function resolveTraceDir({ traceDir, profile, cwd = process.cwd() } = {}) {
  if (traceDir) {
    return path.resolve(cwd, traceDir);
  }

  if (profile?.traceDir) {
    const base = profile.profileDir ?? cwd;
    return path.resolve(base, profile.traceDir);
  }

  return path.resolve(cwd, "traces");
}

export function resolveProfilePath(profile, relativePath) {
  if (!relativePath) {
    return null;
  }

  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }

  return path.resolve(profile?.profileDir ?? process.cwd(), relativePath);
}
