import {
  Circle,
  Camera,
  Play,
  Pause,
  Square,
  RefreshCw,
  Trash2,
  Monitor,
} from "lucide-react";

interface TransportToolbarProps {
  runtimeRunning: boolean;
  engineConnected: boolean;
  captureEnabled: boolean;
  paused: boolean;
  onRecord: () => void;
  onSnapshot: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onReconnect: () => void;
  onClearEvidence: () => void;
  onLaunchEditor?: () => void;
}

export function TransportToolbar({
  runtimeRunning,
  engineConnected,
  captureEnabled,
  paused,
  onRecord,
  onSnapshot,
  onPlay,
  onPause,
  onStop,
  onReconnect,
  onClearEvidence,
  onLaunchEditor,
}: TransportToolbarProps) {
  const recording = captureEnabled && runtimeRunning;
  const launchLabel = engineConnected ? "Restart Godot" : "Launch Godot";

  return (
    <nav
      className="fixed bottom-[calc(var(--tabs-h)+12px)] left-1/2 z-50 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border border-[var(--border)] bg-[rgba(15,23,42,0.96)] p-1.5 shadow-lg backdrop-blur lg:bottom-3"
      style={{ viewTransitionName: "persistent-toolbar" }}
    >
      {onLaunchEditor && (
        <ToolbarButton onClick={onLaunchEditor} label={launchLabel}>
          <Monitor className="h-4.5 w-4.5" />
        </ToolbarButton>
      )}
      <ToolbarButton
        onClick={onRecord}
        disabled={!runtimeRunning}
        active={recording}
        label="Record"
        danger={recording}
      >
        <Circle className={`h-4.5 w-4.5 ${recording ? "fill-current" : ""}`} />
      </ToolbarButton>
      <ToolbarButton onClick={onSnapshot} label="Snapshot">
        <Camera className="h-4.5 w-4.5" />
      </ToolbarButton>
      <div className="mx-1 h-7 w-px bg-[var(--border)]" />
      <ToolbarButton
        onClick={onPlay}
        disabled={!engineConnected || runtimeRunning}
        active={runtimeRunning}
        label="Play"
      >
        <Play className="h-4.5 w-4.5 fill-current" />
      </ToolbarButton>
      <ToolbarButton
        onClick={onPause}
        disabled={!runtimeRunning}
        active={paused}
        label={paused ? "Resume" : "Pause"}
      >
        <Pause className="h-4.5 w-4.5 fill-current" />
      </ToolbarButton>
      <ToolbarButton
        onClick={onStop}
        disabled={!engineConnected || !runtimeRunning}
        label="Stop"
      >
        <Square className="h-4.5 w-4.5 rounded-sm fill-current" />
      </ToolbarButton>
      <div className="mx-1 h-7 w-px bg-[var(--border)]" />
      <ToolbarButton onClick={onReconnect} label="Reconnect">
        <RefreshCw className="h-4.5 w-4.5" />
      </ToolbarButton>
      <ToolbarButton onClick={onClearEvidence} label="Clear">
        <Trash2 className="h-4.5 w-4.5" />
      </ToolbarButton>
    </nav>
  );
}

interface ToolbarButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  label: string;
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  active,
  danger,
  label,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? danger
            ? "border-[rgba(239,68,68,0.4)] bg-[var(--danger-dim)] text-[var(--danger)] shadow-[0_0_12px_rgba(239,68,68,0.25)]"
            : "border-[rgba(34,197,94,0.4)] bg-[var(--accent-dim)] text-[var(--accent)]"
          : "border-transparent bg-transparent text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
      }`}
    >
      {children}
      <span className="hidden pr-1.5 sm:inline">{label}</span>
    </button>
  );
}
