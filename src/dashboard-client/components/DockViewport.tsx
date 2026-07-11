import { useState, memo, startTransition, useCallback, useRef, useEffect } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { getLiveFrameMjpegUrl, getLiveFrameUrl } from "../api";
import { useMjpegStream } from "../hooks/useMjpegStream";
import { FullscreenOverlay } from "./FullscreenOverlay";
import { useVirtualCursor } from "../hooks/useVirtualCursor";
import { VirtualCursorOverlay } from "./VirtualCursorOverlay";
import type { FrameMessage } from "../types";

interface DockViewportProps {
  dockId: string;
  title: string;
  enabled: boolean;
  interval: number;
  useMjpeg: boolean;
  frame: FrameMessage | null;
  controlMode: "direct" | "cursor";
  onPointer: (dock: string, phase: string, event: MouseEvent | TouchEvent) => void;
  onPointerAt: (dock: string, phase: string, x: number, y: number, button: number, doubleClick: boolean, wheelDelta?: number) => void;
}

function generateClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const DockViewport = memo(function DockViewport({
  dockId,
  title,
  enabled,
  interval,
  useMjpeg,
  frame,
  controlMode,
  onPointer,
  onPointerAt,
}: DockViewportProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [mjpegFailed, setMjpegFailed] = useState(false);
  const onPointerRef = useRef(onPointer);
  const clientId = useRef(generateClientId()).current;
  const imgNodeRef = useRef<HTMLImageElement | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevUseMjpegSettingRef = useRef(useMjpeg);
  const source = `dock:${dockId}`;

  onPointerRef.current = onPointer;

  useEffect(() => {
    if (useMjpeg && !prevUseMjpegSettingRef.current) {
      setMjpegFailed(false);
    }
    prevUseMjpegSettingRef.current = useMjpeg;
  }, [useMjpeg]);

  useEffect(() => {
    if (!mjpegFailed || !useMjpeg) return;
    const timer = setTimeout(() => {
      setMjpegFailed(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, [mjpegFailed, useMjpeg]);

  const effectiveUseMjpeg = useMjpeg && !mjpegFailed;

  const markMjpegFailed = useCallback((reason: string) => {
    console.log(`[harness:dock:${dockId}] MJPEG failed (${reason}); switching to polling`);
    setMjpegFailed(true);
  }, [dockId]);

  const handleImgError = useCallback(() => {
    markMjpegFailed("img onError");
  }, [markMjpegFailed]);

  const imgRef = useCallback(
    (node: HTMLImageElement | null) => {
      imgNodeRef.current = node;
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      if (node === null) return;

      if (effectiveUseMjpeg) {
        fallbackTimerRef.current = setTimeout(() => {
          const img = imgNodeRef.current;
          if (img && (img.naturalWidth || 0) === 0) {
            markMjpegFailed("naturalWidth timeout");
          }
        }, 2500);
      }

      if (controlMode === "cursor") return;

      const handleMouseDown = (e: Event) => {
        const me = e as MouseEvent;
        e.preventDefault();
        onPointerRef.current(dockId, "pressed", me);
      };
      const handleMouseUp = (e: Event) => {
        const me = e as MouseEvent;
        e.preventDefault();
        onPointerRef.current(dockId, "released", me);
      };
      const handleMouseMove = (e: Event) => {
        const me = e as MouseEvent;
        if (me.buttons > 0) {
          e.preventDefault();
          onPointerRef.current(dockId, "moved", me);
        }
      };
      const handleTouchStart = (e: Event) => {
        const te = e as TouchEvent;
        e.preventDefault();
        onPointerRef.current(dockId, "pressed", te);
      };
      const handleTouchEnd = (e: Event) => {
        const te = e as TouchEvent;
        e.preventDefault();
        onPointerRef.current(dockId, "released", te);
      };
      const handleTouchMove = (e: Event) => {
        const te = e as TouchEvent;
        e.preventDefault();
        onPointerRef.current(dockId, "moved", te);
      };

      node.addEventListener("mousedown", handleMouseDown, { passive: false });
      node.addEventListener("mouseup", handleMouseUp, { passive: false });
      node.addEventListener("mousemove", handleMouseMove, { passive: false });
      node.addEventListener("touchstart", handleTouchStart, { passive: false });
      node.addEventListener("touchend", handleTouchEnd, { passive: false });
      node.addEventListener("touchmove", handleTouchMove, { passive: false });

      return () => {
        node.removeEventListener("mousedown", handleMouseDown);
        node.removeEventListener("mouseup", handleMouseUp);
        node.removeEventListener("mousemove", handleMouseMove);
        node.removeEventListener("touchstart", handleTouchStart);
        node.removeEventListener("touchend", handleTouchEnd);
        node.removeEventListener("touchmove", handleTouchMove);
      };
    },
    [effectiveUseMjpeg, markMjpegFailed, dockId, controlMode],
  );

  const virtualCursor = useVirtualCursor(
    controlMode,
    imgNodeRef,
    useCallback(
      (phase: string, x: number, y: number, button: number, doubleClick: boolean, wheelDelta?: number) => {
        onPointerAt(dockId, phase, x, y, button, doubleClick, wheelDelta);
      },
      [onPointerAt, dockId],
    ),
  );

  const renderContent = (imgUrl: string | null) => (
    <div
      ref={controlMode === "cursor" ? virtualCursor.surfaceRef : undefined}
      className={`relative h-full w-full bg-black ${controlMode === "cursor" ? "cursor-none touch-none select-none" : ""}`}
      style={controlMode === "cursor" ? { WebkitTouchCallout: "none" } : undefined}
      onContextMenu={controlMode === "cursor" ? (e) => e.preventDefault() : undefined}
    >
      {!imgUrl ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-4 text-center text-[var(--muted)]">
          <h3 className="text-sm font-semibold text-[var(--text)]">{enabled ? "No dock frame yet" : "Dock stream disabled"}</h3>
          <p className="max-w-[280px] text-xs leading-relaxed">
            {enabled
              ? "Enable this dock in the Docks tab and make sure the Godot editor window is visible."
              : "Tap the toggle above to start streaming this dock."}
          </p>
        </div>
      ) : null}
      {imgUrl && (
        <img
          ref={imgRef}
          src={imgUrl}
          alt={title}
          draggable={false}
          onError={handleImgError}
          className={`h-full w-full object-contain select-none ${
            controlMode === "cursor"
              ? "pointer-events-none touch-none"
              : "cursor-crosshair pointer-events-auto touch-none"
          }`}
        />
      )}
      {controlMode === "cursor" && (
        <VirtualCursorOverlay
          cursorStyle={virtualCursor.cursorStyle}
          dragLock={virtualCursor.dragLock}
          onToggleDragLock={() => virtualCursor.setDragLock((v) => !v)}
          actions={{
            click: virtualCursor.click,
            rightClick: virtualCursor.rightClick,
            doubleClick: virtualCursor.doubleClick,
            scroll: virtualCursor.scroll,
          }}
        />
      )}
    </div>
  );

  const { url: mjpegBlobUrl, failed: mjpegStreamFailed } = useMjpegStream(
    effectiveUseMjpeg && enabled,
    getLiveFrameMjpegUrl(clientId, source),
  );

  useEffect(() => {
    if (mjpegStreamFailed) {
      markMjpegFailed("manual parser");
    }
  }, [mjpegStreamFailed, markMjpegFailed]);

  const imgUrl = enabled
    ? effectiveUseMjpeg
      ? mjpegBlobUrl || (frame ? getLiveFrameUrl(frame.seq, source) : null)
      : frame
        ? getLiveFrameUrl(frame.seq, source)
        : null
    : null;

  return (
    <>
      <section className="card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
          <span className="truncate text-xs font-semibold text-[var(--text)]">{title}</span>
          <button
            type="button"
            onClick={() => startTransition(() => setFullscreen(true))}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
            title="Fullscreen"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-black">{!fullscreen && renderContent(imgUrl)}</div>
      </section>
      {fullscreen && (
        <FullscreenOverlay title={title} onClose={() => setFullscreen(false)}>
          {renderContent(imgUrl)}
        </FullscreenOverlay>
      )}
    </>
  );
});
