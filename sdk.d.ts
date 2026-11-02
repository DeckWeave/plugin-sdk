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
  showAlert(): boolean;
  showOk(): boolean;
  /** Request this action's host-configured experimental notification; no target payload. */
  notifyKeyLighting(): boolean;
  sendToPropertyInspector(payload: unknown): boolean;
  onDispose(fn: () => unknown): () => void;
  interval(fn: () => unknown, milliseconds: number): () => void;
  timeout(fn: () => unknown, milliseconds: number): () => void;
}
export interface Plugin {
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
export function createPlugin(options?: {
  argv?: string[];
  arguments?: HostArguments;
  WebSocket?: typeof WebSocket;
  onError?: (error: unknown, message?: unknown) => void;
}): Plugin;
