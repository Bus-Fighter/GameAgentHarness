import { X, Type, Minus, Plus, ScrollText, Filter, ListRestart, MonitorPlay, Timer, Search, Radio, History } from "lucide-react";
import { ViewTransition } from "react";
import type { DashboardSettings } from "../hooks/useSettings";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  settings: DashboardSettings;
  onFontSizeChange: (value: number) => void;
  onLogsEnabledChange: (value: boolean) => void;
  onLogLevelChange: (value: DashboardSettings["logLevel"]) => void;
  onMaxLogLinesChange: (value: number) => void;
  onEditorViewportEnabledChange: (value: boolean) => void;
  onEditorViewportIntervalChange: (value: number) => void;
  onRuntimeViewportIntervalChange: (value: number) => void;
  onInspectorEnabledChange: (value: boolean) => void;
  onSignalsEnabledChange: (value: boolean) => void;
  onHistoryEnabledChange: (value: boolean) => void;
  onMaxHistoryEntriesChange: (value: number) => void;
}

export function SettingsPanel({
  open,
  onClose,
  settings,
  onFontSizeChange,
  onLogsEnabledChange,
  onLogLevelChange,
  onMaxLogLinesChange,
  onEditorViewportEnabledChange,
  onEditorViewportIntervalChange,
  onRuntimeViewportIntervalChange,
  onInspectorEnabledChange,
  onSignalsEnabledChange,
  onHistoryEnabledChange,
  onMaxHistoryEntriesChange,
}: SettingsPanelProps) {
  if (!open) return null;

  return (
    <ViewTransition enter="scale-in" exit="scale-out" default="none">
      <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 backdrop-blur sm:items-center" onClick={onClose}>
        <div
          className="w-full max-w-sm rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--text)]">Settings</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                <Type className="h-4 w-4 text-[var(--accent)]" />
                Font size
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onFontSizeChange(settings.fontSize - 1)}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-[3ch] text-center text-sm font-semibold text-[var(--text)]">{settings.fontSize}px</span>
                <button
                  type="button"
                  onClick={() => onFontSizeChange(settings.fontSize + 1)}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                <ScrollText className="h-4 w-4 text-[var(--accent)]" />
                Engine logs
              </div>
              <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={settings.logsEnabled}
                  onChange={(e) => onLogsEnabledChange(e.target.checked)}
                />
                Enable log streaming
              </label>
              <div className="mb-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                  <Filter className="h-3.5 w-3.5" />
                  Minimum level
                </div>
                <select
                  value={settings.logLevel}
                  onChange={(e) => onLogLevelChange(e.target.value as DashboardSettings["logLevel"])}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                >
                  <option value="all">All</option>
                  <option value="verbose">Verbose+</option>
                  <option value="info">Info+</option>
                  <option value="warning">Warning+</option>
                  <option value="error">Error+</option>
                </select>
              </div>
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                  <ListRestart className="h-3.5 w-3.5" />
                  Max lines
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onMaxLogLinesChange(settings.maxLogLines - 50)}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-[4ch] text-center text-sm font-semibold text-[var(--text)]">{settings.maxLogLines}</span>
                  <button
                    type="button"
                    onClick={() => onMaxLogLinesChange(settings.maxLogLines + 50)}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                <MonitorPlay className="h-4 w-4 text-[var(--accent)]" />
                Viewport streaming
              </div>
              <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={settings.editorViewportEnabled}
                  onChange={(e) => onEditorViewportEnabledChange(e.target.checked)}
                />
                Stream editor viewport
              </label>
              <div className="mb-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                  <Timer className="h-3.5 w-3.5" />
                  Editor interval (s)
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onEditorViewportIntervalChange(settings.editorViewportInterval - 0.05)}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-[4ch] text-center text-sm font-semibold text-[var(--text)]">{settings.editorViewportInterval.toFixed(2)}s</span>
                  <button
                    type="button"
                    onClick={() => onEditorViewportIntervalChange(settings.editorViewportInterval + 0.05)}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                  <Timer className="h-3.5 w-3.5" />
                  Runtime interval (s)
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onRuntimeViewportIntervalChange(settings.runtimeViewportInterval - 0.05)}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-[4ch] text-center text-sm font-semibold text-[var(--text)]">{settings.runtimeViewportInterval.toFixed(2)}s</span>
                  <button
                    type="button"
                    onClick={() => onRuntimeViewportIntervalChange(settings.runtimeViewportInterval + 0.05)}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                <Search className="h-4 w-4 text-[var(--accent)]" />
                Inspector
              </div>
              <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={settings.inspectorEnabled}
                  onChange={(e) => onInspectorEnabledChange(e.target.checked)}
                />
                Send selected node properties
              </label>
              <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-[var(--text)]">
                <Radio className="h-4 w-4 text-[var(--muted)]" />
                <input
                  type="checkbox"
                  checked={settings.signalsEnabled}
                  onChange={(e) => onSignalsEnabledChange(e.target.checked)}
                />
                Include signal list
              </label>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                <History className="h-4 w-4 text-[var(--accent)]" />
                Action history
              </div>
              <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={settings.historyEnabled}
                  onChange={(e) => onHistoryEnabledChange(e.target.checked)}
                />
                Record harness actions
              </label>
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                  <ListRestart className="h-3.5 w-3.5" />
                  Max entries
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onMaxHistoryEntriesChange(settings.maxHistoryEntries - 50)}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-[4ch] text-center text-sm font-semibold text-[var(--text)]">{settings.maxHistoryEntries}</span>
                  <button
                    type="button"
                    onClick={() => onMaxHistoryEntriesChange(settings.maxHistoryEntries + 50)}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ViewTransition>
  );
}
