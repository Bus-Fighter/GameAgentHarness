import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "harness-dashboard-settings";

export interface DashboardSettings {
  fontSize: number;
  logsEnabled: boolean;
  logLevel: "all" | "verbose" | "info" | "warning" | "error";
  maxLogLines: number;
  editorViewportEnabled: boolean;
  editorViewportInterval: number;
  runtimeViewportInterval: number;
  evidenceFrameInterval: number;
  useMjpeg: boolean;
  deduplicateFrames: boolean;
  inspectorEnabled: boolean;
  signalsEnabled: boolean;
  historyEnabled: boolean;
  maxHistoryEntries: number;
  pointerInjectMode: "touch" | "mouse";
  ignorePatterns: string[];
  viewportCompact: boolean;
  dockInterval: number;
  enabledDocks: string[];
}

const DEFAULTS: DashboardSettings = {
  fontSize: 14,
  logsEnabled: true,
  logLevel: "info",
  maxLogLines: 500,
  editorViewportEnabled: false,
  editorViewportInterval: 0.2,
  runtimeViewportInterval: 0.5,
  evidenceFrameInterval: 5.0,
  useMjpeg: true,
  deduplicateFrames: true,
  inspectorEnabled: true,
  signalsEnabled: true,
  historyEnabled: true,
  maxHistoryEntries: 200,
  pointerInjectMode: "touch",
  ignorePatterns: ["*.uid"],
  viewportCompact: false,
  dockInterval: 0.5,
  enabledDocks: ["filesystem", "inspector"],
};

function loadSettings(): DashboardSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DashboardSettings>;
    return {
      ...DEFAULTS,
      ...parsed,
      fontSize: Math.max(10, Math.min(24, Number(parsed.fontSize) || DEFAULTS.fontSize)),
      maxLogLines: Math.max(50, Math.min(5000, Number(parsed.maxLogLines) || DEFAULTS.maxLogLines)),
      logLevel: ["all", "verbose", "info", "warning", "error"].includes(parsed.logLevel || "")
        ? (parsed.logLevel as DashboardSettings["logLevel"])
        : DEFAULTS.logLevel,
      editorViewportInterval: Math.max(0.05, Math.min(2.0, Number(parsed.editorViewportInterval) || DEFAULTS.editorViewportInterval)),
      runtimeViewportInterval: Math.max(0.05, Math.min(2.0, Number(parsed.runtimeViewportInterval) || DEFAULTS.runtimeViewportInterval)),
      evidenceFrameInterval: Math.max(0.5, Math.min(60.0, Number(parsed.evidenceFrameInterval) || DEFAULTS.evidenceFrameInterval)),
      useMjpeg: typeof parsed.useMjpeg === "boolean" ? parsed.useMjpeg : DEFAULTS.useMjpeg,
      deduplicateFrames: typeof parsed.deduplicateFrames === "boolean" ? parsed.deduplicateFrames : DEFAULTS.deduplicateFrames,
      inspectorEnabled: typeof parsed.inspectorEnabled === "boolean" ? parsed.inspectorEnabled : DEFAULTS.inspectorEnabled,
      signalsEnabled: typeof parsed.signalsEnabled === "boolean" ? parsed.signalsEnabled : DEFAULTS.signalsEnabled,
      historyEnabled: typeof parsed.historyEnabled === "boolean" ? parsed.historyEnabled : DEFAULTS.historyEnabled,
      maxHistoryEntries: Math.max(10, Math.min(2000, Number(parsed.maxHistoryEntries) || DEFAULTS.maxHistoryEntries)),
      pointerInjectMode: ["touch", "mouse"].includes(parsed.pointerInjectMode || "")
        ? (parsed.pointerInjectMode as DashboardSettings["pointerInjectMode"])
        : DEFAULTS.pointerInjectMode,
      ignorePatterns: Array.isArray(parsed.ignorePatterns)
        ? parsed.ignorePatterns.filter((p) => typeof p === "string" && p.trim() !== "")
        : DEFAULTS.ignorePatterns,
      viewportCompact: typeof parsed.viewportCompact === "boolean" ? parsed.viewportCompact : DEFAULTS.viewportCompact,
      dockInterval: Math.max(0.05, Math.min(2.0, Number(parsed.dockInterval) || DEFAULTS.dockInterval)),
      enabledDocks: Array.isArray(parsed.enabledDocks)
        ? parsed.enabledDocks.filter((d) => typeof d === "string" && d.trim() !== "")
        : DEFAULTS.enabledDocks,
    };
  } catch {
    return DEFAULTS;
  }
}

