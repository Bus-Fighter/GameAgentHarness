import { useState } from "react";
import { Zap } from "lucide-react";
import { PanelHeaderActions } from "./PanelHeaderActions";
import type { HarnessEvent, HarnessLog } from "../types";

interface EvidenceItem {
  seq: number;
  type: string;
  receivedAt: string;
  url: string;
}

interface LiveActivityStripProps {
  events: HarnessEvent[];
  logs: HarnessLog[];
  evidence: EvidenceItem[];
  onEventClick: () => void;
  onEvidenceClick: () => void;
  onLogClick: () => void;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function LiveActivityStrip({
  events,
  logs,
  evidence,
  onEventClick,
  onEvidenceClick,
  onLogClick,
}: LiveActivityStripProps) {
  const [collapsed, setCollapsed] = useState(false);
  const latestEvent = events[events.length - 1];
  const latestLog = logs[logs.length - 1];
  const latestEvidence = evidence[evidence.length - 1];

  return (
    <section className="card overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          <Zap className="h-4 w-4" />
          Live Activity
        </div>
        <PanelHeaderActions collapsed={collapsed} onToggleCollapse={() => setCollapsed((v) => !v)} allowFullscreen={false} />
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div className="grid grid-cols-1 gap-3 overflow-hidden p-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={onEventClick}
            className="text-left rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 transition-colors hover:bg-[var(--surface-2)]"
          >
            <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Latest event</div>
            <div className="mt-1 text-sm font-medium text-[var(--text)]">
              {latestEvent ? latestEvent.type : "-"}
            </div>
            <div className="mt-1 text-xs text-[var(--muted)]">
              {latestEvent ? formatTime(latestEvent.receivedAt) : "No events"}
            </div>
          </button>

          <button
            type="button"
            onClick={onLogClick}
            className="text-left rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 transition-colors hover:bg-[var(--surface-2)]"
          >
            <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Latest log</div>
            <div className="mt-1 truncate text-sm font-medium text-[var(--text)]">
              {latestLog ? latestLog.message : "-"}
            </div>
            <div className="mt-1 text-xs text-[var(--muted)]">
              {latestLog ? formatTime(latestLog.receivedAt) : "No logs"}
            </div>
          </button>

          <button
            type="button"
            onClick={onEvidenceClick}
            className="text-left rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 transition-colors hover:bg-[var(--surface-2)]"
          >
            <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Latest evidence</div>
            <div className="mt-1 text-sm font-medium text-[var(--text)]">
              {latestEvidence ? latestEvidence.type : "-"}
            </div>
            <div className="mt-1 text-xs text-[var(--muted)]">
              {latestEvidence ? formatTime(latestEvidence.receivedAt) : "No evidence"}
            </div>
          </button>
        </div>
      </div>
    </section>
  );
}
