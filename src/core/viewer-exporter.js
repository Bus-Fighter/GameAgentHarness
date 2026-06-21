import fs from "node:fs";
import path from "node:path";
import { buildCurrentContext } from "./context-builder.js";
import { readTrace } from "./trace-reader.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function jsonBlock(value) {
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function timelineRows(items) {
  return items.map((item) => `
    <tr>
      <td>${item.seq}</td>
      <td>${escapeHtml(item.stream)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${escapeHtml(item.entity?.name ?? item.entity?.path ?? "")}</td>
      <td>${escapeHtml(item.frame ?? "")}</td>
    </tr>`).join("\n");
}

export function exportViewer({ store, traceId, profile = null, outputPath }) {
  if (!outputPath) {
    throw new Error("Missing outputPath for viewer export.");
  }

  const trace = readTrace(store, traceId);
  const context = buildCurrentContext(store, traceId, { profile, recentLimit: 20 });
  const evidenceEvents = trace.timeline.filter((item) => item.type?.startsWith("evidence."));
  const validationRows = context.validations.recent.map((item) => `
    <li><strong>${item.pass === false ? "FAIL" : "PASS"}</strong> ${escapeHtml(item.name ?? item.type)}</li>`).join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Game Agent Harness Trace ${escapeHtml(traceId)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 32px; color: #1f2933; background: #f8fafc; }
    main { max-width: 1120px; margin: 0 auto; }
    section { background: white; border: 1px solid #d9e2ec; border-radius: 8px; padding: 20px; margin: 16px 0; }
    h1, h2 { margin: 0 0 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
    pre { overflow: auto; background: #111827; color: #e5e7eb; padding: 12px; border-radius: 6px; }
    .ok { color: #047857; }
    .bad { color: #b91c1c; }
    .meta { color: #52606d; }
  </style>
</head>
<body>
<main>
  <h1>Trace ${escapeHtml(traceId)}</h1>
  <p class="meta">Project ${escapeHtml(context.observed.project?.name ?? context.profile.project.name)} · Engine ${escapeHtml(context.observed.engine?.name ?? context.profile.engine.name)}</p>

  <section>
    <h2>Current Context</h2>
    <ul>
      <li>Scene: ${escapeHtml(context.scene ?? "unknown")}</li>
      <li>Runtime running: ${escapeHtml(context.runtime.running)}</li>
      <li>Selected: ${escapeHtml(context.selected?.name ?? "none")}</li>
      <li>Errors: <span class="${context.errors.length > 0 ? "bad" : "ok"}">${context.errors.length}</span></li>
      <li>Validations: ${context.validations.passed} passed, ${context.validations.failed} failed</li>
    </ul>
  </section>

  <section>
    <h2>Important Entities</h2>
    <ul>
      ${context.importantEntities.map((item) => `<li>${escapeHtml(item.role)}: ${escapeHtml(item.matched ? item.label : "not observed")}</li>`).join("\n")}
    </ul>
  </section>

  <section>
    <h2>Latest Snapshot</h2>
    ${jsonBlock(context.latestSnapshot ?? {})}
  </section>

  <section>
    <h2>Validation Results</h2>
    <ul>${validationRows || "<li>none</li>"}</ul>
  </section>

  <section>
    <h2>Evidence</h2>
    <ul>
      ${evidenceEvents.map((item) => `<li>#${item.seq} ${escapeHtml(item.type)}: ${escapeHtml(item.data?.path ?? "")}</li>`).join("\n") || "<li>none</li>"}
    </ul>
  </section>

  <section>
    <h2>Timeline</h2>
    <table>
      <thead><tr><th>Seq</th><th>Stream</th><th>Type</th><th>Entity</th><th>Frame</th></tr></thead>
      <tbody>${timelineRows(trace.timeline)}</tbody>
    </table>
  </section>
</main>
</body>
</html>
`;

  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, html, "utf8");
  return {
    traceId,
    outputPath: resolved,
    events: trace.timeline.length,
    evidence: evidenceEvents.length,
  };
}
