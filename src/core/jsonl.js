import fs from "node:fs";
import { createGunzip, gunzipSync } from "node:zlib";

const WRITERS = new Map();

export function appendJsonLine(filePath, value, { buffered = true } = {}) {
  const line = `${JSON.stringify(value)}\n`;
  if (!buffered) {
    fs.appendFileSync(filePath, line, "utf8");
    return;
  }

  let writer = WRITERS.get(filePath);
  if (!writer) {
    writer = { buffer: [], timer: null };
    WRITERS.set(filePath, writer);
  }
  writer.buffer.push(line);
  scheduleFlush(filePath, writer);
}

function scheduleFlush(filePath, writer) {
  if (writer.timer) return;
  writer.timer = setTimeout(() => {
    flushWriter(filePath, writer);
  }, 250);
}

export function flushWriter(filePath, writer) {
  if (!writer) {
    writer = WRITERS.get(filePath);
    if (!writer) return;
  }
  if (writer.timer) {
    clearTimeout(writer.timer);
    writer.timer = null;
  }
  if (writer.buffer.length === 0) return;
  const chunk = writer.buffer.join("");
  writer.buffer.length = 0;
  try {
    fs.appendFileSync(filePath, chunk, "utf8");
  } catch (err) {
    console.error(`[harness] failed to flush ${filePath}: ${err.message}`);
  }
}

export function flushAllWriters() {
  for (const [filePath, writer] of WRITERS) {
    flushWriter(filePath, writer);
  }
}

export function trimJsonLines(filePath, keepLast) {
  const writer = WRITERS.get(filePath);
  if (writer && writer.buffer.length > 0) {
    flushWriter(filePath, writer);
  }
  if (!fs.existsSync(filePath)) {
    return 0;
  }
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) {
    return 0;
  }
  const lines = content.split("\n").filter(Boolean);
  if (lines.length <= keepLast) {
    return lines.length;
  }
  const kept = lines.slice(-keepLast);
  fs.writeFileSync(filePath, kept.join("\n") + "\n", "utf8");
  return kept.length;
}

export function removeLinesBySeq(filePath, seqsToRemove) {
  const writer = WRITERS.get(filePath);
  if (writer && writer.buffer.length > 0) {
    flushWriter(filePath, writer);
  }
  const toRemove = new Set(seqsToRemove);
  if (!fs.existsSync(filePath) || toRemove.size === 0) {
    return 0;
  }
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) {
    return 0;
  }
  const lines = content.split("\n").filter(Boolean);
  const kept = [];
  let removed = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed != null && toRemove.has(parsed.seq)) {
        removed += 1;
        continue;
      }
    } catch {
      // Keep malformed lines rather than losing data.
    }
    kept.push(line);
  }
  fs.writeFileSync(filePath, kept.length > 0 ? kept.join("\n") + "\n" : "", "utf8");
  return removed;
}

export function readJsonLines(filePath) {
  const gzPath = `${filePath}.gz`;
  if (fs.existsSync(gzPath)) {
    return readGzJsonLines(gzPath);
  }
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) {
    return [];
  }

  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readGzJsonLines(gzPath) {
  return new Promise((resolve, reject) => {
    const lines = [];
    const gunzip = createGunzip();
    let leftover = "";
    gunzip.on("data", (chunk) => {
      leftover += chunk;
      const parts = leftover.split("\n");
      leftover = parts.pop();
      for (const line of parts) {
        if (line) lines.push(JSON.parse(line));
      }
    });
    gunzip.on("end", () => {
      if (leftover.trim()) {
        try {
          lines.push(JSON.parse(leftover));
        } catch {}
      }
      resolve(lines);
    });
    gunzip.on("error", reject);
    fs.createReadStream(gzPath).pipe(gunzip);
  });
}

export function readJsonLinesSync(filePath) {
  const gzPath = `${filePath}.gz`;
  if (fs.existsSync(gzPath)) {
    const content = gunzipSync(fs.readFileSync(gzPath)).toString("utf8");
    return parseLines(content);
  }
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return parseLines(fs.readFileSync(filePath, "utf8"));
}

function parseLines(content) {
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
