import { X } from "lucide-react";

interface FullscreenOverlayProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}

export function FullscreenOverlay({ title, children, onClose }: FullscreenOverlayProps) {
  return (
    <div className="fixed left-0 right-0 top-[var(--header-h)] z-[150] flex flex-col border-y border-[var(--border)] bg-[var(--bg)] bottom-[calc(var(--tabs-h)+var(--toolbar-h)+12px)] lg:bottom-[calc(var(--toolbar-h)+24px)]"
    >
      <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface-2)] px-3">
        <span className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
