import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestFieldTrace } from "../src/dev/test-field.js";
import { listResources, readResource } from "../src/mcp/resources.js";

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-res-project-"));
  fs.writeFileSync(path.join(root, "project.godot"), 'config_version=5\n\n[application]\n\nconfig/name="ResTest"\n', "utf8");
  fs.writeFileSync(path.join(root, "main.gd"), "extends Node2D\n", "utf8");
  fs.mkdirSync(path.join(root, "scenes"), { recursive: true });
  fs.writeFileSync(path.join(root, "scenes", "Main.tscn"), "[gd_scene format=3]\n", "utf8");
  fs.writeFileSync(path.join(root, "texture.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return root;
}

function makeCtx(traceDir, projectRoot) {
  return { godotPath: null, projectRoot, traceDir, profile: null, bridge: null };
}

test("listResources includes harness and godot resources", () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-res-"));
  const created = createTestFieldTrace({ traceDir });
  const projectRoot = makeProject();
  const resources = listResources(makeCtx(traceDir, projectRoot));
  const uris = resources.map((r) => r.uri);
  assert.ok(uris.includes("harness://traces"));
  assert.ok(uris.includes(`harness://trace/${created.traceId}/summary`));
  assert.ok(uris.includes(`harness://trace/${created.traceId}/context`));
  assert.ok(uris.includes("godot://project/info"));
  assert.ok(uris.includes("godot://project/config"));
});

test("readResource harness://traces round-trips", () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-res-"));
  const created = createTestFieldTrace({ traceDir });
  const result = readResource("harness://traces", makeCtx(traceDir, null));
  const data = JSON.parse(result.contents[0].text);
  assert.equal(data.traces.length, 1);
  assert.equal(data.traces[0].id, created.traceId);
});

test("readResource trace summary and context (latest)", () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-res-"));
  createTestFieldTrace({ traceDir });
  const ctx = makeCtx(traceDir, null);

  const summary = readResource("harness://trace/latest/summary", ctx);
  assert.match(summary.contents[0].text, /# Trace Summary/);
  assert.equal(summary.contents[0].mimeType, "text/markdown");

  const context = readResource("harness://trace/latest/context", ctx);
  const parsed = JSON.parse(context.contents[0].text);
  assert.equal(parsed.scene, "test://scenes/TestArena");
});

test("readResource godot project info and config", () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-res-"));
  const projectRoot = makeProject();
  const ctx = makeCtx(traceDir, projectRoot);

  const info = JSON.parse(readResource("godot://project/info", ctx).contents[0].text);
  assert.equal(info.name, "ResTest");

  const config = readResource("godot://project/config", ctx);
  assert.match(config.contents[0].text, /config_version=5/);
});

test("readResource godot://file reads project text files", () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-res-"));
  const projectRoot = makeProject();
  const result = readResource("godot://file/scenes/Main.tscn", makeCtx(traceDir, projectRoot));
  assert.match(result.contents[0].text, /gd_scene/);
});

test("readResource rejects path traversal", () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-res-"));
  const projectRoot = makeProject();
  const ctx = makeCtx(traceDir, projectRoot);
  assert.throws(() => readResource("godot://file/../secret.txt", ctx), /project root|traversal|rejected/i);
  assert.throws(() => readResource("godot://file/scenes/../../secret.txt", ctx), /project root|traversal|rejected/i);
});

test("readResource rejects absolute paths", () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-res-"));
  const projectRoot = makeProject();
  const ctx = makeCtx(traceDir, projectRoot);
  assert.throws(() => readResource("godot://file/C:/Windows/win.ini", ctx), /project root|traversal|rejected/i);
});

test("readResource rejects binary extensions", () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-res-"));
  const projectRoot = makeProject();
  const ctx = makeCtx(traceDir, projectRoot);
  assert.throws(() => readResource("godot://file/texture.png", ctx), /extension/i);
});

test("readResource rejects files over 256KB", () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-res-"));
  const projectRoot = makeProject();
  fs.writeFileSync(path.join(projectRoot, "big.txt"), Buffer.alloc(300 * 1024, 65));
  assert.throws(() => readResource("godot://file/big.txt", makeCtx(traceDir, projectRoot)), /256KB/);
});

test("readResource rejects unknown URIs", () => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "gah-mcp-res-"));
  const ctx = makeCtx(traceDir, null);
  assert.throws(() => readResource("harness://nope", ctx), /Unknown|Unsupported/);
  assert.throws(() => readResource("ftp://example.com/x", ctx), /Unknown|Unsupported/);
});
