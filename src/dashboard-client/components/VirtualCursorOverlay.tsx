import type { VirtualCursorActions } from "../hooks/useVirtualCursor";

interface VirtualCursorOverlayProps {
  cursorStyle: React.CSSProperties;
  dragLock: boolean;
  onToggleDragLock: () => void;
  actions: VirtualCursorActions;
}

export function VirtualCursorOverlay({ cursorStyle, dragLock, onToggleDragLock, actions }: VirtualCursorOverlayProps) {
  return (
    <>
      <div
        className="pointer-events-none absolute z-10"
        style={cursorStyle}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          <path
            d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z"
            fill="white"
            stroke="black"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-[var(--border)] bg-[rgba(15,23,42,0.85)] p-1 backdrop-blur">
        <button
          type="button"
          onClick={actions.click}
          className="rounded-md px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/20"
        >
          Click
        </button>
        <button
          type="button"
          onClick={actions.rightClick}
          className="rounded-md px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/20"
        >
          Right
        </button>
        <button
          type="button"
          onClick={actions.doubleClick}
          className="rounded-md px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/20"
        >
          Dbl
        </button>
        <button
          type="button"
          onClick={onToggleDragLock}
          className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
            dragLock ? "bg-[var(--accent)] text-white" : "text-white hover:bg-white/20"
          }`}
        >
          Drag
        </button>
        <div className="mx-1 h-4 w-px bg-white/30" />
        <button
          type="button"
          onClick={() => actions.scroll(1)}
          className="rounded-md px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/20"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => actions.scroll(-1)}
          className="rounded-md px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/20"
        >
          ↓
        </button>
      </div>
    </>
  );
}
