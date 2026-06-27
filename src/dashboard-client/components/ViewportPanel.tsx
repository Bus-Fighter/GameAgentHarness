import { Monitor } from "lucide-react";
import { getLiveFrameUrl } from "../api";
import type { FrameMessage } from "../types";

interface ViewportPanelProps {
  captureEnabled: boolean;
  frame: FrameMessage | null;
  onPointer: (phase: string, event: React.MouseEvent | React.TouchEvent) => void;
}

export function ViewportPanel({ captureEnabled, frame, onPointer }: ViewportPanelProps) {
  const imgUrl = frame && captureEnabled ? getLiveFrameUrl() : null;

  return (
    <section className="card overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          <Monitor className="h-4 w-4" />
          Live Viewport
        </div>
      </div>
      <div className="relative aspect-[16/10] max-h-[35vh] bg-black lg:max-h-none">
        {!imgUrl ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-4 text-center text-[var(--muted)]">
            <Monitor className="mb-1 h-9 w-9 text-[var(--surface-2)]" />
            <h3 className="text-base font-semibold text-[var(--text)]">
              {captureEnabled ? "No live frame yet" : "Capture paused"}
            </h3>
            <p className="max-w-[320px] text-xs leading-relaxed">
              {captureEnabled
                ? "Enable the Game Agent Harness plugin in Godot, set intake URL to ws://127.0.0.1:8765, turn on Runtime capture, and run a scene."
                : "Turn on Runtime capture to stream, or tap Snapshot to capture one frame."}
            </p>
          </div>
        ) : null}
        {imgUrl && (
          <img
            src={imgUrl}
            alt="Live viewport"
            className="h-full w-full cursor-crosshair object-contain touch-none select-none"
            onMouseDown={(e) => onPointer("pressed", e)}
            onMouseUp={(e) => onPointer("released", e)}
            onMouseMove={(e) => {
              if (e.buttons > 0) onPointer("moved", e);
            }}
            onTouchStart={(e) => onPointer("pressed", e)}
            onTouchEnd={(e) => onPointer("released", e)}
            onTouchMove={(e) => onPointer("moved", e)}
          />
        )}
        {imgUrl && frame && (
          <div className="absolute bottom-2.5 left-2.5 right-2.5 flex flex-wrap gap-1.5">
            <span className="rounded bg-[rgba(15,23,42,0.8)] px-2 py-0.5 text-[0.7rem] text-[var(--text)]">#{frame.seq}</span>
            <span className="rounded bg-[rgba(15,23,42,0.8)] px-2 py-0.5 text-[0.7rem] text-[var(--text)]">{frame.source || "viewport"}</span>
            <span className="rounded bg-[rgba(15,23,42,0.8)] px-2 py-0.5 text-[0.7rem] text-[var(--text)]">{frame.width ?? "?"}x{frame.height ?? "?"}</span>
            <span className="rounded bg-[rgba(15,23,42,0.8)] px-2 py-0.5 text-[0.7rem] text-[var(--text)]">{new Date(frame.receivedAt).toLocaleTimeString()}</span>
          </div>
        )}
      </div>
    </section>
  );
}
