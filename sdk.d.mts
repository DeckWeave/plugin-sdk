export const SDK_VERSION: "0.1.0";
export function escapeXml(value: unknown): string;
export function svgDataUrl(svg: string): string;
export interface HostArguments {
  port: number;
  uuid: string;
  registerEvent: string;
  info: Record<string, any>;
}
export function parseArguments(argv?: string[]): HostArguments;
export interface Message {
  event: string;
  context?: string;
  action?: string;
  device?: string;
  payload?: Record<string, any>;
}
export interface Context<S extends Record<string, any> = Record<string, any>> {
  panel?: PanelRecord;
  capabilities: Record<string, number>;
  service(operation: string, payload: unknown): Promise<any>;
  playSound(options: {
    sound: "complete" | "notice" | "warning";
    volume?: number;
    eventId: string;
  }): Promise<{ status: "accepted" | "duplicate" }>;
  panels: {
    get(key?: string): Promise<PanelRecord>;
    open(key: string, spec: PanelSpec): Promise<PanelRecord>;
    update(
      id: string,
      value: { value: string; detail?: string },
      revision?: number,
    ): Promise<{ status: "updated" }>;
    configure(
      id: string,
      revision: number,
      spec: PanelSpec,
    ): Promise<PanelRecord>;
    close(id: string, revision: number): Promise<PanelRecord>;
    timer(
      id: string,
      command: "start" | "pause" | "reset" | "stop",
      options?: {
        sound?: "complete" | "notice" | "warning" | null;
        volume?: number;
      },
    ): Promise<unknown>;
  };
  id: string;
  action: string;
  device: string;
  controller: string;
  settings: S;
  canvas: [number, number];
  state: Record<string, any>;
  readonly active: boolean;
  readonly signal: AbortSignal;
  send(event: string, payload?: unknown): boolean;
  setTitle(title: string): boolean;
  setImage(image: string): boolean;
  setState(state: number): boolean;
  setFeedback(payload: Record<string, any>): boolean;
  setFeedbackLayout(layout: string): boolean;
  setSettings(settings: S): boolean;
  getSettings(): boolean;
  showAlert(message?: string): boolean;
  showOk(): boolean;
  /** Request this action's host-configured experimental notification; no target payload. */
  notifyKeyLighting(): boolean;
  sendToPropertyInspector(payload: unknown): boolean;
  onDispose(fn: () => unknown): () => void;
  interval(fn: () => unknown, milliseconds: number): () => void;
  timeout(fn: () => unknown, milliseconds: number): () => void;
}
export interface Plugin {
  services: Map<string, Context>;
  capabilities: Record<string, number>;
  socket: WebSocket;
  contexts: Map<string, Context>;
  info: Record<string, any>;
  on(
    event:
      | "willAppear"
      | "didReceiveSettings"
      | "keyDown"
      | "keyUp"
      | "dialDown"
      | "dialUp"
      | "dialRotate"
      | "touchTap"
      | "panelDown"
      | "panelMove"
      | "panelUp"
      | "panelCancel"
      | "panelSwipe"
      | "willDisappear",
    fn: (context: Context, message: Message) => unknown,
  ): () => void;
  on(
    event: string,
    fn: (context: Context | undefined, message: Message) => unknown,
  ): () => void;
  send(event: string, context?: string, payload?: unknown): boolean;
  dispose(): void;
  onDispose(fn: () => unknown): () => void;
  setGlobalSettings(settings: Record<string, any>): boolean;
  getGlobalSettings(): boolean;
}
export interface PanelSpec {
  title: string;
  content:
    | { type: "note"; text: string }
    | { type: "metric"; value: string; detail: string }
    | {
        type: "timer";
        seconds: number;
        sound?: "complete" | "notice" | "warning" | null;
        volume?: number;
      };
  placement?: Partial<{
    anchor: "top_left" | "top_right" | "bottom_left" | "bottom_right" | "free";
    monitor: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    background: string;
    foreground: string;
    opacity: number;
    click_through: boolean;
  }>;
}
export interface PanelRecord {
  id: string;
  service_id: string;
  owner: string;
  origin: string;
  local_key: string;
  revision: number;
  open: boolean;
  spec: PanelSpec;
}
/** Additive host-owned Pomodoro API via ctx.service('focus_get'|'focus_control', payload). */
export interface FocusConfig {
  work_seconds: number;
  short_seconds: number;
  long_seconds: number;
  rounds: number;
  sound: "complete" | "notice" | "warning" | null;
  volume: number;
}
export interface FocusView {
  version: 1;
  owner: string;
  workspace: string;
  revision: number;
  run_id: string;
  phase: "work" | "short_break" | "long_break";
  status: "idle" | "running" | "paused" | "ready";
  round: number;
  config: FocusConfig;
  remaining_ms: number;
  due_ms: number | null;
  transition: number;
  live_remaining_ms: number;
}
export interface FocusControl {
  workspace: string;
  revision: number;
  commandId: string;
  command: "start" | "pause" | "toggle" | "reset" | "skip" | "configure";
  config?: FocusConfig;
}
export function createPlugin(options?: {
  argv?: string[];
  arguments?: HostArguments;
  WebSocket?: typeof WebSocket;
  onError?: (error: unknown, message?: unknown) => void;
}): Plugin;