function saveSettings(settings: DashboardSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

export function useSettings(): {
  settings: DashboardSettings;
  setFontSize: (value: number) => void;
  setLogsEnabled: (value: boolean) => void;
  setLogLevel: (value: DashboardSettings["logLevel"]) => void;
  setMaxLogLines: (value: number) => void;
  setEditorViewportEnabled: (value: boolean) => void;
  setEditorViewportInterval: (value: number) => void;
  setRuntimeViewportInterval: (value: number) => void;
  setEvidenceFrameInterval: (value: number) => void;
  setUseMjpeg: (value: boolean) => void;
  setDeduplicateFrames: (value: boolean) => void;
  setInspectorEnabled: (value: boolean) => void;
  setSignalsEnabled: (value: boolean) => void;
  setHistoryEnabled: (value: boolean) => void;
  setMaxHistoryEntries: (value: number) => void;
  setPointerInjectMode: (value: DashboardSettings["pointerInjectMode"]) => void;
  setIgnorePatterns: (value: string[]) => void;
  setViewportCompact: (value: boolean) => void;
  setDockInterval: (value: number) => void;
  setEnabledDocks: (value: string[]) => void;
} {
  const [settings, setSettings] = useState<DashboardSettings>(loadSettings);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const setFontSize = useCallback((value: number) => {
    const clamped = Math.max(10, Math.min(24, value));
    setSettings((prev) => ({ ...prev, fontSize: clamped }));
  }, []);

  const setLogsEnabled = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, logsEnabled: value }));
  }, []);

  const setLogLevel = useCallback((value: DashboardSettings["logLevel"]) => {
    setSettings((prev) => ({ ...prev, logLevel: value }));
  }, []);

  const setMaxLogLines = useCallback((value: number) => {
    const clamped = Math.max(50, Math.min(5000, value));
    setSettings((prev) => ({ ...prev, maxLogLines: clamped }));
  }, []);

  const setEditorViewportEnabled = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, editorViewportEnabled: value }));
  }, []);

  const setEditorViewportInterval = useCallback((value: number) => {
    const clamped = Math.max(0.05, Math.min(2.0, value));
    setSettings((prev) => ({ ...prev, editorViewportInterval: clamped }));
  }, []);

  const setRuntimeViewportInterval = useCallback((value: number) => {
    const clamped = Math.max(0.05, Math.min(2.0, value));
    setSettings((prev) => ({ ...prev, runtimeViewportInterval: clamped }));
  }, []);

  const setEvidenceFrameInterval = useCallback((value: number) => {
    const clamped = Math.max(0.5, Math.min(60.0, value));
    setSettings((prev) => ({ ...prev, evidenceFrameInterval: clamped }));
  }, []);

  const setUseMjpeg = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, useMjpeg: value }));
  }, []);

  const setDeduplicateFrames = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, deduplicateFrames: value }));
  }, []);

  const setInspectorEnabled = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, inspectorEnabled: value }));
  }, []);

  const setSignalsEnabled = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, signalsEnabled: value }));
  }, []);

  const setHistoryEnabled = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, historyEnabled: value }));
  }, []);

  const setMaxHistoryEntries = useCallback((value: number) => {
    const clamped = Math.max(10, Math.min(2000, value));
    setSettings((prev) => ({ ...prev, maxHistoryEntries: clamped }));
  }, []);

  const setPointerInjectMode = useCallback((value: DashboardSettings["pointerInjectMode"]) => {
    setSettings((prev) => ({ ...prev, pointerInjectMode: value }));
  }, []);

  const setIgnorePatterns = useCallback((value: string[]) => {
    const cleaned = value.map((p) => p.trim()).filter(Boolean);
    setSettings((prev) => ({ ...prev, ignorePatterns: cleaned }));
  }, []);

  const setViewportCompact = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, viewportCompact: value }));
  }, []);

  const setDockInterval = useCallback((value: number) => {
    const clamped = Math.max(0.05, Math.min(2.0, value));
    setSettings((prev) => ({ ...prev, dockInterval: clamped }));
  }, []);

  const setEnabledDocks = useCallback((value: string[] | ((prev: string[]) => string[])) => {
    setSettings((prev) => {
      const next = typeof value === "function" ? (value as (prev: string[]) => string[])(prev.enabledDocks) : value;
      const cleaned = next.map((d) => d.trim()).filter(Boolean);
      return { ...prev, enabledDocks: cleaned };
    });
  }, []);

  return { settings, setFontSize, setLogsEnabled, setLogLevel, setMaxLogLines, setEditorViewportEnabled, setEditorViewportInterval, setRuntimeViewportInterval, setEvidenceFrameInterval, setUseMjpeg, setDeduplicateFrames, setInspectorEnabled, setSignalsEnabled, setHistoryEnabled, setMaxHistoryEntries, setPointerInjectMode, setIgnorePatterns, setViewportCompact, setDockInterval, setEnabledDocks };
}
