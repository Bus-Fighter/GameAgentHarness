import { useState, startTransition, ViewTransition } from "react";
import { Search, Radio, History, Trash2, RefreshCw, ChevronRight, ChevronDown, FolderTree } from "lucide-react";
import { PanelHeaderActions } from "./PanelHeaderActions";
import { FullscreenOverlay } from "./FullscreenOverlay";
import type { HarnessInspectorData, HarnessHistoryAction, HarnessSceneNode, HarnessNode } from "../types";

interface InspectPanelProps {
  inspector: HarnessInspectorData | null;
  history: HarnessHistoryAction[];
  sceneTree: HarnessSceneNode | null;
  selectedNodePath: string | null;
  fontSize?: number;
  inspectorEnabled?: boolean;
  signalsEnabled?: boolean;
  historyEnabled?: boolean;
  onClearHistory?: () => void;
  onNodeSelect?: (path: string) => void;
  onRefreshSceneTree?: () => void;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" || typeof value === "string") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[value]";
  }
}

function SceneTreeNode({
  node,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  node: HarnessSceneNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isSelected = node.path === selectedPath;

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => {
          onSelect(node.path);
          if (hasChildren) setExpanded((v) => !v);
        }}
        className={`flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs transition-colors ${
          isSelected ? "bg-[var(--accent-dim)] text-[var(--accent)]" : "text-[var(--text)] hover:bg-[var(--surface-2)]"
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted)]" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted)]" />
        ) : (
          <span className="h-3.5 w-3.5 flex-shrink-0" />
        )}
        <span className="truncate font-mono">{node.name}</span>
        <span className="ml-1 truncate text-[0.65rem] text-[var(--muted)]">{node.type}</span>
      </button>
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <SceneTreeNode key={child.path} node={child} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function SceneTree({
  root,
  selectedPath,
  onSelect,
  onRefresh,
}: {
  root: HarnessSceneNode | null;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-[var(--border)] bg-[var(--bg)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          <FolderTree className="h-3.5 w-3.5" />
          Scene
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
          title="Refresh scene tree"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {!root ? (
          <div className="p-2 text-center text-xs text-[var(--muted)]">No scene tree yet. Tap refresh.</div>
        ) : (
          <SceneTreeNode node={root} selectedPath={selectedPath} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}

export function InspectPanel({
  inspector,
  history,
  sceneTree,
  selectedNodePath,
  fontSize = 14,
  inspectorEnabled = true,
  signalsEnabled = true,
  historyEnabled = true,
  onClearHistory,
  onNodeSelect,
  onRefreshSceneTree,
}: InspectPanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<"properties" | "signals" | "history">("properties");
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);

  const selectNode = (path: string) => {
    onNodeSelect?.(path);
    setTreeOpen(false);
  };

  const propertiesContent = (
    <div className="min-h-0 flex-1 overflow-auto p-0">
      {!inspectorEnabled ? (
        <div className="p-4 text-center text-sm text-[var(--muted)]">Inspector is disabled in settings.</div>
      ) : !inspector ? (
        <div className="p-4 text-center text-sm text-[var(--muted)]">Select a node from the Scene tree to inspect it remotely.</div>
      ) : (
        <div className="space-y-3 p-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-[var(--muted)]">Node</div>
            <div className="font-medium text-[var(--text)]">{inspector.node.name}</div>
            <div className="font-mono text-xs text-[var(--muted)]">{inspector.node.type}</div>
            <div className="mt-1 break-all font-mono text-xs text-[var(--muted)]">{inspector.node.path}</div>
          </div>
          {inspector.properties.length === 0 ? (
            <div className="text-center text-sm text-[var(--muted)]">No exposed properties.</div>
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--bg)]">
              {inspector.properties.map((prop) => (
                <li key={prop.name} className="flex items-start justify-between gap-3 p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-[var(--text)]" title={prop.name}>{prop.name}</div>
                    <div className="truncate text-[0.65rem] text-[var(--muted)]">{prop.type}{prop.group ? ` · ${prop.group}` : ""}</div>
                  </div>
                  <div className="max-w-[60%] break-all text-right font-mono text-xs text-[var(--accent)]">{formatValue(prop.value)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  const signalsContent = (
    <div className="min-h-0 flex-1 overflow-auto p-0">
      {!signalsEnabled ? (
        <div className="p-4 text-center text-sm text-[var(--muted)]">Signal listing is disabled in settings.</div>
      ) : !inspector ? (
        <div className="p-4 text-center text-sm text-[var(--muted)]">Select a node from the Scene tree to see its signals.</div>
      ) : inspector.signals.length === 0 ? (
        <div className="p-4 text-center text-sm text-[var(--muted)]">No signals on this node.</div>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {inspector.signals.map((sig) => (
            <li key={sig.name} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-medium text-[var(--text)]">{sig.name}</div>
                {sig.args.length > 0 && (
                  <div className="mt-0.5 text-xs text-[var(--muted)]">Args: {sig.args.join(", ")}</div>
                )}
              </div>
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--muted)]">
                {sig.connectionCount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const historyContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg)] p-2">
        <button
          type="button"
          onClick={onClearHistory}
          disabled={!historyEnabled}
          className="flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-0">
        {!historyEnabled ? (
          <div className="p-4 text-center text-sm text-[var(--muted)]">Action history is disabled in settings.</div>
        ) : history.length === 0 ? (
          <div className="p-4 text-center text-sm text-[var(--muted)]">No actions recorded yet.</div>
        ) : (
          <ul className="divide-y divide-[var(--border)] font-mono">
            {[...history].reverse().map((entry) => (
              <li key={entry.seq} className="flex items-start gap-2 p-2 text-xs">
                <span className="mt-0.5 flex-shrink-0 rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5 text-[0.65rem] font-bold uppercase text-[var(--muted)]">
                  {entry.source}
                </span>
                <span className="flex-1 whitespace-pre-wrap break-all text-[var(--text)]">{entry.action}</span>
                <span className="flex-shrink-0 text-[var(--muted)]">{formatTime(entry.receivedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const content =
    activeSubTab === "properties" ? propertiesContent : activeSubTab === "signals" ? signalsContent : historyContent;

  const contentPanel = (
    <section className="card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-[var(--muted)]" />
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
            <button
              type="button"
              onClick={() => setActiveSubTab("properties")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                activeSubTab === "properties"
                  ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Properties
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab("signals")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                activeSubTab === "signals"
                  ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              <Radio className="h-3.5 w-3.5" />
              Signals
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab("history")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                activeSubTab === "history"
                  ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              <History className="h-3.5 w-3.5" />
              History
              {history.length > 0 && (
                <span className="rounded-full bg-[var(--surface)] px-1 text-[0.65rem] text-[var(--muted)]">{history.length}</span>
              )}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTreeOpen(true)}
            className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] lg:hidden"
          >
            <FolderTree className="h-3.5 w-3.5" />
            Scene
          </button>
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--muted)]">
            {activeSubTab === "properties"
              ? inspector?.properties.length ?? 0
              : activeSubTab === "signals"
                ? inspector?.signals.length ?? 0
                : history.length}
          </span>
          <PanelHeaderActions
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((v) => !v)}
            onFullscreen={() => startTransition(() => setFullscreen(true))}
          />
        </div>
      </div>
      <div
        className={`grid min-h-0 transition-[grid-template-rows] duration-200 ease-in-out ${
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div className="flex min-h-0 flex-col overflow-hidden" style={{ fontSize: `${fontSize}px` }}>{content}</div>
      </div>
    </section>
  );

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 lg:grid lg:grid-cols-[minmax(240px,280px)_1fr] lg:gap-4">
        <div className="hidden min-h-0 lg:block">
          <SceneTree root={sceneTree} selectedPath={selectedNodePath} onSelect={selectNode} onRefresh={onRefreshSceneTree ?? (() => {})} />
        </div>
        {contentPanel}
      </div>
      {treeOpen && (
        <ViewTransition enter="scale-in" exit="scale-out" default="none">
          <FullscreenOverlay title="Scene Tree" onClose={() => setTreeOpen(false)}>
            <SceneTree root={sceneTree} selectedPath={selectedNodePath} onSelect={selectNode} onRefresh={onRefreshSceneTree ?? (() => {})} />
          </FullscreenOverlay>
        </ViewTransition>
      )}
      {fullscreen && (
        <ViewTransition enter="scale-in" exit="scale-out" default="none">
          <FullscreenOverlay
            title={activeSubTab === "properties" ? "Inspector" : activeSubTab === "signals" ? "Signals" : "Action History"}
            onClose={() => setFullscreen(false)}
          >
            <section className="flex h-full min-h-0 flex-col">{content}</section>
          </FullscreenOverlay>
        </ViewTransition>
      )}
    </>
  );
}
