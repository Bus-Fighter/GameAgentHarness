export interface FrameMessage {
  kind: "frame";
  seq: number;
  source: string;
  width?: number;
  height?: number;
  receivedAt: string;
}

export interface TraceMessage {
  kind: "trace";
  traceId: string | null;
  active: boolean;
}

export interface EventMessage {
  kind: "event";
  event: HarnessEvent;
}

export interface ContextMessage {
  kind: "context";
  context: HarnessContext;
}

export interface HelloMessage {
  kind: "hello";
  traceId: string | null;
}

export type WebSocketMessage =
  | FrameMessage
  | TraceMessage
  | EventMessage
  | ContextMessage
  | HelloMessage
  | { kind: "pong" };

export interface HarnessEvent {
  seq: number;
  type: string;
  receivedAt: string;
  data?: Record<string, unknown>;
}

export interface HarnessContext {
  scene?: string;
  runtime?: { running?: boolean };
  observed?: {
    project?: { name?: string };
    engine?: { name?: string };
  };
  profile?: {
    project?: { name?: string };
    engine?: { name?: string };
  };
}

export interface StatusResponse {
  traceActive: boolean;
  traceId: string | null;
  dashboardClients: number;
  dashboardWsClients: number;
  dashboardSseClients: number;
  engineClients: number;
  lastEngineAt: string | null;
  intakeUrl: string;
  latestFrame: FrameMessage | null;
}

export interface GitStatus {
  ok: boolean;
  branch: string | null;
  upstream: string | null;
  files: GitFile[];
}

export interface GitFile {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
}

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

export interface FileTreeResponse {
  ok: boolean;
  path: string;
  entries: FileEntry[];
}

export interface FileContentResponse {
  ok: boolean;
  path: string;
  type: "file" | "directory";
  content?: string;
}

export interface ControlMessage {
  kind: "control";
  action: string;
  enabled?: boolean;
  path?: string;
  content?: string;
  [key: string]: unknown;
}
