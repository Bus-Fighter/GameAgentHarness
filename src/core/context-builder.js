import { profileOrDefault } from "./profile.js";
import { latestItem, readTrace } from "./trace-reader.js";

const GENERIC_PREFIXES = [
  "engine.",
  "project.",
  "plugin.",
  "editor.",
  "runtime.",
  "scene.",
  "selection.",
  "input.",
  "state.",
  "snapshot.",
  "log.",
  "validation.",
  "evidence.",
];

function entityLabel(entity) {
  if (!entity) {
    return "none";
  }

  return [entity.kind, entity.name, entity.type, entity.path ?? entity.id]
    .filter(Boolean)
    .join(" ");
}

function valueMatches(actual, expected) {
  if (expected == null) {
    return actual == null;
  }

  if (typeof expected === "string" && expected.startsWith("/") && expected.endsWith("/")) {
    return new RegExp(expected.slice(1, -1)).test(String(actual ?? ""));
  }

  return actual === expected;
}

function entityMatches(event, match = {}) {
  const entity = event.entity ?? {};
  const data = event.data ?? {};
  const candidates = {
    id: entity.id,
    entityId: entity.id,
    name: entity.name,
    entityName: entity.name,
    nodeName: entity.name,
    kind: entity.kind,
    type: entity.type,
    className: entity.type ?? data.className,
    path: entity.path,
  };

  return Object.entries(match).every(([key, expected]) => {
    if (key === "pathContains") {
      return String(entity.path ?? "").includes(String(expected));
    }

    if (key === "typeContains") {
      return String(entity.type ?? "").includes(String(expected));
    }

    return valueMatches(candidates[key], expected);
  });
}

function findImportantEntities(timeline, profile) {
  return (profile.importantEntities ?? []).map((rule) => {
    const event = latestItem(timeline, (item) => entityMatches(item, rule.match ?? {}));
    return {
      role: rule.role ?? rule.name ?? "entity",
      matched: Boolean(event),
      entity: event?.entity ?? null,
      lastEventType: event?.type ?? null,
      lastSeenSeq: event?.seq ?? null,
      label: entityLabel(event?.entity ?? null),
    };
  });
}

function isError(item) {
  const level = String(item.data?.level ?? item.data?.severity ?? "").toLowerCase();
  return item.type === "log.error"
    || item.type === "log.fatal"
    || item.type?.endsWith(".error")
    || level === "error"
    || level === "fatal";
}

function isSemanticEvent(item, profile) {
  const explicit = new Set((profile.semanticEvents ?? []).map((event) => event.type));
  if (explicit.has(item.type)) {
    return true;
  }

  return !GENERIC_PREFIXES.some((prefix) => item.type?.startsWith(prefix));
}

function buildSceneState(timeline) {
  let runtime = { running: false, startedSeq: null, stoppedSeq: null };
  let scene = null;
  let selected = null;

  for (const item of timeline) {
    if (item.type === "runtime.started") {
      runtime = { running: true, startedSeq: item.seq, stoppedSeq: null };
      scene = item.data?.scene ?? item.data?.mainScene ?? scene;
    } else if (item.type === "runtime.stopped") {
      runtime = { ...runtime, running: false, stoppedSeq: item.seq };
    } else if (item.type === "scene.changed") {
      scene = item.data?.scenePath ?? item.data?.scene ?? scene;
    } else if (item.type === "selection.changed") {
      selected = item.data?.selected?.[0] ?? item.entity ?? null;
    }
  }

  return { runtime, scene, selected };
}

export function buildCurrentContext(store, traceId, { profile = null, recentLimit = 10 } = {}) {
  const normalizedProfile = profileOrDefault(profile);
  const trace = readTrace(store, traceId);
  const sceneState = buildSceneState(trace.timeline);
  const latestSnapshot = latestItem(trace.streams.snapshots) ?? null;
  const errors = trace.timeline.filter(isError);
  const validations = trace.streams.validations;
  const validationPasses = validations.filter((item) => item.data?.pass === true).length;
  const validationFailures = validations.filter((item) => item.data?.pass === false).length;
  const semanticEvents = trace.timeline.filter((item) => isSemanticEvent(item, normalizedProfile));

  return {
    traceId,
    profile: {
      project: normalizedProfile.project,
      engine: normalizedProfile.engine,
      profilePath: normalizedProfile.profilePath,
    },
    trace: {
      startedAt: trace.manifest.startedAt ?? null,
      endedAt: trace.manifest.endedAt ?? null,
      counts: trace.manifest.counts ?? {},
    },
    observed: {
      source: trace.context.source ?? null,
      engine: trace.context.engine ?? normalizedProfile.engine,
      project: trace.context.project ?? normalizedProfile.project,
    },
    runtime: sceneState.runtime,
    scene: sceneState.scene,
    selected: sceneState.selected,
    latestSnapshot: latestSnapshot?.data ?? null,
    importantEntities: findImportantEntities(trace.timeline, normalizedProfile),
    semanticEvents: semanticEvents.slice(-recentLimit).map((item) => ({
      seq: item.seq,
      type: item.type,
      entity: item.entity,
      data: item.data,
    })),
    errors: errors.slice(-recentLimit).map((item) => ({
      seq: item.seq,
      type: item.type,
      data: item.data,
      entity: item.entity,
    })),
    validations: {
      total: validations.length,
      passed: validationPasses,
      failed: validationFailures,
      recent: validations.slice(-recentLimit).map((item) => ({
        seq: item.seq,
        type: item.type,
        name: item.data?.name ?? null,
        pass: item.data?.pass ?? null,
        data: item.data,
      })),
    },
    recentTimeline: trace.timeline.slice(-recentLimit).map((item) => ({
      seq: item.seq,
      stream: item.stream,
      type: item.type,
      entity: entityLabel(item.entity),
      frame: item.frame,
      receivedAt: item.receivedAt,
    })),
  };
}
