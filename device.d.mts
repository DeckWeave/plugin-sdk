export const DEVICE_PROTOCOL: 1;
export const LIMITS: Readonly<{
  lineBytes: number;
  sessionQueue: number;
  sessions: number;
  outbound: number;
}>;
export type Evidence = "unknown" | "accepted" | "verified" | "unsupported";
export type InputEvent =
  "down" | "up" | "rotate" | "touchStart" | "touchMove" | "touchEnd";
export interface Label {
  en: string;
  ru: string;
}
export interface SettingBase {
  id: string;
  label: Label;
  group?: string;
  persistence: "volatile" | "onboard";
  readback: boolean;
}
export type Setting = SettingBase &
  (
    | { type: "boolean" }
    | { type: "number"; min: number; max: number; step?: number }
    | {
        type: "choice";
        choices: Array<{
          value: string | number | boolean | null;
          label: Label;
        }>;
      }
  );
export interface DisplayTarget {
  id: string;
  width: number;
  height: number;
  mime: string[];
}
export interface Decoration {
  id:string;kind:"light-strip";label:Label;x:number;y:number;width:number;height:number;
}
export interface LightingGroup {
  id: string;
  label: Label;
  kind: string;
  controls?: string[];
  settings?: string[];
  staticColors?: { settingId: string; address: "controlId" };
  hostCompositions?: boolean;
}
export interface KeyboardCapabilities {
  onboardMappings?: {
    settingId: string;
    address: "controlId";
    layers: Array<"main" | "fn">;
    bindingFormat: "keyboard-usage";
    readback: boolean;
    persistence: "onboard";
  };
  actuation?: {
    settingId: string;
    address: "controlId";
    minUm: number;
    maxUm: number;
    stepUm: number;
    rapidMinUm: number;
    fields?: Array<
      | "triggerUm"
      | "pressUm"
      | "releaseUm"
      | "rapidTrigger"
      | "wholeTravel"
      | "rampage"
    >;
    readback: boolean;
    persistence: "onboard";
  };
}
export interface DeviceState {
  observed: Record<string, unknown>;
  requested?: Record<string, unknown>;
  evidence: { transport: Evidence; readback: Evidence; physical: Evidence };
}
export interface Descriptor {
  instanceId: string;
  modelId: string;
  name: string;
  identity: { confidence: "session" | "verified"; persistentId: string | null };
  geometry: { width: number; height: number };
  controls: Array<{
    id: string;
    kind: "key" | "dial" | "touch";
    x: number;
    y: number;
    width: number;
    height: number;
    events: InputEvent[];
    telemetry?: { keyTravel: true };
  }>;
  displays: DisplayTarget[];
  decorations?:Decoration[];
  settings: Setting[];
  lighting: LightingGroup[];
  keyboard?: KeyboardCapabilities;
  recovery?: { preview: boolean; restore: boolean };
  observation?: { keyTravel: {
    minUm: 0; maxUm: number; staleAfterMs: 600; normalTyping: boolean;
    evidence: "partial" | "verified";
  } };
}
export interface Context {
  signal: AbortSignal;
  input: (control: string, event: InputEvent, value?: unknown) => boolean;
  depth: (control: string, value: { travelUm: number; maxTravelUm?: number }) => boolean;
}
export interface Adapter {
  descriptor: Descriptor;
  readState: (request: {
    signal: AbortSignal;
  }) => Promise<DeviceState> | DeviceState;
  setSettings?: (request: {
    changes: Record<string, unknown>;
    signal: AbortSignal;
  }) => Promise<DeviceState> | DeviceState;
  display?: (request: {
    target: string;
    mime: string;
    data: string;
    signal: AbortSignal;
  }) => unknown;
  cancel?: () => unknown;
  /** Volatile observer only; preserve normal typing and stop on close/EOF/lease expiry. */
  observe?: (request: { enabled: boolean; signal: AbortSignal }) =>
    { observing: boolean } | Promise<{ observing: boolean }>;
  close?: () => unknown;
  recoveryPreview?: (request: {
    snapshotId?: string;
    signal: AbortSignal;
  }) => unknown;
  recover?: (request: {
    previewToken: string;
    confirmedInstanceId: string;
    signal: AbortSignal;
  }) => unknown;
}
export interface ProviderOptions {
  id: string;
  discover: () => Descriptor[] | Promise<Descriptor[]>;
  open: (instanceId: string, context: Context) => Adapter | Promise<Adapter>;
  send: (message: unknown) => void;
  limits?: Partial<typeof LIMITS>;
  recoveryOnly?: boolean;
}
export class DeviceError extends Error {
  code: string;
  constructor(code: string, message: string);
}
export function validateDescriptor(value: unknown): Descriptor;
export function validateDeviceManifest(value: unknown): {
  kind: "device";
  protocol: 1;
  id: string;
  name: string;
  version: string;
  runtime: "node" | "native";
  entry: string;
  models: string[];
  platforms: string[];
};
export class DeviceProvider {
  constructor(options: ProviderOptions);
  receive(message: unknown): Promise<void>;
  input(
    session: string,
    generation: number,
    control: string,
    event: string,
    value?: unknown,
  ): boolean;
  depth(session: string, generation: number, control: string,
    value: { travelUm: number; maxTravelUm?: number }): boolean;
  shutdown(): void;
}
export function serveDevice(
  options: Omit<ProviderOptions, "send">,
  streams?: {
    input?: unknown;
    output?: unknown;
    onError?: (error: Error) => void;
  },
): { provider: DeviceProvider; close: () => void };
