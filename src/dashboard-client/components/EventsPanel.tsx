import { useState, useMemo, memo, startTransition, ViewTransition } from "react";
import { Zap, ScrollText, Trash2 } from "lucide-react";
import { PanelHeaderActions } from "./PanelHeaderActions";
import { FullscreenOverlay } from "./FullscreenOverlay";
import type { DashboardSettings } from "../hooks/useSettings";
import type { HarnessEvent, HarnessLog } from "../types";

interface EventsPanelProps {
  events: HarnessEvent[];
  logs: HarnessLog[];
  fontSize?: number;
  logsEnabled?: boolean;
  logLevel?: DashboardSettings["logLevel"];
  onLogLevelChange?: (value: DashboardSettings["logLevel"]) => void;
  onClearLogs?: () => void;
}

function eventIcon(type: string) {
  if (type.startsWith("scene.")) return "scene";
  if (type.startsWith("input.action")) return "key";
  if (type.startsWith("input.")) return "input";
  if (type.startsWith("state.")) return "state";
  if (type.startsWith("runtime.")) return "runtime";
  if (type.startsWith("evidence.")) return "evidence";
  if (type.startsWith("validation")) return "validation";
  if (type.includes("error")) return "error";
  return "state";
}

function eventClass(type: string) {
  if (type.includes("error")) return "text-[var(--danger)]";
  if (type.startsWith("validation") && type.includes("fail"))
    return "text-[var(--danger)]";
  if (type.startsWith("validation")) return "text-[var(--accent)]";
  if (type.startsWith("evidence.")) return "text-[var(--info)]";
  if (type.startsWith("input.")) return "text-[var(--warning)]";
  return "";
}

