import type {
  StatusResponse,
  GitStatus,
  FileTreeResponse,
  FileContentResponse,
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

export async function fetchFileTree(path: string): Promise<FileTreeResponse> {
  return apiGet<FileTreeResponse>("/files/tree?path=" + encodeURIComponent(path));
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

export function getLiveFrameUrl(seq?: number): string {
  return API_BASE + "/live/frame" + (seq != null ? `?seq=${seq}` : "");
}
