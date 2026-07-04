import { memo } from "react";
import { LayoutGrid, AlertCircle } from "lucide-react";
import { DockViewport } from "./DockViewport";
import type { HarnessDockInfo } from "../types";

interface DocksPanelProps {
  docks: HarnessDockInfo[];
  enabledDocks: string[];
  dockInterval: number;
  useMjpeg: boolean;
  dockFrames: Record<string, { seq: number; source: string; receivedAt: string; width?: number; height?: number } | null>;
  onToggleDock: (id: string) => void;
  onPointer: (dock: string, phase: string, event: MouseEvent | TouchEvent) => void;
}

export const DocksPanel = memo(function DocksPanel({
  docks,
  enabledDocks,
  dockInterval,
  useMjpeg,
  dockFrames,
  onToggleDock,
  onPointer,
}: DocksPanelProps) {
  return (
    <section className="card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          <LayoutGrid className="h-4 w-4" />
          Godot Docks
        </div>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--muted)]">
          {docks.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {docks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-[var(--muted)]">
            <AlertCircle className="h-8 w-8 text-[var(--surface-2)]" />
            <p>No docks reported by the Godot editor yet.</p>
            <p className="max-w-[320px] text-xs">
              Make sure the Game Agent Harness plugin is enabled in Godot and the editor window is visible. Tap refresh if you just opened a dock.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {docks.map((dock) => {
              const enabled = enabledDocks.includes(dock.id);
              const frame = dockFrames[dock.id] ?? null;
              return (
                <div key={dock.id} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--text)]">{dock.title}</span>
                    <button
                      type="button"
                      onClick={() => onToggleDock(dock.id)}
                      className={`relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors ${
                        enabled ? "bg-[var(--accent)]" : "bg-[var(--surface-2)]"
                      }`}
                      aria-pressed={enabled}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                          enabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                  <div className="h-48 min-h-0 sm:h-56">
                    <DockViewport
                      dockId={dock.id}
                      title={dock.title}
                      enabled={enabled}
                      interval={dockInterval}
                      useMjpeg={useMjpeg}
                      frame={frame}
                      onPointer={onPointer}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
});
