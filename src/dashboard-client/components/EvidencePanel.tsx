import { Image } from "lucide-react";

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

export function EvidencePanel({ evidence }: EvidencePanelProps) {
  return (
    <section className="card flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          <Image className="h-4 w-4" />
          Evidence
        </div>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--muted)]">
          {evidence.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3">
        {evidence.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">No screenshots yet.</div>
        ) : (
          <div className="flex h-full gap-3">
            {[...evidence].reverse().map((ev) => (
              <div
                key={ev.seq}
                className="flex h-full w-40 flex-shrink-0 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]"
              >
                <img
                  src={ev.url}
                  alt={`Evidence ${ev.seq}`}
                  loading="lazy"
                  className="h-28 w-full object-cover"
                />
                <div className="truncate p-2 text-[0.7rem] text-[var(--muted)]">
                  #{ev.seq} {ev.type.replace("evidence.", "")} {formatTime(ev.receivedAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
