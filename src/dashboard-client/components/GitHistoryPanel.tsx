import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Gitgraph,
  templateExtend,
  TemplateName,
  Orientation,
  MergeStyle,
} from "@gitgraph/react";
import {
  GitBranch,
  History,
  RefreshCw,
  ChevronLeft,
  FileText,
  User,
  Clock,
  ExternalLink,
} from "lucide-react";
import { fetchGitLog, fetchGitCommit } from "../api";
import type { GitCommit, CommitFile } from "../types";
import { DiffView } from "./DiffView";

const ACCENT = "#22c55e";
const INFO = "#3b82f6";
const WARNING = "#f59e0b";
const DANGER = "#ef4444";
const PURPLE = "#a855f7";
const TEXT = "#f8fafc";
const SURFACE = "#0f172a";
const SURFACE2 = "#1e293b";
const BORDER = "rgba(148, 163, 184, 0.15)";

interface GitHistoryPanelProps {
  fontSize?: number;
  onOpenFileAtHead?: (path: string) => void;
}

interface CommitDetail {
  meta: {
    hash: string;
    author: string;
    email: string;
    date: string | null;
    subject: string;
  };
  files: CommitFile[];
}

function toGitgraphData(commits: GitCommit[]) {
  return commits.map((c) => ({
    refs: c.refs.map((r) => (r.type === "tag" ? `tag: ${r.name}` : r.name)),
    hash: c.hash,
    hashAbbrev: c.hash.slice(0, 7),
    tree: "",
    treeAbbrev: "",
    parents: c.parents,
    parentsAbbrev: c.parents.map((p) => p.slice(0, 7)),
    author: {
      name: c.author,
      email: c.email,
      timestamp: c.date ? new Date(c.date).getTime() : 0,
    },
    committer: {
      name: c.author,
      email: c.email,
      timestamp: c.date ? new Date(c.date).getTime() : 0,
    },
    subject: c.subject,
    body: "",
    notes: "",
    stats: [],
  }));
}

function formatDate(iso: string | null) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function refBadgeClass(type: string) {
  if (type === "tag") return "text-[var(--info)] bg-[var(--info-dim)]";
  if (type === "head") return "text-[var(--warning)] bg-[var(--warning-dim)]";
  return "text-[var(--accent)] bg-[var(--accent-dim)]";
}

function fileStatusClass(status: string) {
  if (status === "A" || status === "added") return "text-[var(--accent)] bg-[var(--accent-dim)]";
  if (status === "M" || status === "modified") return "text-[var(--warning)] bg-[var(--warning-dim)]";
  if (status === "D" || status === "deleted") return "text-[var(--danger)] bg-[var(--danger-dim)]";
  if (status === "R" || status === "renamed") return "text-[var(--info)] bg-[var(--info-dim)]";
  return "";
}

function fileStatusLabel(status: string) {
  if (status === "A") return "A";
  if (status === "M") return "M";
  if (status === "D") return "D";
  if (status === "R") return "R";
  if (status === "??") return "U";
  return status;
}

