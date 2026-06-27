import { useState, useCallback, useEffect, useRef } from "react";
import { Header } from "./components/Header";
import { MobileTabs } from "./components/MobileTabs";
import { ViewportPanel } from "./components/ViewportPanel";
import { SceneCard } from "./components/SceneCard";
import { EventsPanel } from "./components/EventsPanel";
import { EvidencePanel } from "./components/EvidencePanel";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { TransportToolbar } from "./components/TransportToolbar";
import { FileReviewPanel } from "./components/FileReviewPanel";
import { useWebSocket } from "./hooks/useWebSocket";
import { fetchStatus } from "./api";
import type {
  WebSocketMessage,
  HarnessEvent,
  HarnessContext,
  FrameMessage,
  StatusResponse,
} from "./types";

interface EvidenceItem {
  seq: number;
  type: string;
  receivedAt: string;
  url: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("live");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [context, setContext] = useState<HarnessContext | null>(null);
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [frame, setFrame] = useState<FrameMessage | null>(null);
  const [paused, setPaused] = useState(false);
  const [recordingPreference, setRecordingPreference] = useState(true);
  const [runtimeCaptureEnabled, setRuntimeCaptureEnabled] = useState(true);
  const [runtimeRunning, setRuntimeRunning] = useState(false);

  const lastSeqRef = useRef(0);

  const handleEvent = useCallback(
    (event: HarnessEvent) => {
      setEvents((prev) => {
        const next = [...prev, event];
        if (next.length > 100) next.shift();
        return next;
      });
      if (event.seq > lastSeqRef.current) lastSeqRef.current = event.seq;

      if (event.type?.startsWith("evidence.") && event.data?.path && traceId) {
        setEvidence((prev) => {
          const next = [
            ...prev,
            {
              seq: event.seq,
              type: event.type,
              receivedAt: event.receivedAt,
              url: `/api/traces/${traceId}/evidence/${event.data.path}`,
            },
          ];
          return next.slice(-50);
        });
      }
      if (event.type === "state.sampled") {
        setContext((prev) =>
          prev ? { ...prev, ...(event.data as Partial<HarnessContext>) } : (event.data as HarnessContext),
        );
      }
      if (event.type === "runtime_capture.changed") {
        const enabled = Boolean(event.data?.enabled);
        setRecordingPreference(enabled);
        setRuntimeCaptureEnabled(enabled && runtimeRunning);
      }
      if (event.type === "pause.changed") {
        setPaused(Boolean(event.data?.enabled));
      }
      if (event.type === "runtime.started") {
        setRuntimeRunning(true);
        setRuntimeCaptureEnabled(recordingPreference);
      }
      if (event.type === "runtime.stopped") {
        setRuntimeRunning(false);
        setRuntimeCaptureEnabled(false);
      }
    },
    [traceId, runtimeRunning, recordingPreference],
  );

  const handleMessage = useCallback(
    (msg: WebSocketMessage) => {
      switch (msg.kind) {
        case "hello":
          if (msg.traceId) {
            setTraceId(msg.traceId);
            fetchStatus().then(setStatus).catch(console.error);
          }
          break;
        case "trace":
          setTraceId(msg.traceId);
          if (!msg.traceId) {
            setEvents([]);
            setEvidence([]);
            lastSeqRef.current = 0;
          }
          break;
        case "frame":
          setFrame(msg);
          break;
        case "context":
          setContext(msg.context);
          if (msg.context.runtime?.running != null) {
            setRuntimeRunning(msg.context.runtime.running);
          }
          break;
        case "event":
          handleEvent(msg.event);
          break;
      }
    },
    [handleEvent],
  );

  const { connected, mode, error, reconnect, send } = useWebSocket(handleMessage);

  useEffect(() => {
    const id = setInterval(() => {
      fetchStatus().then(setStatus).catch(console.error);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (runtimeCaptureEnabled) setFrame((f) => (f ? { ...f } : null));
    }, 2000);
    return () => clearInterval(id);
  }, [runtimeCaptureEnabled]);

  const sendControl = useCallback(
    (action: string, extra: Record<string, unknown> = {}) => {
      send({ kind: "control", action, ...extra });
    },
    [send],
  );

  const engineConnected = (status?.engineClients ?? 0) > 0;

  const handlePointer = useCallback(
    (phase: string, e: React.MouseEvent | React.TouchEvent) => {
      const img = e.currentTarget as HTMLImageElement;
      const rect = img.getBoundingClientRect();
      let clientX: number;
      let clientY: number;
      if ("touches" in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ("changedTouches" in e && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      } else {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
      }
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const mouse = e as React.MouseEvent;
      sendControl("input.pointer", {
        phase,
        x,
        y,
        button: mouse.button ?? 0,
        modifiers: {
          ctrl: mouse.ctrlKey || false,
          shift: mouse.shiftKey || false,
          alt: mouse.altKey || false,
          meta: mouse.metaKey || false,
        },
      });
      e.preventDefault();
    },
    [sendControl],
  );

  const handleRecord = useCallback(() => {
    if (!runtimeRunning) return;
    const next = !recordingPreference;
    setRecordingPreference(next);
    setRuntimeCaptureEnabled(next);
    sendControl("runtime_capture", { enabled: next });
  }, [runtimeRunning, recordingPreference, sendControl]);

  const handleSnapshot = useCallback(() => {
    sendControl("snapshot");
  }, [sendControl]);

  const handlePlay = useCallback(() => {
    sendControl("play");
  }, [sendControl]);

  const handlePause = useCallback(() => {
    sendControl("pause", { enabled: !paused });
  }, [paused, sendControl]);

  const handleStop = useCallback(() => {
    sendControl("stop");
  }, [sendControl]);

  const handleClearEvidence = useCallback(() => {
    setEvidence([]);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <Header
        connected={connected}
        mode={mode}
        engineConnected={engineConnected}
        traceId={traceId}
        traceActive={status?.traceActive ?? false}
        paused={paused}
        onReconnect={reconnect}
      />
      <MobileTabs activeTab={activeTab} onChange={setActiveTab} />
      <main className="flex-1 gap-3 p-3 pb-[calc(var(--toolbar-h)+20px)] lg:grid lg:grid-cols-[1.4fr_1fr] lg:grid-rows-[auto_1fr_auto] lg:items-start lg:gap-4 lg:p-4 lg:pb-[calc(var(--toolbar-h)+24px)]">
        {activeTab === "live" && (
          <>
            <ViewportPanel captureEnabled={runtimeCaptureEnabled} frame={frame} onPointer={handlePointer} />
            <SceneCard context={context} />
            <DiagnosticsPanel status={status} mode={mode} />
          </>
        )}
        {activeTab === "events" && <EventsPanel events={events} />}
        {activeTab === "evidence" && <EvidencePanel evidence={evidence} />}
        {activeTab === "files" && <FileReviewPanel />}
      </main>
      <TransportToolbar
        runtimeRunning={runtimeRunning}
        engineConnected={engineConnected}
        captureEnabled={runtimeCaptureEnabled}
        paused={paused}
        onRecord={handleRecord}
        onSnapshot={handleSnapshot}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onReconnect={reconnect}
        onClearEvidence={handleClearEvidence}
      />
      {error && (
        <div className="fixed bottom-[calc(var(--toolbar-h)+24px)] left-4 right-4 z-[100] rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] p-3 text-center text-sm text-[var(--danger)]">
          {error}
        </div>
      )}
    </div>
  );
}
