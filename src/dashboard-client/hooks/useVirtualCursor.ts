import { useState, useRef, useEffect, useCallback, useMemo } from "react";

const TAPPER_MAX_PX = 20;
const TAP_MAX_MS = 300;
const DOUBLE_TAP_MAX_MS = 400;

export interface VirtualCursorLayout {
  renderedWidth: number;
  renderedHeight: number;
  offsetX: number;
  offsetY: number;
}

export interface VirtualCursorPosition {
  x: number;
  y: number;
}

export interface VirtualCursorActions {
  click: () => void;
  rightClick: () => void;
  doubleClick: () => void;
  scroll: (delta: number) => void;
}

export function useVirtualCursor(
  controlMode: "direct" | "cursor",
  imageRef: React.RefObject<HTMLImageElement | null>,
  emit: (phase: string, x: number, y: number, button: number, doubleClick: boolean, wheelDelta?: number) => void,
): {
  cursorPos: VirtualCursorPosition;
  cursorStyle: React.CSSProperties;
  dragLock: boolean;
  setDragLock: (value: boolean) => void;
  surfaceRef: (node: HTMLElement | null) => void;
} & VirtualCursorActions {
  const [cursorPos, setCursorPos] = useState<VirtualCursorPosition>({ x: 0.5, y: 0.5 });
  const [layout, setLayout] = useState<VirtualCursorLayout | null>(null);
  const [dragLock, setDragLock] = useState(true);
  const [surfaceNode, setSurfaceNode] = useState<HTMLElement | null>(null);

  const trackingRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    startTime: number;
  } | null>(null);
  const pendingMoveRef = useRef<{ x: number; y: number; button: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; count: number } | null>(null);

  const flushMove = useCallback(() => {
    const pending = pendingMoveRef.current;
    if (pending) {
      emit("moved", pending.x, pending.y, pending.button, false);
      pendingMoveRef.current = null;
    }
    rafRef.current = null;
  }, [emit]);

  const scheduleMove = useCallback(
    (x: number, y: number, button: number) => {
      pendingMoveRef.current = { x, y, button };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flushMove);
      }
    },
    [flushMove],
  );

  const measureLayout = useCallback(() => {
    const container = surfaceNode;
    const img = imageRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const naturalWidth = img?.naturalWidth || rect.width;
    const naturalHeight = img?.naturalHeight || rect.height;
    const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
    const renderedWidth = naturalWidth * scale;
    const renderedHeight = naturalHeight * scale;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;
    return { renderedWidth, renderedHeight, offsetX, offsetY };
  }, [imageRef, surfaceNode]);

  const updateLayout = useCallback(() => {
    const next = measureLayout();
    if (next) setLayout(next);
  }, [measureLayout]);

  const clampNorm = (value: number) => Math.max(0, Math.min(1, value));

  const moveCursorByDelta = useCallback(
    (dxPx: number, dyPx: number) => {
      const layout = measureLayout();
      if (!layout) return;
      const { renderedWidth, renderedHeight } = layout;
      if (renderedWidth <= 0 || renderedHeight <= 0) return;
      setCursorPos((prev) => {
        const next = {
          x: clampNorm(prev.x + dxPx / renderedWidth),
          y: clampNorm(prev.y + dyPx / renderedHeight),
        };
        scheduleMove(next.x, next.y, dragLock ? 1 : 0);
        return next;
      });
    },
    [measureLayout, dragLock, scheduleMove],
  );

  const emitClickAtCursor = useCallback(
    (button: number, doubleClick: boolean) => {
      const { x, y } = cursorPos;
      emit("pressed", x, y, button, doubleClick);
      emit("released", x, y, button, false);
    },
    [cursorPos, emit],
  );

  const click = useCallback(() => {
    emitClickAtCursor(0, false);
  }, [emitClickAtCursor]);

  const rightClick = useCallback(() => {
    emitClickAtCursor(2, false);
  }, [emitClickAtCursor]);

  const doubleClick = useCallback(() => {
    const { x, y } = cursorPos;
    emit("pressed", x, y, 0, false);
    emit("released", x, y, 0, false);
    setTimeout(() => {
      emit("pressed", x, y, 0, true);
      emit("released", x, y, 0, false);
    }, 60);
  }, [cursorPos, emit]);

  const scroll = useCallback(
    (delta: number) => {
      const { x, y } = cursorPos;
      const signDelta = Math.sign(delta);
      emit("wheel", x, y, 0, false, signDelta);
    },
    [cursorPos, emit],
  );

  const cursorStyle: React.CSSProperties = useMemo(() => {
    if (!layout) return { left: "50%", top: "50%" };
    const x = layout.offsetX + cursorPos.x * layout.renderedWidth;
    const y = layout.offsetY + cursorPos.y * layout.renderedHeight;
    return {
      left: x,
      top: y,
      transform: "translate(-2px, -2px)",
    };
  }, [cursorPos, layout]);

  const surfaceRef = useCallback((node: HTMLElement | null) => {
    setSurfaceNode(node);
  }, []);

  useEffect(() => {
    if (controlMode !== "cursor" || !surfaceNode) return;

    const ro = new ResizeObserver(() => {
      updateLayout();
    });
    ro.observe(surfaceNode);
    updateLayout();

    return () => {
      ro.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [controlMode, surfaceNode, updateLayout]);

  useEffect(() => {
    if (controlMode !== "cursor" || !surfaceNode) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (trackingRef.current !== null) return;
      surfaceNode.setPointerCapture(e.pointerId);
      trackingRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        startTime: Date.now(),
      };
      e.preventDefault();
    };

    const handlePointerMove = (e: PointerEvent) => {
      const tracking = trackingRef.current;
      if (!tracking || tracking.pointerId !== e.pointerId) return;
      const dx = e.clientX - tracking.lastX;
      const dy = e.clientY - tracking.lastY;
      tracking.lastX = e.clientX;
      tracking.lastY = e.clientY;
      moveCursorByDelta(dx, dy);
      e.preventDefault();
    };

    const handlePointerUp = (e: PointerEvent) => {
      const tracking = trackingRef.current;
      if (!tracking || tracking.pointerId !== e.pointerId) return;
      try {
        surfaceNode.releasePointerCapture(e.pointerId);
      } catch {}
      trackingRef.current = null;

      const dx = e.clientX - tracking.startX;
      const dy = e.clientY - tracking.startY;
      const dist = Math.hypot(dx, dy);
      const duration = Date.now() - tracking.startTime;

      if (dist < TAPPER_MAX_PX && duration < TAP_MAX_MS) {
        const now = Date.now();
        const isDouble = lastTapRef.current !== null && now - lastTapRef.current.time < DOUBLE_TAP_MAX_MS;
        lastTapRef.current = { time: now, count: isDouble ? 2 : 1 };
        emitClickAtCursor(0, isDouble);
      }
      e.preventDefault();
    };

    const handlePointerCancel = (e: PointerEvent) => {
      const tracking = trackingRef.current;
      if (!tracking || tracking.pointerId !== e.pointerId) return;
      try {
        surfaceNode.releasePointerCapture(e.pointerId);
      } catch {}
      trackingRef.current = null;
      flushMove();
    };

    surfaceNode.addEventListener("pointerdown", handlePointerDown, { passive: false });
    surfaceNode.addEventListener("pointermove", handlePointerMove, { passive: false });
    surfaceNode.addEventListener("pointerup", handlePointerUp, { passive: false });
    surfaceNode.addEventListener("pointercancel", handlePointerCancel, { passive: false });

    return () => {
      surfaceNode.removeEventListener("pointerdown", handlePointerDown);
      surfaceNode.removeEventListener("pointermove", handlePointerMove);
      surfaceNode.removeEventListener("pointerup", handlePointerUp);
      surfaceNode.removeEventListener("pointercancel", handlePointerCancel);
      flushMove();
    };
  }, [controlMode, surfaceNode, moveCursorByDelta, emitClickAtCursor, flushMove]);

  return {
    cursorPos,
    cursorStyle,
    dragLock,
    setDragLock,
    surfaceRef,
    click,
    rightClick,
    doubleClick,
    scroll,
  };
}
