import { Boxes } from "lucide-react";
import type { HarnessContext } from "../types";

interface SceneCardProps {
  context: HarnessContext | null;
}

export function SceneCard({ context }: SceneCardProps) {
  const running = context?.runtime?.running ?? false;
  const project =
    context?.observed?.project?.name ||
    context?.profile?.project?.name ||
    "-";
  const engine =
    context?.observed?.engine?.name || context?.profile?.engine?.name || "-";
  const scene = context?.scene || "-";

  return (
    <section className="card overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          <Boxes className="h-4 w-4" />
          Scene & State
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold ${
            running
              ? "border-[rgba(34,197,94,0.3)] bg-[var(--accent-dim)] text-[var(--accent)]"
              : "border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] text-[var(--danger)]"
          }`}
        >
          {running ? "Running" : "Stopped"}
        </span>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Project</span>
          <span className="font-medium text-[var(--text)]">{project}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Scene</span>
          <span className="font-mono text-sm font-medium text-[var(--text)]">{scene}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Engine</span>
          <span className="text-sm font-medium text-[var(--text)]">{engine}</span>
        </div>
      </div>
    </section>
  );
}
