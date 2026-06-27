import { useState, memo, startTransition, ViewTransition } from "react";
import { Monitor, Maximize2, Minimize2 } from "lucide-react";
import { getLiveFrameUrl } from "../api";
import { FullscreenOverlay } from "./FullscreenOverlay";
import type { FrameMessage } from "../types";

interface ViewportPanelProps {
  captureEnabled: boolean;
  frame: FrameMessage | null;
  source: "runtime" | "editor";
  onSourceChange: (source: "runtime" | "editor") => void;
  onPointer: (phase: string, event: React.MouseEvent | React.TouchEvent) => void;
}

export const ViewportPanel = memo(function ViewportPanel({ captureEnabled, frame, source, onSourceChange, onPointer }: ViewportPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const imgUrl = frame && captureEnabled ? getLiveFrameUrl(frame.seq) : null;

  const viewportContent = (
    <div className="relative h-full w-full bg-black">
      {!imgUrl ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-4 text-center text-[var(--muted)]">
          <Monitor className="mb-1 h-9 w-9 text-[var(--surface-2)]" />
          <h3 className="text-base font-semibold text-[var(--text)]">
            {captureEnabled ? "No live frame yet" : "Capture paused"}
          </h3>
          <p className="max-w-[320px] text-xs leading-relaxed">
            {captureEnabled
              ? source === "runtime"
                ? "Enable the Game Agent Harness plugin in Godot, set intake URL to ws://127.0.0.1:8765, turn on Runtime capture, and run a scene."
                : "Enable editor viewport streaming in Settings, then select the 2D or 3D editor viewport."
              : source === "runtime"
                ? "Turn on Runtime capture to stream, or tap Snapshot to capture one frame."
                : "Editor viewport streaming is paused. Enable it in Settings."}
          </p>
        </div>
      ) : null}
      {imgUrl && (
        <img
          src={imgUrl}
          alt={`${source} viewport`}
          className="h-full w-full cursor-crosshair object-contain select-none pointer-events-auto touch-manipulation"
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
  );

  return (
    <>
      <section className={`card overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] ${collapsed ? "flex-shrink-0" : ""}`}>
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            <Monitor className="h-4 w-4" />
            Live Viewport
          </div>
          <div className="flex items-center gap-1">
            <div className="flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
              <button
                type="button"
                onClick={() => onSourceChange("runtime")}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  source === "runtime"
                    ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                Runtime
              </button>
              <button
                type="button"
                onClick={() => onSourceChange("editor")}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  source === "editor"
                    ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                Editor
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
              title={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => startTransition(() => setFullscreen(true))}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
              title="Fullscreen"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
            collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
          }`}
        >
          <div className="relative aspect-[16/10] max-h-[35vh] overflow-hidden bg-black lg:max-h-none">
            {viewportContent}
          </div>
        </div>
      </section>
      {fullscreen && (
        <ViewTransition enter="scale-in" exit="scale-out" default="none">
          <FullscreenOverlay title="Live Viewport" onClose={() => setFullscreen(false)}>
            {viewportContent}
          </FullscreenOverlay>
        </ViewTransition>
      )}
    </>
  );
});
