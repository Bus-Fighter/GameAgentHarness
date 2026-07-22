import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ArtifactStore } from "../src/core/artifact-store.js";
import { buildCurrentContext } from "../src/core/context-builder.js";
import { loadProfile } from "../src/core/profile.js";
import { TraceSession } from "../src/core/trace-session.js";
import { buildSummary } from "../src/core/summary-builder.js";
import { runScenario } from "../src/core/validation-runner.js";
import { exportViewer } from "../src/core/viewer-exporter.js";
import { createTestFieldTrace } from "../src/dev/test-field.js";

test("TraceSession writes routed JSONL artifacts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gah-test-"));
  const store = new ArtifactStore(root);
  const session = new TraceSession(store, {
    context: {
      engine: { name: "godot", version: "4.5" },
      project: { name: "CatSweeper", root: "/tmp/CatSweeper" },
    },
  });

  session.append({ type: "input.pointer.pressed", data: { x: 1, y: 2 } });
  session.append({ type: "state.sampled", data: { hp: 2 } });
  session.append({ type: "validation.assertion", data: { pass: true } });
  session.stop();

  const manifest = store.readJson(session.traceId, "manifest.json");
  assert.equal(manifest.counts.events, 1);
  assert.equal(manifest.counts.snapshots, 1);
  assert.equal(manifest.counts.validations, 1);
  assert.ok(manifest.endedAt);

  const summary = buildSummary(store, session.traceId);
  assert.match(summary, /Trace Summary/);
  assert.match(summary, /input.pointer.pressed/);
});

test("profile, context, and validation work against the generic test field", () => {
  const traceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gah-test-field-"));
  const profile = loadProfile(fileURLToPath(new URL("../examples/test-field.profile.json", import.meta.url)));
  const scenario = JSON.parse(fs.readFileSync(new URL("../examples/test-field.validation.json", import.meta.url), "utf8"));
  const created = createTestFieldTrace({ traceDir: traceRoot });
  const store = new ArtifactStore(traceRoot);

  const context = buildCurrentContext(store, created.traceId, { profile });
  assert.equal(context.scene, "test://scenes/TestArena");
  assert.equal(context.latestSnapshot.player.hp, 2);
  assert.equal(context.errors.length, 0);
  assert.ok(context.importantEntities.find((entity) => entity.role === "player")?.matched);
  assert.ok(context.semanticEvents.some((event) => event.type === "player.hp_changed"));

  const result = runScenario({ store, traceId: created.traceId, profile, scenario });
  assert.equal(result.ok, true);
  assert.equal(result.failed, 0);
  assert.ok(fs.existsSync(created.evidencePath));

  const viewerPath = path.join(traceRoot, "viewer.html");
  const viewer = exportViewer({ store, traceId: created.traceId, profile, outputPath: viewerPath });
  assert.equal(viewer.evidence, 1);
  assert.ok(fs.readFileSync(viewerPath, "utf8").includes("player.hp_changed"));
});
