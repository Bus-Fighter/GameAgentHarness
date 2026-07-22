import { useState, useCallback, useEffect, useRef, startTransition } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
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
import { LiveActivityStrip } from "./components/LiveActivityStrip";
import { DocksPanel } from "./components/DocksPanel";
import { McpPanel } from "./components/McpPanel";
import { useWebSocket } from "./hooks/useWebSocket";
import { useSettings } from "./hooks/useSettings";
import { useMcpStatus } from "./hooks/useMcpStatus";
import { isMobilePointer } from "./utils/detectMobile";
import { fetchStatus, fetchScenes } from "./api";
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
  SignalSubscription,
  HarnessDockInfo,
} from "./types";

interface EvidenceItem {
  seq: number;
  type: string;
  receivedAt: string;
  url: string;
}

interface Toast {
  id: string;
  type: "error" | "warning" | "success" | "info";
  message: string;
  createdAt: number;
}

interface PendingAction {
  action: string;
  startedAt: number;
  timeoutId: ReturnType<typeof setTimeout>;
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
  const [signalSubscriptions, setSignalSubscriptions] = useState<SignalSubscription[]>([]);
  const [scenes, setScenes] = useState<string[]>([]);
  const [activeScene, setActiveScene] = useState<string | null>(null);
  const [editorActive, setEditorActive] = useState(false);
  const [editorManaged, setEditorManaged] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [docks, setDocks] = useState<HarnessDockInfo[]>([]);
  const [dockFrames, setDockFrames] = useState<Record<string, FrameMessage | null>>({});

  const {
    settings,
    setFontSize,
    setLogsEnabled,
    setLogLevel,
    setMaxLogLines,
    setEditorViewportEnabled,
    setEditorViewportInterval,
    setRuntimeViewportInterval,
    setEvidenceFrameInterval,
    setUseMjpeg,
    setDeduplicateFrames,
    setInspectorEnabled,
    setSignalsEnabled,
    setHistoryEnabled,
    setMaxHistoryEntries,
    setPointerInjectMode,
    setPointerControlMode,
    setIgnorePatterns,
    setViewportCompact,
    setDockInterval,
    setEnabledDocks,
  } = useSettings();

