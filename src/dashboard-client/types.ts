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

export interface SignalSubscription {
  match: {
    nodeClass?: string;
    nodeName?: string;
    nodePath?: string;
  };
  signal: string;
  eventType: string;
  argMapping: (string | { name: string } | Record<string, unknown>)[];
}

export interface HelloMessage {
  kind: "hello";
  traceId: string | null;
  signalSubscriptions: SignalSubscription[];
}

export interface StatusMessage {
  kind: "status";
  traceActive: boolean;
  traceId: string | null;
  dashboardClients: number;
  dashboardWsClients: number;
  dashboardSseClients: number;
  engineClients: number;
  lastEngineAt: string | null;
  editorActive: boolean;
  intakeUrl: string;
  latestFrame: FrameMessage | null;
}

export type WebSocketMessage =
  | FrameMessage
  | TraceMessage
  | EventMessage
  | ContextMessage
  | HelloMessage
  | StatusMessage
  | { kind: "pong" };

export interface HarnessEvent {
  seq: number;
  type: string;
  receivedAt: string;
  data?: Record<string, unknown>;
}

export interface HarnessLog {
  seq: number;
  level: "verbose" | "info" | "warning" | "error";
  message: string;
  receivedAt: string;
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

export interface HarnessNode {
  id: string;
  kind: string;
  name: string;
  type: string;
  path: string;
}

export interface HarnessSceneNode extends HarnessNode {
  hasChildren: boolean;
  children?: HarnessSceneNode[];
}

export interface HarnessProperty {
  name: string;
  type: string;
  value: unknown;
  group?: string;
}

export interface HarnessSignal {
  name: string;
  args: string[];
  connectionCount: number;
}

export interface HarnessInspectorData {
  node: HarnessNode;
  properties: HarnessProperty[];
  signals: HarnessSignal[];
}

export interface HarnessHistoryAction {
  seq: number;
  source: string;
  action: string;
  data?: Record<string, unknown>;
  receivedAt: string;
}

export interface ResourcePreview {
  path: string;
  ok: boolean;
  previewUrl?: string;
  width?: number;
  height?: number;
  error?: string;
}

export interface ResourceImportSettings {
  path: string;
  ok: boolean;
  settings?: Record<string, Record<string, string>>;
  error?: string;
}

export interface StatusResponse {
  traceActive: boolean;
  traceId: string | null;
  dashboardClients: number;
  dashboardWsClients: number;
  dashboardSseClients: number;
  engineClients: number;
  lastEngineAt: string | null;
  editorActive: boolean;
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
