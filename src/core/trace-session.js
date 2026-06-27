import fs from "node:fs";
import path from "node:path";
import { appendJsonLine } from "./jsonl.js";
import { makeTraceId } from "./id.js";
import { extractContextFromMessage, normalizeMessage, routeEventType } from "./events.js";

const STREAM_FILES = {
  events: "events.jsonl",
  snapshots: "snapshots.jsonl",
  logs: "logs.jsonl",
  validations: "validations.jsonl",
};

export class TraceSession {
  constructor(store, { traceId, context } = {}) {
    this.store = store;
    this.traceId = traceId ?? makeTraceId({
      projectName: context?.project?.name,
      engineName: context?.engine?.name,
    });
    this.context = context ?? null;
    this.seq = 0;
    this.counts = {
      events: 0,
      snapshots: 0,
      logs: 0,
      validations: 0,
    };
    this.startedAt = new Date().toISOString();
    this.endedAt = null;
    this.dir = this.store.createTraceDir(this.traceId);

    for (const fileName of Object.values(STREAM_FILES)) {
      fs.writeFileSync(path.join(this.dir, fileName), "", "utf8");
    }

    this.writeManifest();
    this.writeContext();
  }

  append(rawMessage, defaults = {}) {
    const base = normalizeMessage(rawMessage, defaults);
    if (!this.context) {
      this.context = extractContextFromMessage(base);
      this.writeContext();
    }

    const stream = routeEventType(base.type);
    const envelope = {
      seq: ++this.seq,
      traceId: this.traceId,
      ...base,
    };

    appendJsonLine(path.join(this.dir, STREAM_FILES[stream]), envelope);
    this.counts[stream] += 1;
    this.writeManifest();
    return envelope;
  }

  nextSeq() {
    return this.seq + 1;
  }

  stop() {
    if (!this.endedAt) {
      this.endedAt = new Date().toISOString();
      this.writeManifest();
    }
  }

  writeContext() {
    this.store.writeJson(this.traceId, "context.json", this.context ?? {});
  }

  writeManifest() {
    this.store.writeJson(this.traceId, "manifest.json", {
      schemaVersion: 1,
      traceId: this.traceId,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      counts: this.counts,
    });
  }
}