function formatEventDetail(event: HarnessEvent) {
  const data = event.data || {};
  if (event.type.startsWith("input.pointer")) {
    return `x:${data.x ?? "?"} y:${data.y ?? "?"}`;
  }
  if (event.type.startsWith("input.action")) {
    return `key:${data.keycode ?? "?"}`;
  }
  if (event.type === "scene.changed") {
    return (data.scenePath as string) || "-";
  }
  if (event.type === "state.sampled") {
    return `root:${data.rootChildCount ?? "?"} scene:${data.currentSceneChildCount ?? "?"}`;
  }
  if (event.type.startsWith("evidence.")) {
    return (data.path as string) || "-";
  }
  if (event.type.startsWith("validation")) {
    return (data.message as string) || (data.name as string) || event.type;
  }
  return JSON.stringify(data).slice(0, 60);
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const LEVEL_ORDER: Record<HarnessLog["level"], number> = {
  verbose: 0,
  info: 1,
  warning: 2,
  error: 3,
};

function logClass(level: HarnessLog["level"]) {
  if (level === "error") return "text-[var(--danger)]";
  if (level === "warning") return "text-[var(--warning)]";
  if (level === "info") return "text-[var(--accent)]";
  return "text-[var(--muted)]";
}

function logBadgeClass(level: HarnessLog["level"]) {
  if (level === "error") return "border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] text-[var(--danger)]";
  if (level === "warning") return "border-[rgba(245,158,11,0.3)] bg-[var(--warning-dim)] text-[var(--warning)]";
  if (level === "info") return "border-[rgba(34,197,94,0.3)] bg-[var(--accent-dim)] text-[var(--accent)]";
  return "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]";
}

export const EventsPanel = memo(function EventsPanel({
  events,
  logs,
  fontSize = 14,
  logsEnabled = true,
  logLevel = "all",
  onLogLevelChange,
  onClearLogs,
}: EventsPanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<"events" | "logs">("events");
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const filteredLogs = useMemo(() => {
    if (logLevel === "all") return logs;
    return logs.filter((log) => LEVEL_ORDER[log.level] >= LEVEL_ORDER[logLevel]);
  }, [logs, logLevel]);

  const [selectedEvent, setSelectedEvent] = useState<HarnessEvent | null>(null);

  const reversedEvents = useMemo(() => [...events].reverse(), [events]);
  const reversedLogs = useMemo(() => [...filteredLogs].reverse(), [filteredLogs]);

  const eventsContent = (
    <div className="min-h-0 flex-1 overflow-auto p-0">
      {events.length === 0 ? (
        <div className="p-4 text-center text-sm text-[var(--muted)]">No events yet.</div>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {reversedEvents.map((ev) => (
            <li
              key={ev.seq}
              onClick={() => setSelectedEvent(ev)}
              className="flex cursor-pointer items-start gap-3 p-3 transition-colors hover:bg-[var(--surface-2)]"
              style={{ fontSize: `${fontSize}px` }}
            >
              <span className={`mt-0.5 text-xs font-semibold ${eventClass(ev.type)}`}>
                {eventIcon(ev.type)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[var(--text)]">{ev.type}</div>
                <div className="truncate text-xs text-[var(--muted)]" title={formatEventDetail(ev)}>
                  {formatEventDetail(ev)}
                </div>
              </div>
              <span className="text-xs text-[var(--muted)]">{formatTime(ev.receivedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const logsContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg)] p-2">
        <select
          value={logLevel}
          onChange={(e) => onLogLevelChange?.(e.target.value as DashboardSettings["logLevel"])}
          disabled={!logsEnabled}
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text)] outline-none disabled:opacity-35 focus:border-[var(--accent)]"
        >
          <option value="all">All levels</option>
          <option value="verbose">Verbose+</option>
          <option value="info">Info+</option>
          <option value="warning">Warning+</option>
          <option value="error">Error+</option>
        </select>
        <button
          type="button"
          onClick={onClearLogs}
          disabled={!logsEnabled}
          className="flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-0">
        {!logsEnabled ? (
          <div className="p-4 text-center text-sm text-[var(--muted)]">Log streaming is disabled in settings.</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-4 text-center text-sm text-[var(--muted)]">No logs yet.</div>
        ) : (
          <ul className="divide-y divide-[var(--border)] font-mono">
            {reversedLogs.map((log) => (
              <li
                key={log.seq}
                className="flex items-start gap-2 p-2 text-xs leading-relaxed"
                style={{ fontSize: `${fontSize}px` }}
              >
                <span className={`mt-0.5 flex-shrink-0 rounded border px-1 py-0.5 text-[0.65rem] font-bold uppercase ${logBadgeClass(log.level)}`}>
                  {log.level}
                </span>
                <span className={`flex-1 whitespace-pre-wrap break-all ${logClass(log.level)}`}>{log.message}</span>
                <span className="flex-shrink-0 text-[var(--muted)]">{formatTime(log.receivedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const content = activeSubTab === "events" ? eventsContent : logsContent;

  return (
    <>
      <section className="card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-[var(--muted)]" />
            <div className="flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
              <button
                type="button"
                onClick={() => setActiveSubTab("events")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeSubTab === "events"
                    ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                Events
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab("logs")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeSubTab === "logs"
                    ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                <ScrollText className="h-3.5 w-3.5" />
                Logs
                {logs.length > 0 && (
                  <span className="rounded-full bg-[var(--surface)] px-1 text-[0.65rem] text-[var(--muted)]">{logs.length}</span>
                )}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--muted)]">
              {activeSubTab === "events" ? events.length : filteredLogs.length}
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
          <div className="flex min-h-0 flex-col overflow-hidden">{content}</div>
        </div>
      </section>
      {fullscreen && (
        <ViewTransition enter="scale-in" exit="scale-out" default="none">
          <FullscreenOverlay title={activeSubTab === "events" ? "Event Stream" : "Engine Logs"} onClose={() => setFullscreen(false)}>
            <section className="flex h-full min-h-0 flex-col">{content}</section>
          </FullscreenOverlay>
        </ViewTransition>
      )}
      {selectedEvent && (
        <ViewTransition enter="scale-in" exit="scale-out" default="none">
          <FullscreenOverlay title={`Event #${selectedEvent.seq}`} onClose={() => setSelectedEvent(null)}>
            <div className="flex h-full flex-col gap-3 overflow-auto p-4" style={{ fontSize: `${fontSize}px` }}>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <span className="text-[var(--muted)]">Type</span>
                <span className="font-medium text-[var(--text)]">{selectedEvent.type}</span>
                <span className="text-[var(--muted)]">Source</span>
                <span className="text-[var(--text)]">{selectedEvent.source || "-"}</span>
                <span className="text-[var(--muted)]">Seq</span>
                <span className="text-[var(--text)]">{selectedEvent.seq}</span>
                <span className="text-[var(--muted)]">Time</span>
                <span className="text-[var(--text)]">{formatTime(selectedEvent.receivedAt)}</span>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                <pre className="whitespace-pre-wrap break-all font-mono text-xs text-[var(--text)]">
                  {JSON.stringify(selectedEvent.data ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          </FullscreenOverlay>
        </ViewTransition>
      )}
    </>
  );
});
