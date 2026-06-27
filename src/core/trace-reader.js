import path from "node:path";
import { readJsonLinesSync } from "./jsonl.js";

export const STREAM_FILES = {
  events: "events.jsonl",
  snapshots: "snapshots.jsonl",
  logs: "logs.jsonl",
  validations: "validations.jsonl",
};

export function resolveTraceId(store, requested = "latest") {
  if (!requested || requested === "latest") {
    return store.latestTraceId();
  }

  return requested;
}

export function readTrace(store, traceId) {
  const manifest = store.readJson(traceId, "manifest.json") ?? {};
  const context = store.readJson(traceId, "context.json") ?? {};
  const dir = store.traceDir(traceId);
  const streams = Object.fromEntries(
    Object.entries(STREAM_FILES).map(([stream, fileName]) => [
      stream,
      readJsonLinesSync(path.join(dir, fileName)).map((item) => ({ ...item, stream })),
    ]),
  );

  const timeline = Object.values(streams)
    .flat()
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  return {
    traceId,
    dir,
    manifest,
    context,
    streams,
    timeline,
  };
}

export function filterTimeline(trace, { stream = "all", type = null, source = null, limit = null } = {}) {
  let items = stream === "all" ? trace.timeline : (trace.streams[stream] ?? []);

  if (type) {
    items = items.filter((item) => item.type === type || item.type?.startsWith(`${type}.`));
  }

  if (source) {
    items = items.filter((item) => item.source === source);
  }

  if (limit != null) {
    items = items.slice(-Number(limit));
  }

  return items;
}

export function latestItem(items, predicate = () => true) {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i])) {
      return items[i];
    }
  }

  return null;
}

export function countByType(items) {
  const counts = new Map();
  for (const item of items) {
    counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  }

  return Object.fromEntries([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}