export function GitHistoryPanel({ fontSize = 14, onOpenFileAtHead }: GitHistoryPanelProps) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branch, setBranch] = useState<string>("HEAD");
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"commits" | "files" | "diff">("commits");
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);

  const template = useMemo(
    () =>
      templateExtend(TemplateName.Metro, {
        colors: [ACCENT, INFO, WARNING, DANGER, PURPLE],
        branch: {
          lineWidth: 2,
          mergeStyle: MergeStyle.Bezier,
          label: {
            display: true,
            color: TEXT,
            strokeColor: BORDER,
            bgColor: SURFACE2,
            font: "normal 10px ui-monospace, monospace",
            borderRadius: 4,
          },
        },
        commit: {
          spacing: 44,
          color: TEXT,
          dot: { size: 5, color: ACCENT, strokeColor: SURFACE, strokeWidth: 1 },
          message: {
            display: true,
            displayAuthor: false,
            displayHash: false,
            color: TEXT,
            font: "normal 12px ui-monospace, monospace",
          },
        },
        tag: {
          color: TEXT,
          strokeColor: BORDER,
          bgColor: SURFACE2,
          font: "normal 10px ui-monospace, monospace",
          borderRadius: 4,
          pointerWidth: 6,
        },
      }),
    [],
  );

  const graphData = useMemo(() => toGitgraphData(commits), [commits]);
  const graphKey = useMemo(() => {
    if (commits.length === 0) return "empty";
    return `${commits[0]?.hash.slice(0, 8)}-${commits[commits.length - 1]?.hash.slice(0, 8)}`;
  }, [commits]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGitLog({ branch, limit, skip });
      if (!data.ok) throw new Error("git log failed");
      setCommits(data.commits);
      setBranch(data.branch);
      setTotal(data.total);
      setSelectedCommit((prev) => {
        if (!prev) return null;
        const stillHere = data.commits.find((c) => c.hash === prev.hash);
        return stillHere ?? null;
      });
    } catch (e) {
      setError("Git history failed: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [branch, limit, skip]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const selectCommit = async (commit: GitCommit) => {
    setSelectedCommit(commit);
    setSelectedFile(null);
    setDiff("");
    setView("files");
    setLoadingDetail(true);
    setError(null);
    try {
      const data = await fetchGitCommit(commit.hash);
      if (!data.ok) throw new Error("git commit failed");
      setDetail({ meta: data.meta, files: data.files });
    } catch (e) {
      setError("Commit detail failed: " + (e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const selectFile = async (path: string) => {
    if (!selectedCommit) return;
    setSelectedFile(path);
    setView("diff");
    setLoadingDetail(true);
    setError(null);
    try {
      const data = await fetchGitCommit(selectedCommit.hash, path);
      if (!data.ok) throw new Error("git diff failed");
      setDiff(data.diff);
    } catch (e) {
      setError("Diff failed: " + (e as Error).message);
      setDiff("");
    } finally {
      setLoadingDetail(false);
    }
  };

  const canGoBack = view === "files" || view === "diff";
  const goBack = () => {
    if (view === "diff") {
      setView("files");
      setSelectedFile(null);
      setDiff("");
    } else if (view === "files") {
      setView("commits");
      setSelectedCommit(null);
      setDetail(null);
      setSelectedFile(null);
      setDiff("");
    }
  };

  const pageStart = total === 0 ? 0 : skip + 1;
  const pageEnd = Math.min(skip + limit, total);
  const canPrev = skip > 0;
  const canNext = skip + limit < total;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-[var(--border)] lg:grid-cols-[320px_1fr] lg:divide-x lg:divide-y-0">
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] p-2">
          <GitBranch className="h-4 w-4 text-[var(--accent)]" />
          <span className="flex-1 truncate text-xs font-medium text-[var(--muted)]">
            {branch}
          </span>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)] disabled:opacity-35"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[var(--surface)] p-2">
          {commits.length === 0 && !loading ? (
            <div className="p-4 text-center text-sm text-[var(--muted)]">No history found.</div>
          ) : (
            <Gitgraph key={graphKey} options={{ orientation: Orientation.VerticalReverse, template }}>
              {(gitgraph) => {
                gitgraph.import(graphData);
              }}
            </Gitgraph>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] p-2">
          {canGoBack && (
            <button
              type="button"
              onClick={goBack}
              className="flex flex-shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>
          )}
          <span className="flex-1 truncate text-xs font-medium text-[var(--muted)]">
            {view === "commits" && `Commits ${pageStart}–${pageEnd} of ${total}`}
            {view === "files" && selectedCommit && (
              <span className="font-mono text-[var(--text)]">{selectedCommit.subject}</span>
            )}
            {view === "diff" && selectedFile && (
              <span className="font-mono text-[var(--text)]">{selectedFile}</span>
            )}
          </span>
          {view === "diff" && selectedFile && (
            <button
              type="button"
              onClick={() => onOpenFileAtHead?.(selectedFile)}
              className="flex flex-shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open at HEAD
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {error && (
            <div className="m-3 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] p-3 text-xs text-[var(--danger)]">
              {error}
            </div>
          )}

          {view === "commits" && (
            <div className="space-y-1">
              {commits.map((c) => (
                <button
                  key={c.hash}
                  type="button"
                  onClick={() => selectCommit(c)}
                  className={`flex w-full cursor-pointer flex-col gap-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--surface-2)] ${
                    selectedCommit?.hash === c.hash
                      ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                      : "text-[var(--text)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted)]" />
                    <span className="flex-1 truncate font-mono">{c.subject}</span>
                    <span className="font-mono text-[0.65rem] text-[var(--muted)]">{c.hash.slice(0, 7)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {c.refs.map((r, i) => (
                      <span
                        key={`${r.type}-${r.name}-${i}`}
                        className={`rounded px-1 py-0.5 text-[0.6rem] font-bold ${refBadgeClass(r.type)}`}
                      >
                        {r.name}
                      </span>
                    ))}
                    <span className="flex items-center gap-1 text-[0.65rem] text-[var(--muted)]">
                      <User className="h-3 w-3" /> {c.author}
                    </span>
                    <span className="flex items-center gap-1 text-[0.65rem] text-[var(--muted)]">
                      <Clock className="h-3 w-3" /> {formatDate(c.date)}
                    </span>
                  </div>
                </button>
              ))}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  disabled={!canPrev}
                  onClick={() => setSkip((s) => Math.max(0, s - limit))}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] disabled:opacity-35"
                >
                  Previous
                </button>
                <span className="text-xs text-[var(--muted)]">
                  {pageStart}–{pageEnd} of {total}
                </span>
                <button
                  type="button"
                  disabled={!canNext}
                  onClick={() => setSkip((s) => s + limit)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] disabled:opacity-35"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {view === "files" && selectedCommit && (
            <div className="space-y-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="mb-1 font-mono text-sm text-[var(--text)]">{selectedCommit.subject}</div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                  <span className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5" /> {selectedCommit.author}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> {formatDate(selectedCommit.date)}
                  </span>
                  <span className="font-mono">{selectedCommit.hash.slice(0, 7)}</span>
                </div>
              </div>
              {loadingDetail && <div className="p-2 text-center text-xs text-[var(--muted)]">Loading files…</div>}
              <div className="space-y-1">
                {detail?.files.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => selectFile(f.path)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-mono transition-colors hover:bg-[var(--surface-2)] text-[var(--text)]"
                  >
                    <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="flex-1 truncate">{f.path}</span>
                    <span
                      className={`rounded px-1 py-0.5 text-[0.65rem] font-bold ${fileStatusClass(f.status)}`}
                    >
                      {fileStatusLabel(f.status)}
                    </span>
                  </button>
                ))}
                {!loadingDetail && detail?.files.length === 0 && (
                  <div className="p-2 text-center text-xs text-[var(--muted)]">No files changed.</div>
                )}
              </div>
            </div>
          )}

          {view === "diff" && selectedFile && (
            <div className="flex h-full min-h-0 flex-col">
              {loadingDetail && <div className="p-2 text-center text-xs text-[var(--muted)]">Loading diff…</div>}
              <div className="min-h-0 flex-1 overflow-auto">
                <DiffView diff={diff} fontSize={fontSize} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
