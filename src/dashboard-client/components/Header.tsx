import { Layers } from "lucide-react";

interface HeaderProps {
  connected: boolean;
  mode: "ws" | "fallback" | null;
  engineConnected: boolean;
  traceId: string | null;
  traceActive: boolean;
  paused: boolean;
  onReconnect: () => void;
}

export function Header({
  connected,
  mode,
  engineConnected,
  traceId,
  traceActive,
  paused,
  onReconnect,
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
    <header className="sticky top-0 z-50 flex min-h-[var(--header-h)] items-center justify-between gap-3 border-b border-[var(--border)] bg-[rgba(15,23,42,0.96)] px-4 py-2 backdrop-blur">
      <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <Layers className="h-5 w-5 text-[var(--accent)]" />
        <span className="hidden sm:inline">Game Agent Harness</span>
        <span className="sm:hidden">Harness</span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onReconnect}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[0.7rem] font-semibold ${
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
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[0.7rem] font-semibold ${
            engineConnected
              ? "border-[rgba(34,197,94,0.3)] bg-[var(--accent-dim)] text-[var(--accent)]"
              : "border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] text-[var(--danger)]"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {engineConnected ? "Engine" : "No engine"}
        </span>
      </div>
    </header>
  );
}
