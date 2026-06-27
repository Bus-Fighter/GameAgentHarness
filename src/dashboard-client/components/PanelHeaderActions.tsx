import { Maximize2, Minimize2 } from "lucide-react";

interface PanelHeaderActionsProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onFullscreen?: () => void;
  allowCollapse?: boolean;
  allowFullscreen?: boolean;
}

export function PanelHeaderActions({
  collapsed,
  onToggleCollapse,
  onFullscreen,
  allowCollapse = true,
  allowFullscreen = true,
}: PanelHeaderActionsProps) {
  return (
    <div className="flex items-center gap-1">
      {allowCollapse && onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        </button>
      )}
      {allowFullscreen && onFullscreen && (
        <button
          type="button"
          onClick={onFullscreen}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
          title="Fullscreen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
