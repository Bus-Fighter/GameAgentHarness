import { Layers, Settings, Plug } from "lucide-react";

interface HeaderProps {
  connected: boolean;
  mode: "ws" | "fallback" | null;
  engineConnected: boolean;
  traceId: string | null;
  traceActive: boolean;
  paused: boolean;
  mcpRunning: boolean;
  onReconnect: () => void;
  onOpenSettings: () => void;
  onOpenMcp: () => void;
}

export function Header({
  connected,
  mode,
  engineConnected,
  traceId,
  traceActive,
  paused,
  mcpRunning,
  onReconnect,
  onOpenSettings,
  onOpenMcp,
}: HeaderProps) {
  const connectionText = connected
    ? mode === "fallback"
      ? "HTTP"
      : "Online"
    : mode === "fallback"
      ? "Polling"
      : "Offline";

  const traceText = traceId
    ? (traceActive ? "Active: " : "Idle: ") + traceId.slice(0, 8)
    : "No trace";

  return (
    <header
      className="sticky top-0 z-50 flex h-[var(--header-h)] flex-nowrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[rgba(15,23,42,0.96)] px-4 py-2 backdrop-blur"
      style={{ viewTransitionName: "persistent-header" }}
    >
      <div className="flex flex-shrink-0 items-center gap-2 text-sm font-semibold tracking-tight">
        <Layers className="h-5 w-5 text-[var(--accent)]" />
        <span className="hidden sm:inline">Game Agent Harness</span>
        <span className="sm:hidden">Harness</span>
      </div>
      <div className="flex flex-nowrap items-center justify-end gap-1.5 overflow-hidden">
        <button
          type="button"
          onClick={onReconnect}
          className={`inline-flex flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-[0.7rem] font-semibold ${
            connected
              ? "border-[rgba(34,197,94,0.3)] bg-[var(--accent-dim)] text-[var(--accent)]"
              : "border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] text-[var(--danger)]"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
          {connectionText}
        </button>
        {paused && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(245,158,11,0.3)] bg-[var(--warning-dim)] px-2 py-1 text-[0.7rem] font-semibold text-[var(--warning)]">
            Paused
          </span>
        )}
        <span
          className="inline-flex max-w-[110px] items-center gap-1.5 truncate rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[0.7rem] font-semibold text-[var(--muted)]"
          title={traceText}
        >
          {traceText}
        </span>
        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[0.7rem] font-semibold text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Settings</span>
        </button>
        <span
          className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[0.7rem] font-semibold ${
            engineConnected
              ? "border-[rgba(34,197,94,0.3)] bg-[var(--accent-dim)] text-[var(--accent)]"
              : "border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] text-[var(--danger)]"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {engineConnected ? "Engine" : "No engine"}
        </span>
        <button
          type="button"
          onClick={onOpenMcp}
          className={`inline-flex flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-[0.7rem] font-semibold ${
            mcpRunning
              ? "border-[rgba(34,197,94,0.3)] bg-[var(--accent-dim)] text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
          }`}
          title="MCP server"
        >
          <Plug className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">MCP</span>
        </button>
      </div>
    </header>
  );
}
