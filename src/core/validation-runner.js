import { loadJsonFile } from "./profile.js";
import { buildCurrentContext } from "./context-builder.js";
import { readTrace } from "./trace-reader.js";

export function loadScenario(filePath) {
  return loadJsonFile(filePath);
}

function getPath(value, dottedPath) {
  return String(dottedPath)
    .split(".")
    .reduce((current, key) => {
      if (current == null) {
        return undefined;
      }
      return current[key];
    }, value);
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function matchesCondition(actual, expected) {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if (Object.hasOwn(expected, "equals")) {
      return deepEqual(actual, expected.equals);
    }
    if (Object.hasOwn(expected, "present")) {
      return expected.present ? actual !== undefined && actual !== null : actual === undefined || actual === null;
    }
    if (Object.hasOwn(expected, "contains")) {
      if (Array.isArray(actual)) {
        return actual.includes(expected.contains);
      }
      return String(actual ?? "").includes(String(expected.contains));
    }
    if (Object.hasOwn(expected, "in")) {
      return Array.isArray(expected.in) && expected.in.includes(actual);
    }
  }

  return deepEqual(actual, expected);
}

function matchesWhere(item, where = {}) {
  return Object.entries(where).every(([path, expected]) => matchesCondition(getPath(item, path), expected));
}

function hasNoErrors(trace) {
  return !trace.timeline.some((item) => {
    const level = String(item.data?.level ?? item.data?.severity ?? "").toLowerCase();
    return item.type === "log.error"
      || item.type === "log.fatal"
      || item.type?.endsWith(".error")
      || level === "error"
      || level === "fatal";
  });
}

function checkEvent(trace, check) {
  const streamItems = check.stream && check.stream !== "all"
    ? trace.streams[check.stream] ?? []
    : trace.timeline;
  const eventType = check.eventType ?? check.typeName ?? check.name;
  const matches = streamItems.filter((item) => {
    const typeMatches = !eventType || item.type === eventType || (check.prefix === true && item.type?.startsWith(eventType));
    return typeMatches && matchesWhere(item, check.where ?? {});
  });
  const atLeast = check.atLeast ?? 1;
  const ok = matches.length >= atLeast;
  return {
    ok,
    message: `${matches.length}/${atLeast} events matched ${eventType ?? "any event"}`,
    actual: matches.length,
    expected: { atLeast, eventType },
    sample: matches.at(-1) ?? null,
  };
}

function checkLatestSnapshot(trace, check) {
  const latest = trace.streams.snapshots.at(-1) ?? null;
  if (!latest) {
    return { ok: false, message: "No snapshots recorded", actual: null, expected: check };
  }

  const actual = getPath(latest, check.path);
  const ok = matchesCondition(actual, check.equals ?? check.value ?? check.condition ?? { present: true });
  return {
    ok,
    message: `Latest snapshot ${check.path} ${ok ? "matched" : "did not match"}`,
    actual,
    expected: check.equals ?? check.value ?? check.condition ?? { present: true },
  };
}

function checkValidation(trace, check) {
  const validationName = check.validationName ?? check.assertionName ?? null;
  const matches = trace.streams.validations.filter((item) => {
    const nameMatches = !validationName || item.data?.name === validationName;
    const passMatches = check.pass == null || item.data?.pass === check.pass;
    return nameMatches && passMatches && matchesWhere(item, check.where ?? {});
  });
  const atLeast = check.atLeast ?? 1;
  return {
    ok: matches.length >= atLeast,
    message: `${matches.length}/${atLeast} validation results matched ${validationName ?? "any validation"}`,
    actual: matches.length,
    expected: { atLeast, name: validationName, pass: check.pass ?? null },
    sample: matches.at(-1) ?? null,
  };
}

function checkEntitySeen(context, check) {
  const match = context.importantEntities.find((entity) => entity.role === check.role);
  const ok = Boolean(match?.matched);
  return {
    ok,
    message: ok ? `Entity role ${check.role} was observed` : `Entity role ${check.role} was not observed`,
    actual: match ?? null,
    expected: { role: check.role },
  };
}

function checkTimelineOrder(trace, check) {
  const eventTypes = check.eventTypes ?? [];
  let cursor = -1;
  const matched = [];

  for (const eventType of eventTypes) {
    const found = trace.timeline.find((item) => item.seq > cursor && item.type === eventType);
    if (!found) {
      return {
        ok: false,
        message: `Timeline did not contain ${eventType} after seq ${cursor}`,
        actual: matched,
        expected: eventTypes,
      };
    }
    cursor = found.seq;
    matched.push({ type: found.type, seq: found.seq });
  }

  return {
    ok: true,
    message: `Timeline order matched: ${eventTypes.join(" -> ")}`,
    actual: matched,
    expected: eventTypes,
  };
}

function evaluateCheck({ trace, context, check }) {
  switch (check.kind ?? check.check) {
    case "event":
      return checkEvent(trace, check);
    case "latestSnapshot":
      return checkLatestSnapshot(trace, check);
    case "validation":
      return checkValidation(trace, check);
    case "entitySeen":
      return checkEntitySeen(context, check);
    case "timelineOrder":
      return checkTimelineOrder(trace, check);
    case "noErrors":
      return {
        ok: hasNoErrors(trace),
        message: hasNoErrors(trace) ? "No error events or logs recorded" : "Error events or logs were recorded",
        actual: trace.timeline.filter((item) => item.type?.endsWith(".error") || item.type === "log.error"),
        expected: "no errors",
      };
    default:
      return {
        ok: false,
        message: `Unknown check kind: ${check.kind ?? check.check}`,
        actual: null,
        expected: check,
      };
  }
}

export function runScenario({ store, traceId, profile, scenario }) {
  const trace = readTrace(store, traceId);
  const context = buildCurrentContext(store, traceId, { profile });
  const checks = (scenario.expect ?? []).map((check, index) => {
    const result = evaluateCheck({ trace, context, check });
    return {
      index,
      name: check.name ?? check.kind ?? check.check ?? `check-${index + 1}`,
      ...result,
    };
  });
  const failed = checks.filter((check) => !check.ok);

  return {
    schemaVersion: 1,
    name: scenario.name ?? "unnamed-scenario",
    description: scenario.description ?? null,
    traceId,
    ok: failed.length === 0,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };
}
