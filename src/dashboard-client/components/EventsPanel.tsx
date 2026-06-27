import { Zap } from "lucide-react";
import type { HarnessEvent } from "../types";

interface EventsPanelProps {
  events: HarnessEvent[];
}

function eventIcon(type: string) {
  if (type.startsWith("scene.")) return "scene";
  if (type.startsWith("input.action")) return "key";
  if (type.startsWith("input.")) return "input";
  if (type.startsWith("state.")) return "state";
  if (type.startsWith("runtime.")) return "runtime";
  if (type.startsWith("evidence.")) return "evidence";
  if (type.startsWith("validation")) return "validation";
  if (type.includes("error")) return "error";
  return "state";
}

function eventClass(type: string) {
  if (type.includes("error")) return "text-[var(--danger)]";
  if (type.startsWith("validation") && type.includes("fail"))
    return "text-[var(--danger)]";
  if (type.startsWith("validation")) return "text-[var(--accent)]";
  if (type.startsWith("evidence.")) return "text-[var(--info)]";
  if (type.startsWith("input.")) return "text-[var(--warning)]";
  return "";
}

function formatEventDetail(event: HarnessEvent) {
  const data = event.data || {};
  if (event.type.startsWith("input.pointer")) {
    return `x:${data.x ?? "?"} y:${data.y ?? "?"}`;
  }
  if (event.type.startsWith("input.action")) {
    return `key:${data.keycode ?? "?"}`;
  }
  if (event.type === "scene.changed") {
    return (data.scenePath as string) || "-";
  }
  if (event.type === "state.sampled") {
    return `root:${data.rootChildCount ?? "?"} scene:${data.currentSceneChildCount ?? "?"}`;
  }
  if (event.type.startsWith("evidence.")) {
    return (data.path as string) || "-";
  }
  if (event.type.startsWith("validation")) {
    return (data.message as string) || (data.name as string) || event.type;
  }
  return JSON.stringify(data).slice(0, 60);
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function EventsPanel({ events }: EventsPanelProps) {
  return (
    <section className="card flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          <Zap className="h-4 w-4" />
          Event Stream
        </div>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--muted)]">
          {events.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-0">
        {events.length === 0 ? (
          <div className="p-4 text-center text-sm text-[var(--muted)]">No events yet.</div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {[...events].reverse().map((ev) => (
              <li key={ev.seq} className="flex items-start gap-3 p-3">
                <span className={`mt-0.5 text-xs font-semibold ${eventClass(ev.type)}`}>
                  {eventIcon(ev.type)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--text)]">{ev.type}</div>
                  <div className="truncate text-xs text-[var(--muted)]" title={formatEventDetail(ev)}>
                    {formatEventDetail(ev)}
                  </div>
                </div>
                <span className="text-xs text-[var(--muted)]">{formatTime(ev.receivedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
