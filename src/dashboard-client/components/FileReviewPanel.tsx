import { useState, useEffect, useCallback, useMemo, startTransition, ViewTransition } from "react";
import {
  FileText,
  RefreshCw,
  GitBranch,
  FolderTree,
  Folder,
  ChevronLeft,
  Home,
  History,
} from "lucide-react";
import { CodeEditor } from "./CodeEditor";
import { DiffView } from "./DiffView";
import { GitHistoryPanel } from "./GitHistoryPanel";
import { PanelHeaderActions } from "./PanelHeaderActions";
import { FullscreenOverlay } from "./FullscreenOverlay";
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
import type { GitFile, FileEntry, ResourcePreview, ResourceImportSettings } from "../types";

interface FileReviewPanelProps {
  fontSize?: number;
  preview?: ResourcePreview | null;
  importSettings?: ResourceImportSettings | null;
  onRequestPreview?: (path: string) => void;
  onRequestImportSettings?: (path: string) => void;
}

function isResourcePath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".tscn") ||
    lower.endsWith(".tres") ||
    lower.endsWith(".material") ||
    lower.endsWith(".shader")
  );
}

export function FileReviewPanel({
  fontSize = 14,
  preview,
  importSettings,
  onRequestPreview,
  onRequestImportSettings,
}: FileReviewPanelProps) {
  const [tab, setTab] = useState<"git" | "project" | "history">("git");
  const [gitFiles, setGitFiles] = useState<GitFile[]>([]);
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState<string>(".");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [diff, setDiff] = useState<string>("");
  const [editable, setEditable] = useState(false);
  const [autoSave, setAutoSave] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

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
      setCurrentPath(data.path || path);
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
      if (!showDiff && isResourcePath(path)) {
        onRequestPreview?.(path);
        onRequestImportSettings?.(path);
      }
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
    if (status === "A" || status === "added")
      return "text-[var(--accent)] bg-[var(--accent-dim)]";
    if (status === "M" || status === "modified")
      return "text-[var(--warning)] bg-[var(--warning-dim)]";
    if (status === "D" || status === "deleted")
      return "text-[var(--danger)] bg-[var(--danger-dim)]";
    if (status === "?" || status === "untracked")
      return "text-[var(--info)] bg-[var(--info-dim)]";
    return "";
  };

  const statusLabel = (status: string) => {
    if (status === "A" || status === "added") return "A";
    if (status === "M" || status === "modified") return "M";
    if (status === "D" || status === "deleted") return "D";
    if (status === "?" || status === "untracked") return "U";
    return status;
  };

  const navigateUp = useCallback(() => {
    if (currentPath === "." || currentPath === "") return;
    const parts = currentPath.replace(/\\/g, "/").split("/").filter(Boolean);
    parts.pop();
    const parent = parts.length === 0 ? "." : parts.join("/");
    loadTree(parent);
  }, [currentPath, loadTree]);

  const breadcrumbs = useMemo(() => {
    if (currentPath === "." || currentPath === "")
      return [{ label: "Project", path: "." }];
    const parts = currentPath.replace(/\\/g, "/").split("/").filter(Boolean);
    return [
      { label: "Project", path: "." },
      ...parts.map((part, i) => ({
        label: part,
        path: parts.slice(0, i + 1).join("/"),
      })),
    ];
  }, [currentPath]);

  const fileReviewContent = (
    <>
      <div className="flex gap-2 border-b border-[var(--border)] bg-[var(--surface)] p-3">
        <button
          type="button"
          onClick={() => setTab("git")}
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
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
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            tab === "project"
              ? "border-[rgba(34,197,94,0.4)] bg-[var(--accent-dim)] text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--bg)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
          }`}
        >
          <FolderTree className="h-4 w-4" />
          Project Files
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            tab === "history"
              ? "border-[rgba(34,197,94,0.4)] bg-[var(--accent-dim)] text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--bg)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
          }`}
        >
          <History className="h-4 w-4" />
          Git History
        </button>
      </div>
      {tab === "history" ? (
        <GitHistoryPanel
          fontSize={fontSize}
          onOpenFileAtHead={(path) => {
            setTab("project");
            openFile(path, false);
          }}
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-[var(--border)] lg:grid-cols-[280px_1fr] lg:divide-x lg:divide-y-0">
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] p-2">
            {tab === "project" ? (
              <>
                <button
                  type="button"
                  onClick={navigateUp}
                  disabled={currentPath === "."}
                  title="Go up"
                  className="flex flex-shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Up
                </button>
                <div className="flex flex-1 items-center gap-1 overflow-x-auto text-xs">
                  {breadcrumbs.map((crumb, i) => (
                    <button
                      key={crumb.path}
                      type="button"
                      onClick={() => loadTree(crumb.path)}
                      className="flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
                    >
                      {i === 0 ? <Home className="h-3 w-3" /> : crumb.label}
                      {i < breadcrumbs.length - 1 && (
                        <span className="text-[var(--border)]">/</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <span className="flex-1 text-xs font-medium text-[var(--muted)]">
                Changed files
              </span>
            )}
            <button
              type="button"
              onClick={() => (tab === "git" ? loadGit() : loadTree(currentPath))}
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
                    className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-mono transition-colors hover:bg-[var(--surface-2)] ${
                      selectedPath === f.path
                        ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                        : "text-[var(--text)]"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="flex-1 truncate">{f.path}</span>
                    <span
                      className={`rounded px-1 py-0.5 text-[0.65rem] font-bold ${statusClass(
                        f.worktreeStatus || f.indexStatus,
                      )}`}
                    >
                      {statusLabel(f.worktreeStatus || f.indexStatus)}
                    </span>
                  </button>
                ))
              : tree.map((e) => (
                  <button
                    key={e.path}
                    type="button"
                    onClick={() =>
                      e.type === "directory"
                        ? loadTree(e.path)
                        : openFile(e.path, false)
                    }
                    className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-mono transition-colors hover:bg-[var(--surface-2)] ${
                      selectedPath === e.path
                        ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                        : "text-[var(--text)]"
                    }`}
                  >
                    {e.type === "directory" ? (
                      <Folder className="h-3.5 w-3.5 flex-shrink-0 text-[var(--warning)]" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                    )}
                    <span className="flex-1 truncate">{e.name}</span>
                  </button>
                ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] p-2">
            <span className="flex-1 truncate font-mono text-xs text-[var(--text)]">
              {selectedPath ?? "-"}
            </span>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text)]">
              <input
                type="checkbox"
                checked={editable}
                onChange={(e) => setEditable(e.target.checked)}
              />
              Edit
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text)]">
              <input
                type="checkbox"
                checked={autoSave}
                onChange={(e) => setAutoSave(e.target.checked)}
              />
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
              <div className="m-3 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] p-3 text-xs text-[var(--danger)]">
                {error}
              </div>
            )}
            {loading && !content && (
              <div className="p-4 text-center text-sm text-[var(--muted)]">
                Loading...
              </div>
            )}
            {!selectedPath && !loading && (
              <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
                Select a file to review.
              </div>
            )}
            {tab === "project" && selectedPath && (preview || importSettings) && (
              <div className="border-b border-[var(--border)] bg-[var(--bg)] p-3">
                {preview && (
                  <div className="mb-2">
                    {preview.ok && preview.previewUrl ? (
                      <img
                        src={preview.previewUrl}
                        alt={preview.path}
                        className="max-h-[200px] rounded-lg border border-[var(--border)] object-contain"
                      />
                    ) : preview.ok === false ? (
                      <div className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] p-2 text-xs text-[var(--danger)]">
                        Preview: {preview.error}
                      </div>
                    ) : null}
                  </div>
                )}
                {importSettings?.ok && importSettings.settings && (
                  <div className="space-y-2">
                    <div className="text-[0.65rem] uppercase tracking-wide text-[var(--muted)]">Import Settings</div>
                    {Object.entries(importSettings.settings).map(([section, kv]) => (
                      <div key={section} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
                        <div className="mb-1 text-xs font-semibold text-[var(--text)]">{section}</div>
                        <div className="grid grid-cols-[1fr_1fr] gap-x-2 gap-y-1 text-xs">
                          {Object.entries(kv).map(([k, v]) => (
                            <div key={k} className="contents">
                              <span className="truncate text-[var(--muted)]" title={k}>{k}</span>
                              <span className="truncate font-mono text-[var(--text)]" title={v}>{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {selectedPath && diff && !editable ? (
              <DiffView diff={diff} fontSize={fontSize} />
            ) : null}
            {selectedPath && (editable || !diff) ? (
              <CodeEditor
                path={selectedPath}
                content={content}
                editable={editable}
                onChange={setContent}
                fontSize={fontSize}
              />
            ) : null}
          </div>
          {tab === "git" && selectedPath && (
            <div className="flex gap-2 border-t border-[var(--border)] p-2">
              <button
                type="button"
                onClick={() => handleGitAction("stage")}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:border-[var(--accent)]"
              >
                Stage
              </button>
              <button
                type="button"
                onClick={() => handleGitAction("unstage")}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:border-[var(--warning)]"
              >
                Unstage
              </button>
              <button
                type="button"
                onClick={() => handleGitAction("reset")}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--danger)] hover:border-[var(--danger)]"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );

  return (
    <>
      <section className="card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            <FileText className="h-4 w-4" />
            Code Review
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[0.7rem]">
              {gitFiles.length}
            </span>
          </div>
          <PanelHeaderActions
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((v) => !v)}
            onFullscreen={() => startTransition(() => setFullscreen(true))}
          />
        </div>
        <div
          className={`grid min-h-0 transition-[grid-template-rows] duration-200 ease-in-out ${
            collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
          }`}
        >
          <div className="flex min-h-0 flex-col overflow-hidden">{fileReviewContent}</div>
        </div>
      </section>
      {fullscreen && (
        <ViewTransition enter="scale-in" exit="scale-out" default="none">
          <FullscreenOverlay
            title="Code Review"
            onClose={() => setFullscreen(false)}
          >
            <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              {fileReviewContent}
            </section>
          </FullscreenOverlay>
        </ViewTransition>
      )}
    </>
  );
}
