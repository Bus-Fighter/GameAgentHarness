import fs from "node:fs";
import path from "node:path";

export class ArtifactStore {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
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
    fs.writeFileSync(filePath, buffer);
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

    return fs.readdirSync(this.rootDir)
      .filter((name) => fs.existsSync(path.join(this.rootDir, name, "manifest.json")))
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
