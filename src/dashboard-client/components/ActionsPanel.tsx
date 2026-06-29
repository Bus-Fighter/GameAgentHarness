import { Loader2 } from "lucide-react";

export interface DashboardAction {
  id: string;
  label: string;
}

interface ActionsPanelProps {
  actions: DashboardAction[];
  pendingId: string | null;
  engineConnected: boolean;
  onAction: (id: string) => void;
}

export function ActionsPanel({ actions, pendingId, engineConnected, onAction }: ActionsPanelProps) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
      <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-[var(--muted)]">
        Actions
      </span>
      {actions.map((action) => {
        const pending = pendingId === action.id;
        return (
          <button
            key={action.id}
            type="button"
            disabled={!engineConnected || pending}
            onClick={() => onAction(action.id)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
