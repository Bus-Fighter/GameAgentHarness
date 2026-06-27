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
  inspectorEnabled: boolean;
  signalsEnabled: boolean;
  historyEnabled: boolean;
  maxHistoryEntries: number;
}

const DEFAULTS: DashboardSettings = {
  fontSize: 14,
  logsEnabled: true,
  logLevel: "info",
  maxLogLines: 500,
  editorViewportEnabled: false,
  editorViewportInterval: 0.2,
  runtimeViewportInterval: 0.2,
  inspectorEnabled: true,
  signalsEnabled: true,
  historyEnabled: true,
  maxHistoryEntries: 200,
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
      inspectorEnabled: typeof parsed.inspectorEnabled === "boolean" ? parsed.inspectorEnabled : DEFAULTS.inspectorEnabled,
      signalsEnabled: typeof parsed.signalsEnabled === "boolean" ? parsed.signalsEnabled : DEFAULTS.signalsEnabled,
      historyEnabled: typeof parsed.historyEnabled === "boolean" ? parsed.historyEnabled : DEFAULTS.historyEnabled,
      maxHistoryEntries: Math.max(10, Math.min(2000, Number(parsed.maxHistoryEntries) || DEFAULTS.maxHistoryEntries)),
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
  setInspectorEnabled: (value: boolean) => void;
  setSignalsEnabled: (value: boolean) => void;
  setHistoryEnabled: (value: boolean) => void;
  setMaxHistoryEntries: (value: number) => void;
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

  return { settings, setFontSize, setLogsEnabled, setLogLevel, setMaxLogLines, setEditorViewportEnabled, setEditorViewportInterval, setRuntimeViewportInterval, setInspectorEnabled, setSignalsEnabled, setHistoryEnabled, setMaxHistoryEntries };
}