  const lastSeqRef = useRef(0);
  const maxLogLinesRef = useRef(settings.maxLogLines);
  const maxHistoryEntriesRef = useRef(settings.maxHistoryEntries);
  const deduplicateFramesRef = useRef(settings.deduplicateFrames);
  const pointerInjectModeRef = useRef(settings.pointerInjectMode);
  const pendingSelectionPathRef = useRef<string | null>(null);
  const latestRuntimeFrameRef = useRef<FrameMessage | null>(null);
  const latestEditorFrameRef = useRef<FrameMessage | null>(null);
  const frameThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);
  useEffect(() => {
    maxLogLinesRef.current = settings.maxLogLines;
  }, [settings.maxLogLines]);
  useEffect(() => {
    maxHistoryEntriesRef.current = settings.maxHistoryEntries;
  }, [settings.maxHistoryEntries]);
  useEffect(() => {
    deduplicateFramesRef.current = settings.deduplicateFrames;
  }, [settings.deduplicateFrames]);
  useEffect(() => {
    pointerInjectModeRef.current = settings.pointerInjectMode;
  }, [settings.pointerInjectMode]);

  const addToast = useCallback((type: Toast["type"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const toast: Toast = { id, type, message, createdAt: Date.now() };
    setToasts((prev) => {
      const next = [...prev, toast];
      return next.slice(-3);
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearPendingAction = useCallback(() => {
    if (pendingActionRef.current) {
      clearTimeout(pendingActionRef.current.timeoutId);
      pendingActionRef.current = null;
    }
    setPendingAction(null);
  }, []);

  const setPending = useCallback(
    (action: string, expectedMs: number = 5000) => {
      clearPendingAction();
      const timeoutId = setTimeout(() => {
        addToast("warning", `${action} is taking longer than expected`);
        setPendingAction(null);
        pendingActionRef.current = null;
      }, expectedMs);
      const pending: PendingAction = { action, startedAt: Date.now(), timeoutId };
      pendingActionRef.current = pending;
      setPendingAction(pending);
    },
    [addToast, clearPendingAction],
  );

  const handleTabChange = useCallback((tab: string) => {
    startTransition(() => {
      setActiveTab(tab);
    });
  }, []);

  const flushFrameState = useCallback(() => {
    frameThrottleTimerRef.current = null;
    if (latestRuntimeFrameRef.current) {
      setRuntimeFrame(latestRuntimeFrameRef.current);
      latestRuntimeFrameRef.current = null;
    }
    if (latestEditorFrameRef.current) {
      setEditorFrame(latestEditorFrameRef.current);
      latestEditorFrameRef.current = null;
    }
  }, []);

  const scheduleFrameFlush = useCallback(() => {
    if (frameThrottleTimerRef.current) return;
    frameThrottleTimerRef.current = setTimeout(flushFrameState, 33);
  }, [flushFrameState]);

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
        sendControl("frame_deduplication", { enabled: deduplicateFramesRef.current });
        sendControl("pointer_inject_mode", { mode: pointerInjectModeRef.current });
      }
      if (event.type === "editor.docks") {
        const data = event.data as { docks?: HarnessDockInfo[] } | undefined;
        const list = data?.docks ?? [];
        setDocks(list);
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
        if (level === "error" || level === "warning") {
          addToast(level === "error" ? "error" : "warning", message);
        }
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
        if (pendingActionRef.current?.action === "Record") {
          clearPendingAction();
          addToast("success", enabled ? "Recording started" : "Recording stopped");
        }
      }
      if (event.type === "pause.changed") {
        setPaused(Boolean(event.data?.enabled));
        if (pendingActionRef.current?.action === "Pause" || pendingActionRef.current?.action === "Resume") {
          clearPendingAction();
          addToast("success", event.data?.enabled ? "Paused" : "Resumed");
        }
      }
      if (event.type === "runtime.started") {
        setRuntimeRunning(true);
        setRuntimeCaptureEnabled(recordingPreference);
        if (pendingActionRef.current?.action === "Play") {
          clearPendingAction();
          addToast("success", "Play mode started");
        }
        const scene = event.data?.scene ? String(event.data.scene) : null;
        if (scene) {
          setContext((prev) => (prev ? { ...prev, scene } : ({ scene, runtime: { running: true } } as HarnessContext)));
          setActiveScene(scene);
        }
      }
      if (event.type === "runtime.stopped") {
        setRuntimeRunning(false);
        setRuntimeCaptureEnabled(false);
        if (pendingActionRef.current?.action === "Stop") {
          clearPendingAction();
          addToast("success", "Play mode stopped");
        }
      }
      if (event.type === "scene.changed") {
        const data = event.data as Record<string, unknown> | undefined;
        const scene = data?.scenePath ? String(data.scenePath) : data?.scene ? String(data.scene) : null;
        if (scene) {
          setContext((prev) => (prev ? { ...prev, scene } : ({ scene } as HarnessContext)));
          setActiveScene(scene);
        }
      }
      if (event.type === "editor.context") {
        const data = event.data as Record<string, unknown> | undefined;
        const scene = data?.scenePath ? String(data.scenePath) : null;
        if (scene) {
          setContext((prev) => (prev ? { ...prev, scene } : ({ scene } as HarnessContext)));
          setActiveScene(scene);
        }
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
            fetchStatus()
              .then((s) => {
                setStatus(s);
                setEditorActive(s.editorActive);
                setEditorManaged(s.editorManaged);
              })
              .catch(console.error);
          }
          if (msg.context) {
            setContext(msg.context);
            if (msg.context.scene) setActiveScene(msg.context.scene);
            if (msg.context.runtime?.running != null) {
              setRuntimeRunning(msg.context.runtime.running);
            }
          }
          if (msg.signalSubscriptions) {
            setSignalSubscriptions(msg.signalSubscriptions);
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
          latestEditorFrameRef.current = msg;
        } else if (msg.source === "runtime") {
          latestRuntimeFrameRef.current = msg;
          if (!runtimeRunning) {
            setRuntimeRunning(true);
          }
        } else if (msg.source?.startsWith("dock:")) {
          const dockId = msg.source.slice(5);
          setDockFrames((prev) => ({ ...prev, [dockId]: msg }));
        }
        scheduleFrameFlush();
        break;
        case "context":
          setContext(msg.context);
          if (msg.context.scene) setActiveScene(msg.context.scene);
          if (msg.context.runtime?.running != null) {
            setRuntimeRunning(msg.context.runtime.running);
          }
          break;
        case "status":
          setStatus({
            traceActive: msg.traceActive,
            traceId: msg.traceId,
            dashboardClients: msg.dashboardClients,
            dashboardWsClients: msg.dashboardWsClients,
            dashboardSseClients: msg.dashboardSseClients,
            engineClients: msg.engineClients,
            lastEngineAt: msg.lastEngineAt,
            editorActive: msg.editorActive,
            editorManaged: msg.editorManaged,
            intakeUrl: msg.intakeUrl,
            latestFrame: msg.latestFrame,
          });
          setEditorActive(msg.editorActive);
          setEditorManaged(msg.editorManaged);
          if (msg.latestFrame) {
            if (msg.latestFrame.source === "editor") {
              setEditorFrame(msg.latestFrame);
            } else if (msg.latestFrame.source === "runtime") {
              setRuntimeFrame(msg.latestFrame);
            }
          }
          break;
        case "event":
          handleEvent(msg.event);
          break;
        case "host.error":
          addToast("error", msg.error);
          break;
        case "control.result":
          if (!msg.ok && msg.error) {
            addToast("error", msg.error);
          }
          break;
        case "editor.launch":
          if (!msg.ok && msg.error) {
            addToast("error", msg.error);
          } else if (msg.ok) {
            addToast("success", msg.managed ? "Launched Godot" : "Godot connected");
          }
          break;
      }
    },
    [handleEvent, runtimeRunning],
  );

  const { connected, mode, error, reconnect, send } = useWebSocket(handleMessage);
  const { status: mcpStatus, refresh: refreshMcpStatus } = useMcpStatus();

  const sendControl = useCallback(
    (action: string, extra: Record<string, unknown> = {}) => {
      send({ kind: "control", action, ...extra });
    },
    [send],
  );

  const loadScenes = useCallback(async () => {
    try {
      const res = await fetchScenes();
      if (res.ok) setScenes(res.scenes);
    } catch (err) {
      console.error("Failed to load scenes", err);
    }
  }, []);

  useEffect(() => {
    loadScenes();
  }, [loadScenes]);

  useEffect(() => {
    if (!connected) return;
    sendControl("frame_deduplication", { enabled: settings.deduplicateFrames });
  }, [connected, settings.deduplicateFrames, sendControl]);

  useEffect(() => {
    if (!connected) return;
    sendControl("pointer_inject_mode", { mode: settings.pointerInjectMode });
  }, [connected, settings.pointerInjectMode, sendControl]);

  useEffect(() => {
    sendControl("runtime_viewport_interval", { interval: settings.runtimeViewportInterval });
  }, [settings.runtimeViewportInterval, sendControl]);

  useEffect(() => {
    sendControl("evidence_frame_interval", { interval: settings.evidenceFrameInterval });
  }, [settings.evidenceFrameInterval, sendControl]);

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
    const ids = new Set([...settings.enabledDocks, ...docks.map((d) => d.id)]);
    for (const id of ids) {
      sendControl("dock_stream", {
        dock: id,
        enabled: settings.enabledDocks.includes(id),
        interval: settings.dockInterval,
      });
    }
  }, [connected, settings.enabledDocks, settings.dockInterval, docks, sendControl]);

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
    if (!connected || !runtimeRunning) return;
    setRuntimeCaptureEnabled(recordingPreference);
    sendControl("runtime_capture", { enabled: recordingPreference });
  }, [connected, runtimeRunning, recordingPreference, sendControl]);

  const engineConnected = (status?.engineClients ?? 0) > 0;

  const sendPointer = useCallback(
    (action: "input.pointer" | "input.editor_pointer", phase: string, x: number, y: number, button: number, doubleClick: boolean, modifiers: { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }, extra: Record<string, unknown> = {}) => {
      sendControl(action, {
        phase,
        x,
        y,
        button,
        double_click: doubleClick,
        modifiers,
        ...extra,
      });
    },
    [sendControl],
  );

  const resolveControlMode = useCallback((): "direct" | "cursor" => {
    const mode = settings.pointerControlMode;
    if (mode === "auto") {
      return isMobilePointer() ? "cursor" : "direct";
    }
    return mode;
  }, [settings.pointerControlMode]);

  const controlMode = resolveControlMode();

  const handlePointer = useCallback(
    (phase: string, e: MouseEvent | TouchEvent) => {
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
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      }
      const naturalWidth = img.naturalWidth || rect.width;
      const naturalHeight = img.naturalHeight || rect.height;
      const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
      const renderedWidth = naturalWidth * scale;
      const renderedHeight = naturalHeight * scale;
      const offsetX = (rect.width - renderedWidth) / 2;
      const offsetY = (rect.height - renderedHeight) / 2;

      const safeWidth = renderedWidth || rect.width;
      const safeHeight = renderedHeight || rect.height;
      const x = Math.max(0, Math.min(1, (clientX - rect.left - offsetX) / safeWidth));
      const y = Math.max(0, Math.min(1, (clientY - rect.top - offsetY) / safeHeight));

      const mouse = e as MouseEvent;
      const isMoved = phase === "moved";
      sendPointer(
        "input.pointer",
        phase,
        x,
        y,
        isMoved ? (mouse.buttons ?? 0) : (mouse.button ?? 0),
        phase === "pressed" && mouse.detail === 2,
        {
          ctrl: mouse.ctrlKey || false,
          shift: mouse.shiftKey || false,
          alt: mouse.altKey || false,
          meta: mouse.metaKey || false,
        },
      );
      e.preventDefault();
    },
    [sendPointer],
  );

  const handleDockPointer = useCallback(
    (dock: string, phase: string, e: MouseEvent | TouchEvent) => {
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
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      }
      const naturalWidth = img.naturalWidth || rect.width;
      const naturalHeight = img.naturalHeight || rect.height;
      const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
      const renderedWidth = naturalWidth * scale;
      const renderedHeight = naturalHeight * scale;
      const offsetX = (rect.width - renderedWidth) / 2;
      const offsetY = (rect.height - renderedHeight) / 2;

      const safeWidth = renderedWidth || rect.width;
      const safeHeight = renderedHeight || rect.height;
      const x = Math.max(0, Math.min(1, (clientX - rect.left - offsetX) / safeWidth));
      const y = Math.max(0, Math.min(1, (clientY - rect.top - offsetY) / safeHeight));

      const mouse = e as MouseEvent;
      const isMoved = phase === "moved";
      sendPointer(
        "input.editor_pointer",
        phase,
        x,
        y,
        isMoved ? (mouse.buttons ?? 0) : (mouse.button ?? 0),
        phase === "pressed" && mouse.detail === 2,
        {
          ctrl: mouse.ctrlKey || false,
          shift: mouse.shiftKey || false,
          alt: mouse.altKey || false,
          meta: mouse.metaKey || false,
        },
        { dock },
      );
      e.preventDefault();
    },
    [sendPointer],
  );

  const handlePointerAt = useCallback(
    (phase: string, x: number, y: number, button: number, doubleClick: boolean, wheelDelta?: number) => {
      sendPointer(
        "input.pointer",
        phase,
        x,
        y,
        button,
        doubleClick,
        { ctrl: false, shift: false, alt: false, meta: false },
        wheelDelta !== undefined ? { delta: wheelDelta } : {},
      );
    },
    [sendPointer],
  );

  const handleDockPointerAt = useCallback(
    (dock: string, phase: string, x: number, y: number, button: number, doubleClick: boolean, wheelDelta?: number) => {
      sendPointer(
        "input.editor_pointer",
        phase,
        x,
        y,
        button,
        doubleClick,
        { ctrl: false, shift: false, alt: false, meta: false },
        { dock, ...(wheelDelta !== undefined ? { delta: wheelDelta } : {}) },
      );
    },
    [sendPointer],
  );

  const handleDockToggle = useCallback(
    (id: string) => {
      setEnabledDocks((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return Array.from(next);
      });
    },
    [setEnabledDocks],
  );

  const handleRecord = useCallback(() => {
    if (!runtimeRunning) return;
    const next = !recordingPreference;
    setRecordingPreference(next);
    setRuntimeCaptureEnabled(next);
    setPending("Record");
    sendControl("runtime_capture", { enabled: next });
  }, [runtimeRunning, recordingPreference, sendControl, setPending]);

  const handleSnapshot = useCallback(() => {
    sendControl("snapshot");
  }, [sendControl]);

  const handlePlay = useCallback(() => {
    setPending("Play", 10000);
    sendControl("play");
  }, [sendControl, setPending]);

  const handlePause = useCallback(() => {
    setPending(paused ? "Resume" : "Pause", 5000);
    sendControl("pause", { enabled: !paused });
  }, [paused, sendControl, setPending]);

  const handleStop = useCallback(() => {
    setPending("Stop", 5000);
    sendControl("stop");
  }, [sendControl, setPending]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "Escape") {
        if (settingsOpen) {
          startTransition(() => setSettingsOpen(false));
          return;
        }
      }
      if (isInput) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (runtimeRunning) {
          handlePause();
        } else if (engineConnected) {
          handlePlay();
        }
        return;
      }
      if (e.key === "r" || e.key === "R") {
        if (runtimeRunning) handleRecord();
        return;
      }
      if (e.key === "s" || e.key === "S") {
        handleSnapshot();
        return;
      }
      if (e.key === "1") {
        startTransition(() => setActiveTab("live"));
        return;
      }
      if (e.key === "2") {
        startTransition(() => setActiveTab("events"));
        return;
      }
      if (e.key === "3") {
        startTransition(() => setActiveTab("evidence"));
        return;
      }
      if (e.key === "4") {
        startTransition(() => setActiveTab("inspect"));
        return;
      }
      if (e.key === "5") {
        startTransition(() => setActiveTab("files"));
        return;
      }
      if (e.key === "6") {
        startTransition(() => setActiveTab("mcp"));
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, runtimeRunning, engineConnected, handlePause, handlePlay, handleRecord, handleSnapshot]);

  const handleSceneChange = useCallback(
    (scene: string) => {
      if (!scene || scene === activeScene || scene === context?.scene) return;
      setActiveScene(scene);
      setPending("Open Scene", 8000);
      sendControl("scene.open", { path: scene });
    },
    [activeScene, context?.scene, sendControl, setPending],
  );

  const handleRefreshScenes = useCallback(() => {
    loadScenes();
  }, [loadScenes]);

  const handleLaunchEditor = useCallback(() => {
    setPending(editorActive ? "Close Godot" : "Launch Godot", 15000);
    sendControl("launch.editor", { enabled: !editorActive });
  }, [editorActive, sendControl, setPending]);

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

  useEffect(() => {
    if (!connected || activeTab !== "docks") return;
    sendControl("docks.refresh");
  }, [connected, activeTab, sendControl]);

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

  const handleClearResourcePreview = useCallback(() => {
    setResourcePreview(null);
  }, []);

  const handleClearResourceImportSettings = useCallback(() => {
    setResourceImportSettings(null);
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden lg:min-h-dvh lg:overflow-auto">
      <Header
        connected={connected}
        mode={mode}
        engineConnected={engineConnected}
        engineClients={status?.engineClients ?? 0}
        traceId={traceId}
        traceActive={status?.traceActive ?? false}
        paused={paused}
        onReconnect={reconnect}
        onOpenSettings={() => startTransition(() => setSettingsOpen(true))}
        mcpRunning={mcpStatus?.running ?? false}
        onOpenMcp={() => startTransition(() => setActiveTab("mcp"))}
      />
      {activeTab === "live" && (
        <TabPanel>
          <div className="flex h-full flex-col gap-2 overflow-y-auto lg:contents">
            <ViewportPanel
              captureEnabled={viewportSource === "runtime" ? runtimeCaptureEnabled : settings.editorViewportEnabled}
              frame={viewportSource === "runtime" ? runtimeFrame : editorFrame}
              source={viewportSource}
              useMjpeg={settings.useMjpeg}
              compact={settings.viewportCompact}
              controlMode={controlMode}
              onSourceChange={setViewportSource}
              onPointer={handlePointer}
              onPointerAt={handlePointerAt}
              onCompactChange={setViewportCompact}
            />
            <SceneCard
              context={context}
              scenes={scenes}
              activeScene={activeScene}
              engineConnected={engineConnected}
              onSceneChange={handleSceneChange}
              onRefreshScenes={handleRefreshScenes}
            />
            <DiagnosticsPanel status={status} mode={mode} />
            <LiveActivityStrip
              events={events}
              logs={logs}
              evidence={evidence}
              onEventClick={() => startTransition(() => setActiveTab("events"))}
              onEvidenceClick={() => startTransition(() => setActiveTab("evidence"))}
              onLogClick={() => startTransition(() => setActiveTab("events"))}
            />
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
              signalSubscriptions={signalSubscriptions}
            />
          </TabPanel>
        )}
        {activeTab === "evidence" && (
          <TabPanel>
            <EvidencePanel evidence={evidence} />
          </TabPanel>
        )}
        {activeTab === "docks" && (
          <TabPanel>
            <DocksPanel
              docks={docks}
              enabledDocks={settings.enabledDocks}
              dockInterval={settings.dockInterval}
              useMjpeg={settings.useMjpeg}
              dockFrames={dockFrames}
              controlMode={controlMode}
              onToggleDock={handleDockToggle}
              onPointer={handleDockPointer}
              onPointerAt={handleDockPointerAt}
            />
          </TabPanel>
        )}
      {activeTab === "files" && (
        <TabPanel>
          <FileReviewPanel
            fontSize={settings.fontSize}
            preview={resourcePreview}
            importSettings={resourceImportSettings}
            ignorePatterns={settings.ignorePatterns}
            onRequestPreview={handleRequestResourcePreview}
            onRequestImportSettings={handleRequestResourceImportSettings}
            onClearPreview={handleClearResourcePreview}
            onClearImportSettings={handleClearResourceImportSettings}
            onIgnorePatternsChange={setIgnorePatterns}
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
      {activeTab === "mcp" && (
        <TabPanel>
          <McpPanel status={mcpStatus} onRefresh={refreshMcpStatus} />
        </TabPanel>
      )}
      <MobileTabs activeTab={activeTab} onChange={handleTabChange} />
      <TransportToolbar
        runtimeRunning={runtimeRunning}
        engineConnected={engineConnected}
        captureEnabled={runtimeCaptureEnabled}
        paused={paused}
        editorActive={editorActive}
        editorManaged={editorManaged}
        pendingAction={pendingAction?.action || null}
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
      <div className="fixed bottom-[calc(var(--tabs-h)+var(--toolbar-h)+36px)] left-1/2 z-[100] flex w-[min(480px,calc(100%-32px))] -translate-x-1/2 flex-col gap-2 lg:bottom-[calc(var(--toolbar-h)+36px)]">
        {toasts.map((toast) => {
          const Icon =
            toast.type === "error"
              ? AlertCircle
              : toast.type === "warning"
                ? AlertTriangle
                : toast.type === "success"
                  ? CheckCircle2
                  : Info;
          const colorClass =
            toast.type === "error"
              ? "border-red-400/30 bg-red-950/90 text-red-100 shadow-[0_4px_20px_rgba(239,68,68,0.25)]"
              : toast.type === "warning"
                ? "border-amber-400/30 bg-amber-950/90 text-amber-100 shadow-[0_4px_20px_rgba(245,158,11,0.25)]"
                : toast.type === "success"
                  ? "border-emerald-400/30 bg-emerald-950/90 text-emerald-100 shadow-[0_4px_20px_rgba(34,197,94,0.25)]"
                  : "border-blue-400/30 bg-blue-950/90 text-blue-100 shadow-[0_4px_20px_rgba(59,130,246,0.25)]";
          return (
            <div
              key={toast.id}
              className={`relative flex items-start gap-3 overflow-hidden rounded-xl border px-4 py-3 text-sm backdrop-blur ${colorClass}`}
            >
              <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span className="flex-1 leading-relaxed">{toast.message}</span>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="flex-shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="absolute bottom-0 left-0 h-0.5 bg-white/40 animate-[shrink_6s_linear_forwards]" style={{ width: "100%" }} />
            </div>
          );
        })}
      </div>
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
        onEvidenceFrameIntervalChange={setEvidenceFrameInterval}
        onUseMjpegChange={setUseMjpeg}
        onDeduplicateFramesChange={setDeduplicateFrames}
        onInspectorEnabledChange={setInspectorEnabled}
        onSignalsEnabledChange={setSignalsEnabled}
        onHistoryEnabledChange={setHistoryEnabled}
        onMaxHistoryEntriesChange={setMaxHistoryEntries}
        onPointerInjectModeChange={setPointerInjectMode}
        onPointerControlModeChange={setPointerControlMode}
        onDockIntervalChange={setDockInterval}
      />
    </div>
  );
}
