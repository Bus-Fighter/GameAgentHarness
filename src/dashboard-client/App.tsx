import { useState, useCallback, useEffect, useRef, startTransition } from "react";
import { Header } from "./components/Header";
import { MobileTabs } from "./components/MobileTabs";
import { TabPanel } from "./components/TabPanel";
import { ViewportPanel } from "./components/ViewportPanel";
import { SceneCard } from "./components/SceneCard";
import { EventsPanel } from "./components/EventsPanel";
import { EvidencePanel } from "./components/EvidencePanel";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { TransportToolbar } from "./components/TransportToolbar";
import { FileReviewPanel } from "./components/FileReviewPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { InspectPanel } from "./components/InspectPanel";
import { useWebSocket } from "./hooks/useWebSocket";
import { useSettings } from "./hooks/useSettings";
import { fetchStatus } from "./api";
import type {
  WebSocketMessage,
  HarnessEvent,
  HarnessLog,
  HarnessContext,
  FrameMessage,
  StatusResponse,
  HarnessInspectorData,
  HarnessHistoryAction,
  HarnessSceneNode,
  HarnessNode,
  ResourcePreview,
  ResourceImportSettings,
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
  const [logs, setLogs] = useState<HarnessLog[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [runtimeFrame, setRuntimeFrame] = useState<FrameMessage | null>(null);
  const [editorFrame, setEditorFrame] = useState<FrameMessage | null>(null);
  const [viewportSource, setViewportSource] = useState<"runtime" | "editor">("runtime");
  const [paused, setPaused] = useState(false);
  const [recordingPreference, setRecordingPreference] = useState(true);
  const [runtimeCaptureEnabled, setRuntimeCaptureEnabled] = useState(true);
  const [runtimeRunning, setRuntimeRunning] = useState(false);
  const [inspector, setInspector] = useState<HarnessInspectorData | null>(null);
  const [history, setHistory] = useState<HarnessHistoryAction[]>([]);
  const [sceneTree, setSceneTree] = useState<HarnessSceneNode | null>(null);
  const [selectedNodePath, setSelectedNodePath] = useState<string | null>(null);
  const [resourcePreview, setResourcePreview] = useState<ResourcePreview | null>(null);
  const [resourceImportSettings, setResourceImportSettings] = useState<ResourceImportSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const {
    settings,
    setFontSize,
    setLogsEnabled,
    setLogLevel,
    setMaxLogLines,
    setEditorViewportEnabled,
    setEditorViewportInterval,
    setRuntimeViewportInterval,
    setInspectorEnabled,
    setSignalsEnabled,
    setHistoryEnabled,
    setMaxHistoryEntries,
  } = useSettings();

  const lastSeqRef = useRef(0);
  const maxLogLinesRef = useRef(settings.maxLogLines);
  const maxHistoryEntriesRef = useRef(settings.maxHistoryEntries);
  const pendingSelectionPathRef = useRef<string | null>(null);
  useEffect(() => {
    maxLogLinesRef.current = settings.maxLogLines;
  }, [settings.maxLogLines]);
  useEffect(() => {
    maxHistoryEntriesRef.current = settings.maxHistoryEntries;
  }, [settings.maxHistoryEntries]);

  const handleTabChange = useCallback((tab: string) => {
    startTransition(() => {
      setActiveTab(tab);
    });
  }, []);

  const handleEvent = useCallback(
    (event: HarnessEvent) => {
      setEvents((prev) => {
        const next = [...prev, event];
        if (next.length > 100) next.shift();
        return next;
      });
      if (event.seq > lastSeqRef.current) lastSeqRef.current = event.seq;

      if (event.type === "engine.connected" || event.type === "plugin.enabled") {
        sendControl("scene.tree");
      }
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
      if (event.type === "engine.log") {
        const level = String(event.data?.level || "info");
        const message = String(event.data?.message || "");
        if (!message) return;
        setLogs((prev) => {
          const next = [
            ...prev,
            {
              seq: event.seq,
              level: level as HarnessLog["level"],
              message,
              receivedAt: event.receivedAt,
            },
          ];
          return next.slice(-maxLogLinesRef.current);
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
      if (event.type === "inspector.data") {
        const data = event.data as HarnessInspectorData | undefined;
        if (data?.node) setInspector(data);
      }
      if (event.type === "scene.tree") {
        const root = (event.data?.root ?? null) as HarnessSceneNode | null;
        setSceneTree(root);
      }
      if (event.type === "selection.changed") {
        const data = event.data as Record<string, unknown> | undefined;
        const selected = (data?.selected as HarnessNode[] | undefined) ?? [];
        const source = String(data?.source ?? "editor");
        if (selected.length > 0) {
          setSelectedNodePath(selected[0].path);
          if (source === "sync") {
            pendingSelectionPathRef.current = null;
          }
        }
      }
      if (event.type === "resource.preview") {
        const data = event.data as ResourcePreview | undefined;
        if (data) {
          setResourcePreview({
            ...data,
            previewUrl: data.ok && data.data ? `data:image/jpeg;base64,${data.data}` : undefined,
          });
        }
      }
      if (event.type === "resource.import_settings") {
        const data = event.data as ResourceImportSettings | undefined;
        if (data) setResourceImportSettings(data);
      }
      if (event.type === "history.action") {
        const data = event.data as Record<string, unknown> | undefined;
        if (!data) return;
        setHistory((prev) => {
          const next = [
            ...prev,
            {
              seq: event.seq,
              source: String(data.source || "engine"),
              action: String(data.action || event.type),
              data: (data.data as Record<string, unknown>) || {},
              receivedAt: event.receivedAt,
            },
          ];
          return next.slice(-maxHistoryEntriesRef.current);
        });
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
          if (msg.context) {
            setContext(msg.context);
            if (msg.context.runtime?.running != null) {
              setRuntimeRunning(msg.context.runtime.running);
            }
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
        if (msg.source === "editor") {
          setEditorFrame(msg);
        } else {
          setRuntimeFrame(msg);
        }
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

  const sendControl = useCallback(
    (action: string, extra: Record<string, unknown> = {}) => {
      send({ kind: "control", action, ...extra });
    },
    [send],
  );

  useEffect(() => {
    const id = setInterval(() => {
      fetchStatus().then(setStatus).catch(console.error);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    sendControl("runtime_viewport_interval", { interval: settings.runtimeViewportInterval });
  }, [settings.runtimeViewportInterval, sendControl]);

  useEffect(() => {
    sendControl("editor_viewport", { enabled: settings.editorViewportEnabled, interval: settings.editorViewportInterval });
  }, [settings.editorViewportEnabled, settings.editorViewportInterval, sendControl]);

  useEffect(() => {
    sendControl("inspector_config", {
      inspector_enabled: settings.inspectorEnabled,
      signals_enabled: settings.signalsEnabled,
      history_enabled: settings.historyEnabled,
    });
  }, [settings.inspectorEnabled, settings.signalsEnabled, settings.historyEnabled, sendControl]);

  useEffect(() => {
    if (!connected) return;
    const level = (() => {
      switch (settings.logLevel) {
        case "all":
        case "verbose":
          return "debug";
        case "warning":
          return "warning";
        case "error":
          return "error";
        case "info":
        default:
          return "info";
      }
    })();
    sendControl("log.level", { level });
  }, [connected, settings.logLevel, sendControl]);

  useEffect(() => {
    if (!connected) return;
    sendControl("scene.tree");
  }, [connected, sendControl]);

  useEffect(() => {
    if (!connected) return;
    if (runtimeRunning) {
      setRuntimeCaptureEnabled(recordingPreference);
      sendControl("runtime_capture", { enabled: recordingPreference });
    } else {
      setRuntimeCaptureEnabled(false);
    }
  }, [connected, runtimeRunning, recordingPreference, sendControl]);

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

  const handleLaunchEditor = useCallback(() => {
    sendControl("launch.editor");
  }, [sendControl]);

  const handleClearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const handleClearEvidence = useCallback(() => {
    setEvidence([]);
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const handleNodeSelect = useCallback(
    (path: string) => {
      pendingSelectionPathRef.current = path;
      setSelectedNodePath(path);
      sendControl("selection.set", { path });
      sendControl("inspector.query", { path });
    },
    [sendControl],
  );

  const handleRefreshSceneTree = useCallback(() => {
    sendControl("scene.tree");
  }, [sendControl]);

  const handleRequestResourcePreview = useCallback(
    (path: string) => {
      setResourcePreview(null);
      sendControl("resource.preview", { path });
    },
    [sendControl],
  );

  const handleRequestResourceImportSettings = useCallback(
    (path: string) => {
      setResourceImportSettings(null);
      sendControl("resource.import_settings", { path });
    },
    [sendControl],
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden lg:min-h-dvh lg:overflow-auto">
      <Header
        connected={connected}
        mode={mode}
        engineConnected={engineConnected}
        traceId={traceId}
        traceActive={status?.traceActive ?? false}
        paused={paused}
        onReconnect={reconnect}
        onOpenSettings={() => startTransition(() => setSettingsOpen(true))}
      />
      {activeTab === "live" && (
          <TabPanel>
            <div className="flex h-full flex-col gap-3 overflow-y-auto lg:contents">
              <ViewportPanel
                captureEnabled={viewportSource === "runtime" ? runtimeCaptureEnabled : settings.editorViewportEnabled}
                frame={viewportSource === "runtime" ? runtimeFrame : editorFrame}
                source={viewportSource}
                onSourceChange={setViewportSource}
                onPointer={handlePointer}
              />
              <SceneCard context={context} />
              <DiagnosticsPanel status={status} mode={mode} />
            </div>
          </TabPanel>
        )}
        {activeTab === "events" && (
          <TabPanel>
            <EventsPanel
              events={events}
              logs={logs}
              fontSize={settings.fontSize}
              logsEnabled={settings.logsEnabled}
              logLevel={settings.logLevel}
              onLogLevelChange={setLogLevel}
              onClearLogs={handleClearLogs}
            />
          </TabPanel>
        )}
        {activeTab === "evidence" && (
          <TabPanel>
            <EvidencePanel evidence={evidence} />
          </TabPanel>
        )}
      {activeTab === "files" && (
        <TabPanel>
          <FileReviewPanel
            fontSize={settings.fontSize}
            preview={resourcePreview}
            importSettings={resourceImportSettings}
            onRequestPreview={handleRequestResourcePreview}
            onRequestImportSettings={handleRequestResourceImportSettings}
          />
        </TabPanel>
      )}
      {activeTab === "inspect" && (
        <TabPanel>
          <InspectPanel
            inspector={inspector}
            history={history}
            sceneTree={sceneTree}
            selectedNodePath={selectedNodePath}
            fontSize={settings.fontSize}
            inspectorEnabled={settings.inspectorEnabled}
            signalsEnabled={settings.signalsEnabled}
            historyEnabled={settings.historyEnabled}
            onClearHistory={handleClearHistory}
            onNodeSelect={handleNodeSelect}
            onRefreshSceneTree={handleRefreshSceneTree}
          />
        </TabPanel>
      )}
      <MobileTabs activeTab={activeTab} onChange={handleTabChange} />
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
        onLaunchEditor={handleLaunchEditor}
      />
      {error && (
        <div className="fixed bottom-[calc(var(--tabs-h)+var(--toolbar-h)+28px)] left-4 right-4 z-[100] rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] p-3 text-center text-sm text-[var(--danger)] lg:bottom-[calc(var(--toolbar-h)+24px)]">
          {error}
        </div>
      )}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => startTransition(() => setSettingsOpen(false))}
        settings={settings}
        onFontSizeChange={setFontSize}
        onLogsEnabledChange={setLogsEnabled}
        onLogLevelChange={setLogLevel}
        onMaxLogLinesChange={setMaxLogLines}
        onEditorViewportEnabledChange={setEditorViewportEnabled}
        onEditorViewportIntervalChange={setEditorViewportInterval}
        onRuntimeViewportIntervalChange={setRuntimeViewportInterval}
        onInspectorEnabledChange={setInspectorEnabled}
        onSignalsEnabledChange={setSignalsEnabled}
        onHistoryEnabledChange={setHistoryEnabled}
        onMaxHistoryEntriesChange={setMaxHistoryEntries}
      />
    </div>
  );
}
