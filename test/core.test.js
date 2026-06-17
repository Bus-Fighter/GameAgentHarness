import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ArtifactStore } from "../src/core/artifact-store.js";
import { TraceSession } from "../src/core/trace-session.js";
import { buildSummary } from "../src/core/summary-builder.js";

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
