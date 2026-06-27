import { useState, useEffect, useCallback } from "react";
import { FileText, RefreshCw, GitBranch, FolderTree } from "lucide-react";
import { CodeEditor } from "./CodeEditor";
import {
  fetchGitStatus,
  fetchGitDiff,
  fetchFileTree,
  fetchFile,
  saveFile,
  gitStage,
  gitUnstage,
  gitReset,
} from "../api";
import type { GitFile, FileEntry } from "../types";

export function FileReviewPanel() {
  const [tab, setTab] = useState<"git" | "project">("git");
  const [gitFiles, setGitFiles] = useState<GitFile[]>([]);
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [diff, setDiff] = useState<string>("");
  const [editable, setEditable] = useState(false);
  const [autoSave, setAutoSave] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGit = useCallback(async () => {
    try {
      const data = await fetchGitStatus();
      setGitFiles(data.files);
    } catch (e) {
      setError("Git status failed: " + (e as Error).message);
    }
  }, []);

  const loadTree = useCallback(async (path = ".") => {
    try {
      const data = await fetchFileTree(path);
      setTree(data.entries);
    } catch (e) {
      setError("Could not load files: " + (e as Error).message);
    }
  }, []);

  useEffect(() => {
    loadGit();
    loadTree(".");
    const id = setInterval(loadGit, 5000);
    return () => clearInterval(id);
  }, [loadGit, loadTree]);

  const openFile = async (path: string, showDiff: boolean) => {
    setSelectedPath(path);
    setLoading(true);
    setError(null);
    try {
      const [file, diffRes] = await Promise.all([
        fetchFile(path),
        showDiff ? fetchGitDiff(path) : Promise.resolve({ diff: "" }),
      ]);
      setContent(file.content ?? "");
      setDiff(diffRes.diff);
    } catch (e) {
      setError("Could not load file: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedPath) return;
    try {
      await saveFile(selectedPath, content);
      if (tab === "git") await loadGit();
    } catch (e) {
      setError("Save failed: " + (e as Error).message);
    }
  };

  const handleGitAction = async (action: "stage" | "unstage" | "reset") => {
    if (!selectedPath) return;
    try {
      if (action === "stage") await gitStage(selectedPath);
      else if (action === "unstage") await gitUnstage(selectedPath);
      else await gitReset(selectedPath);
      await loadGit();
    } catch (e) {
      setError("Git action failed: " + (e as Error).message);
    }
  };

  useEffect(() => {
    if (!autoSave) return;
    const timer = setTimeout(() => {
      handleSave();
    }, 800);
    return () => clearTimeout(timer);
  }, [content, autoSave]);

  const statusClass = (status: string) => {
    if (status === "A" || status === "added") return "text-[var(--accent)] bg-[var(--accent-dim)]";
    if (status === "M" || status === "modified") return "text-[var(--warning)] bg-[var(--warning-dim)]";
    if (status === "D" || status === "deleted") return "text-[var(--danger)] bg-[var(--danger-dim)]";
    if (status === "?" || status === "untracked") return "text-[var(--info)] bg-[var(--info-dim)]";
    return "";
  };

  const statusLabel = (status: string) => {
    if (status === "A" || status === "added") return "A";
    if (status === "M" || status === "modified") return "M";
    if (status === "D" || status === "deleted") return "D";
    if (status === "?" || status === "untracked") return "U";
    return status;
  };

  return (
    <section className="card flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          <FileText className="h-4 w-4" />
          Code Review
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[0.7rem]">{gitFiles.length}</span>
        </div>
      </div>
      <div className="flex gap-2 border-b border-[var(--border)] bg-[var(--surface)] p-3">
        <button
          type="button"
          onClick={() => setTab("git")}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            tab === "git"
              ? "border-[rgba(34,197,94,0.4)] bg-[var(--accent-dim)] text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--bg)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
          }`}
        >
          <GitBranch className="h-4 w-4" />
          Git Changes
        </button>
        <button
          type="button"
          onClick={() => setTab("project")}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            tab === "project"
              ? "border-[rgba(34,197,94,0.4)] bg-[var(--accent-dim)] text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--bg)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
          }`}
        >
          <FolderTree className="h-4 w-4" />
          Project Files
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-[var(--border)] lg:grid-cols-[280px_1fr] lg:divide-x lg:divide-y-0">
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] p-2">
            <span className="flex-1 text-xs font-medium text-[var(--muted)]">{tab === "git" ? "Changed files" : "Project files"}</span>
            <button
              type="button"
              onClick={() => (tab === "git" ? loadGit() : loadTree("."))}
              className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {tab === "git"
              ? gitFiles.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => openFile(f.path, true)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-mono transition-colors hover:bg-[var(--surface-2)] ${
                      selectedPath === f.path ? "bg-[var(--accent-dim)] text-[var(--accent)]" : "text-[var(--text)]"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="flex-1 truncate">{f.path}</span>
                    <span className={`rounded px-1 py-0.5 text-[0.65rem] font-bold ${statusClass(f.worktreeStatus || f.indexStatus)}`}>
                      {statusLabel(f.worktreeStatus || f.indexStatus)}
                    </span>
                  </button>
                ))
              : tree.map((e) => (
                  <button
                    key={e.path}
                    type="button"
                    onClick={() => (e.type === "directory" ? loadTree(e.path) : openFile(e.path, false))}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-mono transition-colors hover:bg-[var(--surface-2)] ${
                      selectedPath === e.path ? "bg-[var(--accent-dim)] text-[var(--accent)]" : "text-[var(--text)]"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="flex-1 truncate">{e.name}</span>
                  </button>
                ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] p-2">
            <span className="flex-1 truncate font-mono text-xs text-[var(--text)]">{selectedPath ?? "-"}</span>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text)]">
              <input type="checkbox" checked={editable} onChange={(e) => setEditable(e.target.checked)} />
              Edit
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text)]">
              <input type="checkbox" checked={autoSave} onChange={(e) => setAutoSave(e.target.checked)} />
              Auto-save
            </label>
            <button
              type="button"
              onClick={handleSave}
              disabled={!editable}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] disabled:opacity-35"
            >
              Save
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {error && (
              <div className="m-3 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] p-3 text-xs text-[var(--danger)]">{error}</div>
            )}
            {loading && !content && <div className="p-4 text-center text-sm text-[var(--muted)]">Loading...</div>}
            {!selectedPath && !loading && (
              <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">Select a file to review.</div>
            )}
            {selectedPath && diff && !editable ? (
              <pre className="p-3 font-mono text-xs leading-relaxed">
                {diff.split("\n").map((line, i) => {
                  let color = "";
                  if (line.startsWith("+")) color = "text-green-400";
                  else if (line.startsWith("-")) color = "text-red-400";
                  else if (line.startsWith("@")) color = "text-[var(--muted)]";
                  return (
                    <div key={i} className={color}>
                      {line || " "}
                    </div>
                  );
                })}
              </pre>
            ) : null}
            {selectedPath && (editable || !diff) ? (
              <CodeEditor
                path={selectedPath}
                content={content}
                editable={editable}
                onChange={setContent}
              />
            ) : null}
          </div>
          {tab === "git" && selectedPath && (
            <div className="flex gap-2 border-t border-[var(--border)] p-2">
              <button
                type="button"
                onClick={() => handleGitAction("stage")}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:border-[var(--accent)]"
              >Stage</button>
              <button
                type="button"
                onClick={() => handleGitAction("unstage")}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:border-[var(--warning)]"
              >Unstage</button>
              <button
                type="button"
                onClick={() => handleGitAction("reset")}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--danger)] hover:border-[var(--danger)]"
              >Reset</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
