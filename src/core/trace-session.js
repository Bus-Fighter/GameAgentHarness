import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { appendJsonLine, flushWriter } from "./jsonl.js";
import { makeTraceId } from "./id.js";
import { extractContextFromMessage, normalizeMessage, routeEventType } from "./events.js";

const STREAM_FILES = {
  events: "events.jsonl",
  snapshots: "snapshots.jsonl",
  logs: "logs.jsonl",
  validations: "validations.jsonl",
};

const MANIFEST_DEBOUNCE_MS = 1000;
const DEFAULT_MAX_PERSISTED_FRAMES = 1000;

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
    this._manifestDirty = false;
    this._manifestTimer = null;
    this._streamPaths = {};
    this._evidenceFiles = [];
    this._maxPersistedFrames = Number(
      process.env.HARNESS_MAX_PERSISTED_FRAMES ?? DEFAULT_MAX_PERSISTED_FRAMES,
    );

    for (const [stream, fileName] of Object.entries(STREAM_FILES)) {
      const filePath = path.join(this.dir, fileName);
      fs.writeFileSync(filePath, "", "utf8");
      this._streamPaths[stream] = filePath;
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

    appendJsonLine(this._streamPaths[stream], envelope);
    this.counts[stream] += 1;
    this._scheduleManifestWrite();
    return envelope;
  }

  nextSeq() {
    return this.seq + 1;
  }

  stop() {
    if (!this.endedAt) {
      this.endedAt = new Date().toISOString();
    }
    this.flush();
    this._gzipStreams();
    this.writeManifest();
  }

  flush() {
    if (this._manifestTimer) {
      clearTimeout(this._manifestTimer);
      this._manifestTimer = null;
    }
    this._flushAll();
    this.writeManifest();
  }

  registerEvidenceFile(filePath) {
    this._evidenceFiles.push(filePath);
    while (this._evidenceFiles.length > this._maxPersistedFrames) {
      const oldest = this._evidenceFiles.shift();
      if (oldest) {
        try {
          fs.unlinkSync(oldest);
        } catch {}
      }
    }
  }

  _flushAll() {
    for (const filePath of Object.values(this._streamPaths)) {
      flushWriter(filePath);
    }
  }

  _gzipStreams() {
    for (const filePath of Object.values(this._streamPaths)) {
      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
          const data = fs.readFileSync(filePath);
          fs.writeFileSync(`${filePath}.gz`, gzipSync(data));
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error(`[harness] failed to gzip ${filePath}: ${err.message}`);
      }
    }
  }

  writeContext() {
    this.store.writeJson(this.traceId, "context.json", this.context ?? {});
  }

  _scheduleManifestWrite() {
    this._manifestDirty = true;
    if (this._manifestTimer) return;
    this._manifestTimer = setTimeout(() => {
      this._manifestTimer = null;
      this.writeManifest();
    }, MANIFEST_DEBOUNCE_MS);
  }

  writeManifest() {
    this._manifestDirty = false;
    this.store.writeJson(this.traceId, "manifest.json", {
      schemaVersion: 1,
      traceId: this.traceId,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      counts: this.counts,
    });
  }
}
