import fs from "node:fs";
import path from "node:path";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ArtifactStore } from "../core/artifact-store.js";
import { resolveTraceId } from "../core/trace-reader.js";
import { buildSummary } from "../core/summary-builder.js";
import { buildCurrentContext } from "../core/context-builder.js";

const MAX_FILE_BYTES = 256 * 1024;

const BLOCKED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico",
  ".import", ".uid",
  ".res", ".scn", ".tres",
  ".ttf", ".otf", ".woff", ".woff2",
  ".wav", ".ogg", ".mp3", ".flac",
  ".mp4", ".webm", ".mov",
  ".zip", ".gz", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".bin",
]);

function makeResource(uri, name, description, mimeType) {
  return { uri, name, description, mimeType };
}

function textContent(uri, text, mimeType = "text/plain") {
  return { contents: [{ uri, text, mimeType }] };
}

function listTraceEntries(ctx) {
  const store = new ArtifactStore(ctx.traceDir);
  return store.listTraces().map(({ id, manifest }) => ({
    id,
    startedAt: manifest.startedAt ?? null,
    endedAt: manifest.endedAt ?? null,
    counts: manifest.counts ?? {},
  }));
}

function requireTraceId(store, rawId) {
  const traceId = resolveTraceId(store, rawId ?? "latest");
  if (!traceId) {
    throw new Error(`No traces found in ${store.rootDir}`);
  }
  return traceId;
}

function resolveProjectFile(projectRoot, relPath) {
  const root = path.resolve(projectRoot);
  const normalized = String(relPath).replace(/\\/g, "/");
  if (
    normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").includes("..")
  ) {
    throw new Error(`Path outside project root rejected: ${relPath}`);
  }
  const resolved = path.resolve(root, normalized);
  const rel = path.relative(root, resolved);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path outside project root rejected: ${relPath}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new Error(`Binary/blocked file extension rejected: ${ext}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${relPath}`);
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`File exceeds 256KB cap (${stat.size} bytes): ${relPath}`);
  }
  return resolved;
}

export function listResources(ctx) {
  const resources = [
    makeResource("harness://traces", "Harness traces", "JSON list of all traces in the harness trace directory.", "application/json"),
  ];

  for (const { id } of listTraceEntries(ctx)) {
    resources.push(
      makeResource(`harness://trace/${id}/summary`, `Trace summary: ${id}`, "Markdown summary of the trace.", "text/markdown"),
      makeResource(`harness://trace/${id}/context`, `Trace context: ${id}`, "Agent-facing context JSON for the trace.", "application/json"),
    );
  }

  if (ctx.projectRoot && fs.existsSync(path.join(path.resolve(ctx.projectRoot), "project.godot"))) {
    resources.push(
      makeResource("godot://project/info", "Godot project info", "Basic metadata about the Godot project at ctx.projectRoot.", "application/json"),
      makeResource("godot://project/config", "project.godot", "Raw project.godot configuration text.", "text/plain"),
    );
  }

  return resources;
}

export function readResource(uri, ctx) {
  const raw = String(uri);
  if (raw.includes("..")) {
    throw new Error(`Path traversal rejected in resource URI: ${raw}`);
  }
  const parsed = new URL(raw);

  if (parsed.protocol === "harness:") {
    const store = new ArtifactStore(ctx.traceDir);
    const parts = (parsed.pathname || parsed.host).split("/").filter(Boolean);
    const segments = parsed.host ? [parsed.host, ...parts] : parts;

    if (segments[0] === "traces") {
      return textContent(uri, JSON.stringify({ traceDir: store.rootDir, traces: listTraceEntries(ctx) }, null, 2), "application/json");
    }

    if (segments[0] === "trace" && segments.length === 3) {
      const traceId = requireTraceId(store, segments[1]);
      if (segments[2] === "summary") {
        return textContent(uri, buildSummary(store, traceId), "text/markdown");
      }
      if (segments[2] === "context") {
        const context = buildCurrentContext(store, traceId, { profile: ctx.profile ?? null });
        return textContent(uri, JSON.stringify(context, null, 2), "application/json");
      }
    }

    throw new Error(`Unknown harness resource: ${uri}`);
  }

  if (parsed.protocol === "godot:") {
    const projectRoot = ctx.projectRoot ? path.resolve(ctx.projectRoot) : null;
    if (!projectRoot || !fs.existsSync(path.join(projectRoot, "project.godot"))) {
      throw new Error("No Godot project available (ctx.projectRoot missing or has no project.godot)");
    }
    const parts = (parsed.pathname || "").split("/").filter(Boolean);
    const segments = parsed.host ? [parsed.host, ...parts] : parts;

    if (segments[0] === "project" && segments[1] === "info") {
      const configText = fs.readFileSync(path.join(projectRoot, "project.godot"), "utf8");
      const nameMatch = configText.match(/config\/name="([^"]*)"/);
      const info = {
        name: nameMatch ? nameMatch[1] : path.basename(projectRoot),
        root: projectRoot,
      };
      return textContent(uri, JSON.stringify(info, null, 2), "application/json");
    }

    if (segments[0] === "project" && segments[1] === "config") {
      return textContent(uri, fs.readFileSync(path.join(projectRoot, "project.godot"), "utf8"));
    }

    if (segments[0] === "file" && segments.length >= 2) {
      const relPath = segments.slice(1).join("/");
      const resolved = resolveProjectFile(projectRoot, relPath);
      return textContent(uri, fs.readFileSync(resolved, "utf8"));
    }

    throw new Error(`Unknown godot resource: ${uri}`);
  }

  throw new Error(`Unsupported resource URI scheme: ${uri}`);
}

export function attachResourceHandlers(server, ctx) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listResources(ctx),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
    readResource(request.params.uri, ctx),
  );
}
