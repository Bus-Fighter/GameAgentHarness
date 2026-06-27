import { useState } from "react";
import { Activity } from "lucide-react";
import { PanelHeaderActions } from "./PanelHeaderActions";
import type { StatusResponse } from "../types";

interface DiagnosticsPanelProps {
  status: StatusResponse | null;
  mode: "ws" | "fallback" | null;
}

function formatTime(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function DiagnosticsPanel({ status, mode }: DiagnosticsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const latest = status?.latestFrame;
  const rows = [
    { key: "Intake URL", value: status?.intakeUrl ?? "-" },
    { key: "Engine clients", value: String(status?.engineClients ?? 0) },
    { key: "Last engine seen", value: formatTime(status?.lastEngineAt ?? null) },
    { key: "Dashboard clients", value: String(status?.dashboardClients ?? 0) },
    {
      key: "Latest frame",
      value: latest
        ? `${latest.width ?? "?"}x${latest.height ?? "?"} ${latest.source || ""}`
        : "-",
    },
    { key: "WebSocket mode", value: mode === "fallback" ? "HTTP polling" : "WebSocket" },
  ];

  return (
    <section className="card overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          <Activity className="h-4 w-4" />
          Connection Diagnostics
        </div>
        <PanelHeaderActions collapsed={collapsed} onToggleCollapse={() => setCollapsed((v) => !v)} allowFullscreen={false} />
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div className="grid grid-cols-1 gap-2 overflow-hidden p-3 sm:grid-cols-2">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5"
            >
              <span className="text-xs text-[var(--muted)]">{row.key}</span>
              <span className="max-w-[60%] truncate text-right text-xs font-medium text-[var(--text)]">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
