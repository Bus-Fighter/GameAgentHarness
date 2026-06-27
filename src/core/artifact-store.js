import fs from "node:fs";
import path from "node:path";

function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function rmRecursiveSafe(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function dirSize(dir) {
  let size = 0;
  const entries = readDirSafe(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += dirSize(full);
    } else if (entry.isFile()) {
      try {
        size += fs.statSync(full).size;
      } catch {}
    }
  }
  return size;
}

export class ArtifactStore {
  constructor(rootDir, options = {}) {
    this.rootDir = path.resolve(rootDir);
    this.maxTraceAgeHours = Number(
      options.maxTraceAgeHours ?? process.env.HARNESS_MAX_TRACE_AGE_HOURS ?? 24,
    );
    this.maxTraceCount = Number(
      options.maxTraceCount ?? process.env.HARNESS_MAX_TRACE_COUNT ?? 50,
    );
    this.maxTotalSizeMB = Number(
      options.maxTotalSizeMB ?? process.env.HARNESS_MAX_TOTAL_TRACE_SIZE_MB ?? 500,
    );
    this._writeQueue = Promise.resolve();
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  traceDir(traceId) {
    return path.join(this.rootDir, traceId);
  }

  createTraceDir(traceId) {
    const dir = this.traceDir(traceId);
    fs.mkdirSync(path.join(dir, "evidence"), { recursive: true });
    return dir;
  }

  pruneTraces() {
    const traces = this.listTraces();
    if (traces.length === 0) {
      return { removed: [], remaining: 0 };
    }

    const removed = [];
    const now = Date.now();
    const maxAgeMs = this.maxTraceAgeHours * 60 * 60 * 1000;

    // 1. Age-based pruning.
    for (const trace of traces) {
      const started = trace.manifest.startedAt ? new Date(trace.manifest.startedAt).getTime() : 0;
      if (started > 0 && now - started > maxAgeMs) {
        if (rmRecursiveSafe(this.traceDir(trace.id))) {
          removed.push({ id: trace.id, reason: "age" });
        }
      }
    }

    // Refresh list after age pruning.
    let remaining = this.listTraces();

    // 2. Count-based pruning (oldest first).
    while (remaining.length > this.maxTraceCount) {
      const oldest = remaining.shift();
      if (!oldest) break;
      if (rmRecursiveSafe(this.traceDir(oldest.id))) {
        removed.push({ id: oldest.id, reason: "count" });
      }
      remaining = this.listTraces();
    }

    // 3. Total-size pruning (oldest first).
    const maxBytes = this.maxTotalSizeMB * 1024 * 1024;
    let totalSize = remaining.reduce((sum, t) => sum + dirSize(this.traceDir(t.id)), 0);
    while (totalSize > maxBytes && remaining.length > 0) {
      const oldest = remaining.shift();
      if (!oldest) break;
      const dir = this.traceDir(oldest.id);
      const size = dirSize(dir);
      if (rmRecursiveSafe(dir)) {
        removed.push({ id: oldest.id, reason: "size" });
        totalSize -= size;
      }
      remaining = this.listTraces();
    }

    return { removed, remaining: remaining.length };
  }

  writeJson(traceId, fileName, value) {
    fs.writeFileSync(
      path.join(this.traceDir(traceId), fileName),
      JSON.stringify(value),
      "utf8",
    );
  }

  writeBinary(traceId, fileName, buffer) {
    const filePath = path.join(this.traceDir(traceId), fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Queue large evidence writes so they do not block the intake thread.
    this._writeQueue = this._writeQueue.then(async () => {
      try {
        await fs.promises.writeFile(filePath, buffer);
      } catch (err) {
        console.error(`[harness] failed to write ${filePath}: ${err.message}`);
      }
    });
    return filePath;
  }

  readJson(traceId, fileName) {
    const filePath = path.join(this.traceDir(traceId), fileName);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  listTraces() {
    if (!fs.existsSync(this.rootDir)) {
      return [];
    }

    return fs
      .readdirSync(this.rootDir)
      .filter((name) => {
        const full = path.join(this.rootDir, name);
        try {
          return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, "manifest.json"));
        } catch {
          return false;
        }
      })
      .map((id) => {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(this.rootDir, id, "manifest.json"), "utf8"),
        );
        return { id, manifest };
      })
      .sort((a, b) => String(a.manifest.startedAt).localeCompare(String(b.manifest.startedAt)));
  }

  latestTraceId() {
    const traces = this.listTraces();
    return traces.length === 0 ? null : traces.at(-1).id;
  }
}
