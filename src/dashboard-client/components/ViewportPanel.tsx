import { useState, memo, startTransition, useCallback, useRef, useEffect } from "react";
import { Monitor, Maximize2, Minimize2 } from "lucide-react";
import { getLiveFrameMjpegUrl, getLiveFrameUrl } from "../api";
import { useMjpegStream } from "../hooks/useMjpegStream";
import { FullscreenOverlay } from "./FullscreenOverlay";
import type { FrameMessage } from "../types";

interface ViewportPanelProps {
  captureEnabled: boolean;
  frame: FrameMessage | null;
  source: "runtime" | "editor";
  useMjpeg: boolean;
  onSourceChange: (source: "runtime" | "editor") => void;
  onPointer: (phase: string, event: MouseEvent | TouchEvent) => void;
}

function generateClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function logViewport(message: string, data?: Record<string, unknown>) {
  console.log(`[harness:viewport] ${message}`, data ?? "");
}

export const ViewportPanel = memo(function ViewportPanel({ captureEnabled, frame, source, useMjpeg: useMjpegSetting, onSourceChange, onPointer }: ViewportPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [mjpegFailed, setMjpegFailed] = useState(false);
  const [ripples, setRipples] = useState<Array<{ id: string; x: number; y: number }>>([]);
  const onPointerRef = useRef(onPointer);
  const clientId = useRef(generateClientId()).current;
  const imgNodeRef = useRef<HTMLImageElement | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevUseMjpegSettingRef = useRef(useMjpegSetting);

  onPointerRef.current = onPointer;

  const addRipple = useCallback((clientX: number, clientY: number) => {
    const container = imgNodeRef.current?.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const id = generateClientId();
    const ripple = {
      id,
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
    setRipples((prev) => [...prev, ripple]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 550);
  }, []);

  useEffect(() => {
    // Only re-enable MJPEG if the user toggled the setting back on.
    if (useMjpegSetting && !prevUseMjpegSettingRef.current) {
      setMjpegFailed(false);
      logViewport("MJPEG re-enabled by setting toggle", { source });
    }
    prevUseMjpegSettingRef.current = useMjpegSetting;
  }, [useMjpegSetting, source]);

  const effectiveUseMjpeg = useMjpegSetting && !mjpegFailed;

  const markMjpegFailed = useCallback((reason: string, details?: Record<string, unknown>) => {
    logViewport(`MJPEG failed (${reason}); switching to polling`, { clientId, source, fullscreen, ...details });
    setMjpegFailed(true);
  }, [source, fullscreen]);

  const handleImgError = useCallback(() => {
    markMjpegFailed("img onError");
  }, [markMjpegFailed]);

  const imgRef = useCallback((node: HTMLImageElement | null) => {
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
          markMjpegFailed("naturalWidth timeout", {
            src: img.src,
            complete: img.complete,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            readyState: img.readyState,
          });
        }
      }, 2500);
    }

    const handleMouseDown = (e: Event) => {
      const me = e as MouseEvent;
      e.preventDefault();
      addRipple(me.clientX, me.clientY);
      onPointerRef.current("pressed", me);
    };
    const handleMouseUp = (e: Event) => {
      const me = e as MouseEvent;
      e.preventDefault();
      onPointerRef.current("released", me);
    };
    const handleMouseMove = (e: Event) => {
      const me = e as MouseEvent;
      if (me.buttons > 0) {
        e.preventDefault();
        onPointerRef.current("moved", me);
      }
    };
    const handleTouchStart = (e: Event) => {
      const te = e as TouchEvent;
      e.preventDefault();
      const touch = te.touches[0] || te.changedTouches[0];
      if (touch) addRipple(touch.clientX, touch.clientY);
      onPointerRef.current("pressed", te);
    };
    const handleTouchEnd = (e: Event) => {
      const te = e as TouchEvent;
      e.preventDefault();
      onPointerRef.current("released", te);
    };
    const handleTouchMove = (e: Event) => {
      const te = e as TouchEvent;
      e.preventDefault();
      onPointerRef.current("moved", te);
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
  }, [effectiveUseMjpeg, markMjpegFailed]);

  const renderViewportContent = (imgUrl: string | null) => (
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
          ref={imgRef}
          src={imgUrl}
          alt={`${source} viewport`}
          onError={handleImgError}
          className="h-full w-full cursor-crosshair object-contain select-none pointer-events-auto touch-none"
        />
      )}
      {ripples.map((ripple) => (
        <div
          key={ripple.id}
          className="pointer-events-none absolute h-6 w-6 rounded-full border-2 border-white/70 bg-white/30 shadow-[0_0_8px_rgba(255,255,255,0.4)]"
          style={{
            left: ripple.x,
            top: ripple.y,
            animation: "ripple 500ms ease-out forwards",
          }}
        />
      ))}
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

  const { url: mjpegBlobUrl, failed: mjpegStreamFailed } = useMjpegStream(
    effectiveUseMjpeg && captureEnabled,
    getLiveFrameMjpegUrl(clientId),
  );

  useEffect(() => {
    if (mjpegStreamFailed) {
      markMjpegFailed("manual parser");
    }
  }, [mjpegStreamFailed, markMjpegFailed]);

  const imgUrl = captureEnabled
    ? effectiveUseMjpeg
      ? mjpegBlobUrl || (frame ? getLiveFrameUrl(frame.seq) : null)
      : frame
        ? getLiveFrameUrl(frame.seq)
        : null
    : null;

  useEffect(() => {
    logViewport("url computed", {
      mode: effectiveUseMjpeg ? "mjpeg-manual" : "polling",
      seq: frame?.seq,
      mjpegFailed,
      hasBlob: Boolean(mjpegBlobUrl),
    });
  }, [effectiveUseMjpeg, frame?.seq, mjpegFailed, mjpegBlobUrl]);

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
            {!fullscreen && renderViewportContent(imgUrl)}
          </div>
        </div>
      </section>
      {fullscreen && (
        <FullscreenOverlay title="Live Viewport" onClose={() => setFullscreen(false)}>
          {renderViewportContent(imgUrl)}
        </FullscreenOverlay>
      )}
    </>
  );
});
