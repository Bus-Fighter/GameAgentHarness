import { useState, useEffect, useCallback, useRef } from "react";
import { Server, Plug, Copy, Check, RefreshCw, Cable, Cpu } from "lucide-react";
import { PanelHeaderActions } from "./PanelHeaderActions";
import { startMcp, stopMcp, fetchMcpIdeConfigs, installMcpConfig, fetchGodotProcesses, killGodotProcess } from "../api";
import type { McpStatus, McpIdeConfig, GodotProcessInfo } from "../types";

interface McpPanelProps {
  status: McpStatus | null;
  onRefresh: () => Promise<void>;
}

interface InstallState {
  pending: boolean;
  ok?: boolean;
  backupPath?: string;
  error?: string;
}

function formatUptime(startedAt: string | null): string {
  if (!startedAt) return "-";
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "-";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function snippetText(snippet: unknown): string {
  return typeof snippet === "string" ? snippet : JSON.stringify(snippet, null, 2);
}

function extractStdioCommand(snippet: unknown): string | null {
  if (typeof snippet === "string") {
    const match = snippet.match(/node\s+\S*cli\.js\s+mcp\s+serve/);
    return match ? match[0] : null;
  }
  if (snippet && typeof snippet === "object") {
    const stdio = (snippet as { stdio?: { command?: string; args?: string[] } }).stdio;
    if (stdio?.command && Array.isArray(stdio.args)) {
      return [stdio.command, ...stdio.args].join(" ");
    }
    const match = JSON.stringify(snippet).match(/node[",\s]+\S*cli\.js[",\s]+mcp[",\s]+serve/);
    return match ? match[0].replace(/[",]+/g, " ").replace(/\s+/g, " ").trim() : null;
  }
  return null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed", err);
    }
  }, [text]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
      title={copied ? "Copied" : "Copy"}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[var(--accent)]" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function McpPanel({ status, onRefresh }: McpPanelProps) {
  const [serverCollapsed, setServerCollapsed] = useState(false);
  const [connCollapsed, setConnCollapsed] = useState(false);
  const [ideCollapsed, setIdeCollapsed] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ides, setIdes] = useState<McpIdeConfig[]>([]);
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({});
  const [now, setNow] = useState(Date.now());
  const [procCollapsed, setProcCollapsed] = useState(false);
  const [processes, setProcesses] = useState<GodotProcessInfo[] | null>(null);
  const [procError, setProcError] = useState<string | null>(null);
  const [procLoading, setProcLoading] = useState(false);
  const [confirmKillPid, setConfirmKillPid] = useState<number | null>(null);
  const [killPendingPid, setKillPendingPid] = useState<number | null>(null);

  const running = status?.running ?? false;

  const loadProcesses = useCallback(async () => {
    setProcLoading(true);
    setProcError(null);
    try {
      const res = await fetchGodotProcesses();
      setProcesses(res.processes);
    } catch (err) {
      setProcError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProcesses();
  }, [loadProcesses]);

  const handleKill = useCallback(
    async (pid: number) => {
      if (confirmKillPid !== pid) {
        setConfirmKillPid(pid);
        return;
      }
      setConfirmKillPid(null);
      setKillPendingPid(pid);
      setProcError(null);
      try {
        const res = await killGodotProcess(pid);
        if (!res.ok) setProcError(res.error || `Failed to kill pid ${pid}`);
        await loadProcesses();
      } catch (err) {
        setProcError(err instanceof Error ? err.message : String(err));
      } finally {
        setKillPendingPid(null);
      }
    },
    [confirmKillPid, loadProcesses],
  );

  const loadIdeConfigs = useCallback(async () => {
    try {
      const res = await fetchMcpIdeConfigs();
      setIdes(res.ides);
    } catch (err) {
      console.error("Failed to fetch IDE configs", err);
    }
  }, []);

  useEffect(() => {
    loadIdeConfigs();
  }, [loadIdeConfigs]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  void now;

  const handleToggle = useCallback(async () => {
    setPending(true);
    setActionError(null);
    try {
      if (running) {
        await stopMcp();
      } else {
        await startMcp();
      }
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }, [running, onRefresh]);

  const handleInstall = useCallback(
    async (ide: string) => {
      setInstallStates((prev) => ({ ...prev, [ide]: { pending: true } }));
      try {
        const res = await installMcpConfig(ide);
        if (res.ok) {
          setInstallStates((prev) => ({ ...prev, [ide]: { pending: false, ok: true, backupPath: res.backupPath } }));
          await loadIdeConfigs();
        } else {
          setInstallStates((prev) => ({ ...prev, [ide]: { pending: false, ok: false, error: res.error || "Install failed" } }));
        }
      } catch (err) {
        setInstallStates((prev) => ({
          ...prev,
          [ide]: { pending: false, ok: false, error: err instanceof Error ? err.message : String(err) },
        }));
      }
    },
    [loadIdeConfigs],
  );

  const genericIde = ides.find((i) => i.id === "generic");
  const stdioCommand = genericIde ? extractStdioCommand(genericIde.snippet) : null;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto lg:col-span-2 lg:row-span-3 lg:overflow-visible">
      <section className="card overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            <Server className="h-4 w-4" />
            MCP Server
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[0.7rem] font-semibold ${
                running
                  ? "border-[rgba(34,197,94,0.3)] bg-[var(--accent-dim)] text-[var(--accent)]"
                  : "border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] text-[var(--danger)]"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
              {running ? "Running" : "Stopped"}
            </span>
            <button
              type="button"
              onClick={handleToggle}
              disabled={pending}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[0.7rem] font-semibold text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
              {pending ? "Working..." : running ? "Stop" : "Start"}
            </button>
            <PanelHeaderActions collapsed={serverCollapsed} onToggleCollapse={() => setServerCollapsed((v) => !v)} allowFullscreen={false} />
          </div>
        </div>
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
            serverCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
          }`}
        >
          <div className="grid grid-cols-1 gap-2 overflow-hidden p-3 sm:grid-cols-2">
            {actionError && (
              <div className="sm:col-span-2 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] p-2.5 text-xs text-[var(--danger)]">
                {actionError}
              </div>
            )}
            {running && status && (
              <>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
                  <span className="text-xs text-[var(--muted)]">URL</span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-right text-xs font-medium text-[var(--text)]" title={status.url ?? ""}>
                      {status.url ?? "-"}
                    </span>
                    {status.url && <CopyButton text={status.url} />}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
                  <span className="text-xs text-[var(--muted)]">Transport</span>
                  <span className="text-xs font-medium text-[var(--text)]">{status.transport}</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
                  <span className="text-xs text-[var(--muted)]">Tools</span>
                  <span className="text-xs font-medium text-[var(--text)]">{status.toolCount}</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
                  <span className="text-xs text-[var(--muted)]">Engine</span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold ${
                      status.engineConnected
                        ? "border-[rgba(34,197,94,0.3)] bg-[var(--accent-dim)] text-[var(--accent)]"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {status.engineConnected ? "Connected" : "Not connected"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
                  <span className="text-xs text-[var(--muted)]">Uptime</span>
                  <span className="text-xs font-medium text-[var(--text)]">{formatUptime(status.startedAt)}</span>
                </div>
              </>
            )}
            {!running && (
              <div className="sm:col-span-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5 text-xs text-[var(--muted)]">
                The MCP server is stopped. Start it to expose harness tools to IDE agents.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            <Cpu className="h-4 w-4" />
            Godot Processes
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadProcesses}
              disabled={procLoading}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[0.7rem] font-semibold text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${procLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <PanelHeaderActions collapsed={procCollapsed} onToggleCollapse={() => setProcCollapsed((v) => !v)} allowFullscreen={false} />
          </div>
        </div>
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
            procCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
          }`}
        >
          <div className="grid grid-cols-1 gap-2 overflow-hidden p-3">
            {procError && (
              <div className="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--danger-dim)] p-2.5 text-xs text-[var(--danger)]">
                {procError}
              </div>
            )}
            {processes == null && !procError && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5 text-xs text-[var(--muted)]">
                {procLoading ? "Scanning..." : "No scan yet."}
              </div>
            )}
            {processes != null && processes.length === 0 && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5 text-xs text-[var(--muted)]">
                No running Godot processes found (includes editors and games not started by the harness).
              </div>
            )}
            {processes?.map((proc) => (
              <div key={proc.pid} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`inline-flex flex-shrink-0 items-center rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold ${
                      proc.kind === "editor"
                        ? "border-[rgba(34,197,94,0.3)] bg-[var(--accent-dim)] text-[var(--accent)]"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
                    }`}
                  >
                    {proc.kind}
                  </span>
                  <span className="text-xs font-medium text-[var(--text)]">PID {proc.pid}</span>
                  <span className="truncate text-[0.7rem] text-[var(--muted)]" title={proc.cmdline}>
                    {proc.projectPath ?? proc.exe ?? proc.cmdline}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleKill(proc.pid)}
                  disabled={killPendingPid === proc.pid}
                  className={`inline-flex flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-[0.7rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    confirmKillPid === proc.pid
                      ? "border-[rgba(239,68,68,0.5)] bg-[var(--danger-dim)] text-[var(--danger)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--danger)] hover:text-[var(--danger)]"
                  }`}
                >
                  {killPendingPid === proc.pid ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                  {killPendingPid === proc.pid ? "Killing..." : confirmKillPid === proc.pid ? "Confirm kill" : "Kill"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            <Cable className="h-4 w-4" />
            Connection
          </div>
          <PanelHeaderActions collapsed={connCollapsed} onToggleCollapse={() => setConnCollapsed((v) => !v)} allowFullscreen={false} />
        </div>
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
            connCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
          }`}
        >
          <div className="grid grid-cols-1 gap-2 overflow-hidden p-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
              <span className="text-xs text-[var(--muted)]">HTTP MCP URL</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-right text-xs font-medium text-[var(--text)]" title={status?.url ?? ""}>
                  {status?.url ?? "-"}
                </span>
                {status?.url && <CopyButton text={status.url} />}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
              <span className="text-xs text-[var(--muted)]">Stdio command</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-right text-xs font-medium text-[var(--text)]" title={stdioCommand ?? ""}>
                  {stdioCommand ?? "Start the server to view"}
                </span>
                {stdioCommand && <CopyButton text={stdioCommand} />}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="card overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            <Plug className="h-4 w-4" />
            IDE Setup
          </div>
          <PanelHeaderActions collapsed={ideCollapsed} onToggleCollapse={() => setIdeCollapsed((v) => !v)} allowFullscreen={false} />
        </div>
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
            ideCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
          }`}
        >
          <div className="grid grid-cols-1 gap-3 overflow-hidden p-3 md:grid-cols-2 xl:grid-cols-3">
            {ides.map((ide) => {
              const install = installStates[ide.id];
              return (
                <div key={ide.id} className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text)]">{ide.label}</span>
                    {ide.configured ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(34,197,94,0.3)] bg-[var(--accent-dim)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--accent)]">
                        Configured
                      </span>
                    ) : ide.exists ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--muted)]">
                        Not configured
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(245,158,11,0.3)] bg-[var(--warning-dim)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--warning)]">
                        Config file missing
                      </span>
                    )}
                  </div>
                  <span className="truncate text-[0.7rem] text-[var(--muted)]" title={ide.configPath ?? undefined}>
                    {ide.configPath ?? "manual setup"}
                  </span>
                  <div className="relative">
                    <pre className="max-h-32 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-[0.7rem] leading-relaxed text-[var(--muted)]">
                      {snippetText(ide.snippet)}
                    </pre>
                    <div className="absolute right-1.5 top-1.5">
                      <CopyButton text={snippetText(ide.snippet)} />
                    </div>
                  </div>
                  {ide.altSnippet != null && (
                    <div className="relative">
                      <pre className="max-h-32 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-[0.7rem] leading-relaxed text-[var(--muted)]">
                        {snippetText(ide.altSnippet)}
                      </pre>
                      <div className="absolute right-1.5 top-1.5">
                        <CopyButton text={snippetText(ide.altSnippet)} />
                      </div>
                    </div>
                  )}
                  {ide.installable && !ide.configured && (
                    <button
                      type="button"
                      onClick={() => handleInstall(ide.id)}
                      disabled={install?.pending}
                      className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[rgba(34,197,94,0.4)] bg-[var(--accent-dim)] px-2 py-1.5 text-xs font-semibold text-[var(--accent)] transition-colors hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {install?.pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                      {install?.pending ? "Installing..." : "Install"}
                    </button>
                  )}
                  {install?.ok && (
                    <span className="text-[0.7rem] text-[var(--accent)]">
                      Installed{install.backupPath ? ` (backup: ${install.backupPath})` : ""}
                    </span>
                  )}
                  {install && !install.ok && install.error && (
                    <span className="text-[0.7rem] text-[var(--danger)]">{install.error}</span>
                  )}
                </div>
              );
            })}
            {ides.length === 0 && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs text-[var(--muted)]">
                Loading IDE configs...
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
