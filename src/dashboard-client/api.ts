import type {
  StatusResponse,
  GitStatus,
  FileTreeResponse,
  FileContentResponse,
  SearchResponse,
} from "./types";

const API_BASE = "/api";

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json() as Promise<T>;
}

export async function fetchStatus(): Promise<StatusResponse> {
  return apiGet<StatusResponse>("/status");
}

export async function fetchScenes(): Promise<{ ok: boolean; scenes: string[] }> {
  return apiGet<{ ok: boolean; scenes: string[] }>("/scenes");
}

export async function fetchGitStatus(): Promise<GitStatus> {
  return apiGet<GitStatus>("/git/status");
}

export async function fetchGitDiff(path: string): Promise<{ ok: boolean; diff: string }> {
  return apiGet<{ ok: boolean; diff: string }>("/git/diff?path=" + encodeURIComponent(path));
}

export async function fetchFileTree(path: string, ignore?: string[]): Promise<FileTreeResponse> {
  const params = new URLSearchParams({ path });
  if (ignore && ignore.length > 0) params.set("ignore", ignore.join(","));
  return apiGet<FileTreeResponse>("/files/tree?" + params.toString());
}

export async function fetchFile(path: string): Promise<FileContentResponse> {
  return apiGet<FileContentResponse>("/files?path=" + encodeURIComponent(path));
}

export async function saveFile(path: string, content: string): Promise<void> {
  const res = await fetch(API_BASE + "/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

export async function deleteFile(path: string): Promise<void> {
  const res = await fetch(API_BASE + "/files?path=" + encodeURIComponent(path), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

export async function createDirectory(path: string): Promise<void> {
  const res = await fetch(API_BASE + "/files/create-dir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

export async function searchFiles(
  query: string,
  path = ".",
  options: {
    content?: boolean;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    glob?: string;
    ignore?: string[];
  } = {},
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, path });
  if (options.content) params.set("content", "1");
  if (options.caseSensitive) params.set("case", "1");
  if (options.wholeWord) params.set("word", "1");
  if (options.glob) params.set("glob", options.glob);
  if (options.ignore && options.ignore.length > 0) params.set("ignore", options.ignore.join(","));
  return apiGet<SearchResponse>("/files/search?" + params.toString());
}

export async function gitStage(path: string): Promise<void> {
  const res = await fetch(API_BASE + "/git/stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

export async function gitUnstage(path: string): Promise<void> {
  const res = await fetch(API_BASE + "/git/unstage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

export async function gitReset(path: string): Promise<void> {
  const res = await fetch(API_BASE + "/git/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

export function getLiveFrameUrl(seq?: number, source?: string): string {
  const params = new URLSearchParams();
  if (seq != null) params.set("seq", String(seq));
  if (source) params.set("source", source);
  const query = params.toString();
  return API_BASE + "/live/frame" + (query ? `?${query}` : "");
}

export function getLiveFrameMjpegUrl(clientId?: string, source?: string): string {
  const params = new URLSearchParams();
  if (clientId) params.set("client", clientId);
  if (source) params.set("source", source);
  const query = params.toString();
  return API_BASE + "/live/frame.mjpeg" + (query ? `?${query}` : "");
}
