const ROUTES = [
  { prefix: "log.", stream: "logs" },
  { prefix: "state.", stream: "snapshots" },
  { prefix: "snapshot.", stream: "snapshots" },
  { prefix: "validation.", stream: "validations" },
];

export function routeEventType(type) {
  const route = ROUTES.find((item) => String(type).startsWith(item.prefix));
  return route?.stream ?? "events";
}

export function normalizeMessage(raw, defaults = {}) {
  const now = new Date().toISOString();
  const type = raw.type ?? raw.eventType ?? raw.kind ?? "event.unknown";

  return {
    receivedAt: now,
    source: raw.source ?? defaults.source ?? "unknown",
    type,
    engine: raw.engine ?? defaults.engine ?? null,
    project: raw.project ?? defaults.project ?? null,
    frame: raw.frame ?? null,
    engineTimeMs: raw.engineTimeMs ?? null,
    entity: raw.entity ?? null,
    data: raw.data ?? {},
    rawKind: raw.kind ?? null,
  };
}

export function extractContextFromMessage(message) {
  return {
    source: message.source ?? "unknown",
    engine: message.engine ?? null,
    project: message.project ?? null,
    firstSeenAt: new Date().toISOString(),
  };
}
