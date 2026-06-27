import { useState, useMemo, memo, startTransition, ViewTransition } from "react";
import { Image } from "lucide-react";
import { PanelHeaderActions } from "./PanelHeaderActions";
import { FullscreenOverlay } from "./FullscreenOverlay";

interface Evidence {
  seq: number;
  type: string;
  receivedAt: string;
  url: string;
}

interface EvidencePanelProps {
  evidence: Evidence[];
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export const EvidencePanel = memo(function EvidencePanel({ evidence }: EvidencePanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [selected, setSelected] = useState<Evidence | null>(null);

  const items = useMemo(() => [...evidence].reverse(), [evidence]);

  const content = (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
      {evidence.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">No screenshots yet.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((ev) => (
            <button
              key={ev.seq}
              type="button"
              onClick={() => setSelected(ev)}
              className="group flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] text-left transition-colors hover:border-[var(--accent)]"
            >
              <div className="relative aspect-video w-full overflow-hidden bg-black">
                <img
                  src={ev.url}
                  alt={`Evidence ${ev.seq}`}
                  loading="lazy"
                  className="h-full w-full object-contain transition-transform group-hover:scale-105"
                />
              </div>
              <div className="truncate p-2 text-[0.65rem] text-[var(--muted)]">
                #{ev.seq} {ev.type.replace("evidence.", "")} {formatTime(ev.receivedAt)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      <section className="card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            <Image className="h-4 w-4" />
            Evidence
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--muted)]">
              {evidence.length}
            </span>
            <PanelHeaderActions
              collapsed={collapsed}
              onToggleCollapse={() => setCollapsed((v) => !v)}
              onFullscreen={() => startTransition(() => setFullscreen(true))}
            />
          </div>
        </div>
        <div
          className={`grid min-h-0 transition-[grid-template-rows] duration-200 ease-in-out ${
            collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
          }`}
        >
          <div className="flex min-h-0 flex-col overflow-hidden">{content}</div>
        </div>
      </section>
      {fullscreen && (
        <ViewTransition enter="scale-in" exit="scale-out" default="none">
          <FullscreenOverlay title="Evidence" onClose={() => setFullscreen(false)}>
            <section className="flex h-full min-h-0 flex-col">{content}</section>
          </FullscreenOverlay>
        </ViewTransition>
      )}
      {selected && (
        <ViewTransition enter="scale-in" exit="scale-out" default="none">
          <FullscreenOverlay title={`Evidence #${selected.seq}`} onClose={() => setSelected(null)}>
            <div className="flex h-full flex-col gap-3 overflow-auto p-4">
              <img
                src={selected.url}
                alt={`Evidence ${selected.seq}`}
                className="max-h-[70%] w-full object-contain"
              />
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <span className="text-[var(--muted)]">Type</span>
                <span className="font-medium text-[var(--text)]">{selected.type}</span>
                <span className="text-[var(--muted)]">Seq</span>
                <span className="text-[var(--text)]">{selected.seq}</span>
                <span className="text-[var(--muted)]">Time</span>
                <span className="text-[var(--text)]">{formatTime(selected.receivedAt)}</span>
              </div>
            </div>
          </FullscreenOverlay>
        </ViewTransition>
      )}
    </>
  );
});
