import fs from "node:fs";
import path from "node:path";
import { readJsonLines } from "./jsonl.js";

function bullet(value) {
  return `- ${value}`;
}

function formatEntity(entity) {
  if (!entity) {
    return "none";
  }

  return [entity.kind, entity.name, entity.path ?? entity.id]
    .filter(Boolean)
    .join(" ");
}

export function buildSummary(store, traceId) {
  const dir = store.traceDir(traceId);
  const manifest = store.readJson(traceId, "manifest.json") ?? {};
  const context = store.readJson(traceId, "context.json") ?? {};
  const events = readJsonLines(path.join(dir, "events.jsonl"));
  const snapshots = readJsonLines(path.join(dir, "snapshots.jsonl"));
  const logs = readJsonLines(path.join(dir, "logs.jsonl"));
  const validations = readJsonLines(path.join(dir, "validations.jsonl"));

  const recent = [...events, ...snapshots, ...logs, ...validations]
    .sort((a, b) => a.seq - b.seq)
    .slice(-20);

  const lines = [
    `# Trace Summary: ${traceId}`,
    "",
    "## Context",
    "",
    bullet(`Engine: ${context.engine?.name ?? "unknown"} ${context.engine?.version ?? ""}`.trim()),
    bullet(`Project: ${context.project?.name ?? "unknown"}`),
    bullet(`Project root: ${context.project?.root ?? "unknown"}`),
    bullet(`Started: ${manifest.startedAt ?? "unknown"}`),
    bullet(`Ended: ${manifest.endedAt ?? "running or not stopped"}`),
    "",
    "## Counts",
    "",
    bullet(`Events: ${events.length}`),
    bullet(`Snapshots: ${snapshots.length}`),
    bullet(`Logs: ${logs.length}`),
    bullet(`Validations: ${validations.length}`),
    "",
    "## Recent Timeline",
    "",
  ];

  if (recent.length === 0) {
    lines.push("No events recorded.");
  } else {
    for (const item of recent) {
      const time = item.receivedAt ?? item.time ?? "";
      const frame = item.frame == null ? "" : ` frame=${item.frame}`;
      lines.push(
        bullet(
          `#${item.seq} ${time}${frame} ${item.type} entity=${formatEntity(item.entity)}`,
        ),
      );
    }
  }

  lines.push("");

  const summary = `${lines.join("\n")}\n`;
  fs.writeFileSync(path.join(dir, "summary.md"), summary, "utf8");
  return summary;
}
