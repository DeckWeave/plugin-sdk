import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import {
  DeviceProvider,
  serveDevice,
  validateDescriptor,
  validateDeviceManifest,
  LIMITS,
} from "../device.mjs";
const descriptor = (instanceId) => ({
  instanceId,
  modelId: "dev.test.board",
  name: instanceId,
  identity: { confidence: "session", persistentId: null },
  geometry: { width: 2, height: 1 },
  controls: [
    {
      id: "key-1",
      kind: "key",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      events: ["down", "up"],
    },
  ],
  displays: [],
  settings: [],
  lighting: [],
});
const tick = () => new Promise((r) => setImmediate(r));
test("keepCurrent needs a matching advertised preview and explicit provider outcome proof", async () => {
  let allow = false,
    proof = true,
    calls = 0;
  const f = fixture({
    open: (id) => ({
      descriptor: descriptor(id),
      readState: () => ({ observed: {} }),
      close: () => ({ recovery: "not_needed" }),
      recoveryPreview: () => ({
        previewToken: "keep-token",
        confirmedInstanceId: id,
        expiresInMs: 60000,
        canKeepCurrent: allow,
        restoreAvailable: false,
      }),
      recover: ({ resolution }) => {
        calls++;
        return proof
          ? {
              recovery: "completed",
              resolution,
              outcome: "accepted_verified_current",
            }
          : { recovery: "completed" };
      },
    }),
  });
  const ask = async (type, fields = {}) => {
    await f.send(type, fields);
    await tick();
    return f.messages.at(-1);
  };
  await ask("hello", { protocol: 1 });
  const session = { session: "s", generation: 1 };
  await ask("open", { ...session, instanceId: "a" });
  const keep = {
    ...session,
    previewToken: "keep-token",
    confirmedInstanceId: "a",
    resolution: "keepCurrent",
  };
  assert.equal((await ask("recover", keep)).error.code, "recovery_preview");
  await ask("recoveryPreview", session);
  assert.equal((await ask("recover", keep)).error.code, "recovery_preview");
  assert.equal(calls, 0);
  allow = true;
  await ask("recoveryPreview", session);
  assert.equal(
    (await ask("recover", { ...keep, resolution: "unknown" })).error.code,
    "malformed",
  );
  assert.equal(calls, 0);
  assert.equal(
    (await ask("recover", { ...keep, resolution: "restore" })).error.code,
    "recovery_snapshot_incomplete",
  );
  assert.equal(
    (await ask("recover", keep)).value.outcome,
    "accepted_verified_current",
  );
  assert.equal(calls, 1);
  await ask("recoveryPreview", session);
  proof = false;
  assert.equal((await ask("recover", keep)).error.code, "recovery_pending");
  await ask("close", session);
});
test("lighting presentation references real scalar capabilities and rejects visibility cycles", () => {
  const d = descriptor("lighting");
  const label = { en: "Setting", ru: "Настройка" };
  d.settings = [
    {
      id: "mode",
      label,
      type: "choice",
      choices: [
        { value: 1, label },
        { value: 2, label },
      ],
      persistence: "onboard",
      readback: true,
    },
    ...["r", "g", "b"].map((id) => ({
      id,
      label,
      type: "number",
      min: 0,
      max: 255,
      step: 1,
      persistence: "onboard",
      readback: true,
      presentation: "slider",
      visibleWhen: { settingId: "mode", values: [1] },
    })),
  ];
  d.lighting = [
    {
      id: "keys",
      label,
      kind: "keys",
      settings: ["r", "g", "b"],
      colorChannels: [
        {
          id: "main",
          r: "r",
          g: "g",
          b: "b",
          visibleWhen: { settingId: "mode", values: [1] },
        },
      ],
    },
  ];
  assert.equal(validateDescriptor(d), d);
  const bad = (mutate) => {
    const x = structuredClone(d);
    mutate(x);
    assert.throws(() => validateDescriptor(x));
  };
  bad((x) => (x.settings[1].visibleWhen.values = [3]));
  bad((x) => (x.settings[1].visibleWhen.settingId = "r"));
  bad((x) => (x.settings[0].presentation = "slider"));
  bad((x) => (x.lighting[0].colorChannels[0].b = "r"));
  bad((x) => (x.lighting[0].settings = ["r", "g"]));
  bad((x) => (x.settings[3].max = 256));
  bad(
    (x) =>
      x.settings.push({
        id: "other",
        label,
        type: "choice",
        choices: [{ value: 1, label }],
        persistence: "onboard",
        readback: true,
        visibleWhen: { settingId: "mode", values: [1] },
      }) &&
      Object.assign(x.settings[0], {
        visibleWhen: { settingId: "other", values: [1] },
      }),
  );
});
const travelDescriptor = (id) => {
  const d = descriptor(id);
  d.controls[0].telemetry = { keyTravel: true };
  d.observation = {
    keyTravel: {
      minUm: 0,
      maxUm: 4000,
      staleAfterMs: 600,
      normalTyping: true,
      evidence: "partial",
    },
  };
  return d;
};
test("travel observation is explicit, coalesced, isolated from action sequence, and stopped on close", async () => {
  const messages = [],
    contexts = new Map(),
    writes = [];
  const f = fixture({
    send: (m) => messages.push(m),
    open: (id, c) => {
      contexts.set(id, c);
      return {
        descriptor: travelDescriptor(id),
        readState: () => ({ observed: {} }),
        observe: ({ enabled }) => {
          writes.push([id, enabled]);
          return { observing: enabled };
        },
        close: () => ({ recovery: "not_needed" }),
      };
    },
  });
  await f.send("hello", { protocol: 1 });
  await f.send("open", { session: "s", generation: 1, instanceId: "a" });
  await f.send("open", { session: "b", generation: 1, instanceId: "b" });
  assert.deepEqual(writes, []);
  assert.equal(contexts.get("a").depth("key-1", { travelUm: 5 }), false);
  await f.send("observe", { session: "s", generation: 1, enabled: true });
  await tick();
  for (let n = 0; n < 100; n++)
    contexts.get("a").depth("key-1", { travelUm: n, maxTravelUm: 3970 });
  assert.equal(contexts.get("b").depth("key-1", { travelUm: 50 }), false);
  assert.throws(() => contexts.get("a").depth("missing", { travelUm: 1 }));
  assert.throws(() => contexts.get("a").depth("key-1", { travelUm: 10001 }));
  await new Promise((r) => setTimeout(r, 60));
  const depth = messages.filter((m) => m.type === "depth");
  assert.equal(depth.length, 1);
  assert.equal(depth[0].value.travelUm, 99);
  assert.equal(depth[0].sequence, 1);
  contexts.get("a").input("key-1", "down");
  assert.equal(messages.find((m) => m.type === "input").sequence, 1);
  await f.send("close", { session: "s", generation: 1 });
  await tick();
  assert.deepEqual(writes, [
    ["a", true],
    ["a", false],
  ]);
  assert.equal(contexts.get("a").depth("key-1", { travelUm: 2 }), false);
  assert.equal(f.p.sessions.has("b"), true);
  f.p.shutdown();
});
test("observation lease stops an abandoned editor and uncertain enable remains stoppable", async () => {
  const writes = [];
  let failStart = false;
  const f = fixture({
    open: (id) => ({
      descriptor: travelDescriptor(id),
      readState: () => ({ observed: {} }),
      observe: ({ enabled }) => {
        writes.push(enabled);
        if (enabled && failStart) throw Error("uncertain");
        return { observing: enabled };
      },
      close: () => ({ recovery: "not_needed" }),
    }),
  });
  await f.send("hello", { protocol: 1 });
  await f.send("open", { session: "s", generation: 1, instanceId: "a" });
  await f.send("observe", { session: "s", generation: 1, enabled: true });
  await tick();
  await new Promise((r) => setTimeout(r, 3100));
  await tick();
  assert.deepEqual(writes, [true, false]);
  failStart = true;
  await f.send("observe", { session: "s", generation: 1, enabled: true });
  await tick();
  await f.send("close", { session: "s", generation: 1 });
  await tick();
  assert.deepEqual(writes, [true, false, true, false]);
});
test("passive strip decoration keeps no input address and validates geometry", () => {
  const d = descriptor("a");
  d.decorations = [
    {
      id: "side",
      kind: "light-strip",
      label: { en: "Strip", ru: "Полоса" },
      x: 1,
      y: 0,
      width: 1,
      height: 1,
    },
  ];
  assert.equal(validateDescriptor(d).controls.length, 1);
  d.decorations[0].width = 2;
  assert.throws(() => validateDescriptor(d));
  const travel = travelDescriptor("a");
  travel.observation.keyTravel.maxUm = 10001;
  assert.throws(() => validateDescriptor(travel));
});
test("device manifests distinguish native/node entries and reject executable substitution or action-shaped fields", () => {
  const m = {
    kind: "device",
    protocol: 1,
    id: "dev.test.device",
    name: "Device",
    version: "0.1.0",
    runtime: "node",
    entry: "provider.mjs",
    models: ["dev.test.device.model"],
    platforms: ["windows"],
  };
  assert.equal(validateDeviceManifest(m), m);
  assert.equal(
    validateDeviceManifest({
      ...m,
      runtime: "native",
      entry: "bin/provider.exe",
    }).runtime,
    "native",
  );
  for (const extra of [
    { entry: "../outside.exe" },
    { entry: "C:/Windows/cmd.exe" },
    { entry: "bin\\tool.exe" },
    { entry: "/usr/bin/env" },
    { runtime: "shell" },
    { args: ["--execute"] },
    { Actions: [] },
    { protocol: 2 },
    { models: [] },
  ])
    assert.throws(() => validateDeviceManifest({ ...m, ...extra }));
});
function fixture(extra = {}) {
  const messages = [],
    contexts = new Map(),
    states = new Map();
  const p = new DeviceProvider({
    id: "dev.test.provider",
    discover: () => ["a", "b"].map(descriptor),
    open: (id, c) => {
      contexts.set(id, c);
      states.set(id, 0);
      return {
        descriptor: descriptor(id),
        readState: () => ({ observed: { count: states.get(id) } }),
        setSettings: ({ changes }) => {
          states.set(id, changes.count);
          return { observed: { count: states.get(id) } };
        },
        close: () => ({ recovery: "not_needed" }),
      };
    },
    send: (m) => messages.push(m),
    ...extra,
  });
  let n = 0;
  return {
    p,
    messages,
    contexts,
    states,
    send: (type, fields = {}) =>
      p.receive({ type, requestId: `r${++n}`, ...fields }),
  };
}
test("independent sessions, ordered declared edges and stale generation cannot affect reopened instance", async () => {
  const f = fixture();
  await f.send("hello", { protocol: 1 });
  await f.send("discover");
  assert.equal(f.messages.at(-1).value.devices.length, 2);
  for (const [session, instanceId] of [
    ["s1", "a"],
    ["s2", "b"],
  ])
    await f.send("open", { session, instanceId, generation: 1 });
  const stale = f.contexts.get("a").input;
  stale("key-1", "down");
  stale("key-1", "up");
  assert.deepEqual(
    f.messages.filter((m) => m.type === "input").map((m) => m.sequence),
    [1, 2],
  );
  await f.send("close", { session: "s1", generation: 1 });
  await tick();
  assert.equal(f.p.input("s2", 1, "key-1", "down"), true);
  await f.send("open", { session: "s1", instanceId: "a", generation: 2 });
  assert.equal(stale("key-1", "up"), false);
  await f.send("setSettings", {
    session: "s1",
    generation: 1,
    changes: { count: 5 },
  });
  assert.equal(f.messages.at(-1).error.code, "stale_generation");
  assert.equal(f.states.get("a"), 0);
});
test("handshake/version, undeclared input and malformed settings fail truthfully", async () => {
  const f = fixture();
  await f.send("discover");
  assert.equal(f.messages.at(-1).error.code, "handshake");
  await f.send("hello", { protocol: 2 });
  assert.equal(f.messages.at(-1).error.code, "version");
  await f.send("hello", { protocol: 1 });
  await f.send("open", { session: "s", instanceId: "a", generation: 1 });
  assert.throws(() => f.contexts.get("a").input("unknown", "down"));
  await f.send("setSettings", { session: "s", generation: 1, changes: [] });
  await tick();
  assert.equal(f.messages.at(-1).error.code, "malformed");
  assert.throws(() =>
    validateDescriptor({
      ...descriptor("a"),
      controls: [descriptor("a").controls[0], descriptor("a").controls[0]],
    }),
  );
  const bad = descriptor("a");
  bad.settings = [
    {
      id: "mode",
      label: { en: "Mode", ru: "Режим" },
      type: "choice",
      choices: [
        { value: 0, label: { en: "A", ru: "A" } },
        { value: 0, label: { en: "B", ru: "B" } },
      ],
      persistence: "volatile",
      readback: true,
    },
  ];
  assert.throws(() => validateDescriptor(bad));
});
test("queue overflow fails one session; close aborts and discards queued work; siblings continue", async () => {
  let release;
  const f = fixture({
    limits: { sessionQueue: 1 },
    open: (id, c) => ({
      descriptor: descriptor(id),
      readState: () => ({ observed: {} }),
      setSettings: () =>
        new Promise((r) => {
          release = r;
          c.signal.addEventListener("abort", () => r({ observed: {} }), {
            once: true,
          });
        }),
      close: () => ({ recovery: "not_needed" }),
    }),
  });
  await f.send("hello", { protocol: 1 });
  await f.send("open", { session: "s", instanceId: "a", generation: 1 });
  await f.send("open", { session: "other", instanceId: "b", generation: 1 });
  await f.send("setSettings", { session: "s", generation: 1, changes: {} });
  await f.send("readState", { session: "s", generation: 1 });
  await f.send("readState", { session: "s", generation: 1 });
  await tick();
  assert.ok(
    f.messages.some(
      (m) => m.type === "sessionError" && m.error.code === "overload",
    ),
  );
  await f.send("readState", { session: "other", generation: 1 });
  await tick();
  assert.equal(f.messages.at(-1).ok, true);
  await f.send("close", { session: "s", generation: 1 });
  await tick();
  assert.equal(f.p.sessions.has("s"), false);
  assert.equal(f.p.sessions.has("other"), true);
  release?.({});
});
test("framing handles partial lines, invalid JSON, oversize and bounded blocked output", async () => {
  const input = new PassThrough(),
    output = new PassThrough(),
    lines = [],
    errors = [];
  output.on("data", (b) => lines.push(b.toString()));
  const server = serveDevice(
    { id: "dev.test.framing", discover: () => [], open: () => {} },
    { input, output, onError: (e) => errors.push(e) },
  );
  input.write('{"type":"hello","requestId":"h",');
  input.write('"protocol":1}\nnot json\n');
  await tick();
  assert.match(lines.join(""), /"ok":true/);
  assert.match(lines.join(""), /"malformed"/);
  input.write(
    Buffer.concat([
      Buffer.from('{"type":"hello","requestId":"'),
      Buffer.from([0xff]),
      Buffer.from('","protocol":1}\n'),
    ]),
  );
  await tick();
  assert.equal(JSON.parse(lines.at(-1)).type, "protocolError");
  input.write("x".repeat(LIMITS.lineBytes + 1));
  assert.equal(errors.at(-1).code, "oversize");
  server.close();
  const blocked = new Writable({ highWaterMark: 1, write(_c, _e, _cb) {} }),
    i = new PassThrough(),
    e = [];
  const b = serveDevice(
    { id: "dev.test.blocked", discover: () => [], open: () => {} },
    { input: i, output: blocked, onError: (x) => e.push(x) },
  );
  for (let n = 0; n < 140; n++)
    i.write(
      JSON.stringify({ type: "hello", requestId: `h${n}`, protocol: 1 }) + "\n",
    );
  await tick();
  assert.equal(e.at(-1).code, "overload");
  b.close();
});
test("pending close retains recovery-only session and explicit successful recovery unlocks a later close", async () => {
  let pending = true;
  const out = [];
  const p = new DeviceProvider({
    id: "dev.test.recovery",
    discover: () => [descriptor("a"), descriptor("b")],
    open: (id) => ({
      descriptor: descriptor(id),
      readState: () => ({
        observed: {},
        recovery: { state: id === "a" && pending ? "pending" : "not_needed" },
      }),
      setSettings: () => ({ observed: {} }),
      close: () => ({
        recovery: id === "a" && pending ? "pending" : "not_needed",
      }),
      recoveryPreview: () => ({
        previewToken: "preview-1",
        confirmedInstanceId: id,
        requiresConfirmation: true,
      }),
      recover: ({ previewToken, confirmedInstanceId }) => {
        assert.equal(previewToken, "preview-1");
        assert.equal(confirmedInstanceId, id);
        pending = false;
        return { observed: {}, recovery: "completed" };
      },
    }),
    send: (m) => out.push(m),
  });
  let n = 0;
  const send = async (type, f = {}) => {
    await p.receive({ type, requestId: `r${++n}`, ...f });
    await tick();
    return out.at(-1);
  };
  await send("hello", { protocol: 1 });
  for (const id of ["a", "b"])
    await send("open", { session: id, generation: 1, instanceId: id });
  assert.equal(
    (await send("close", { session: "a", generation: 1 })).value.recovery,
    "pending",
  );
  assert.equal(p.input("a", 1, "key-1", "down"), false);
  assert.equal(p.input("b", 1, "key-1", "down"), true);
  assert.equal(
    (await send("setSettings", { session: "a", generation: 1, changes: {} }))
      .error.code,
    "session_failed",
  );
  assert.equal(
    (await send("readState", { session: "a", generation: 1 })).ok,
    true,
  );
  assert.equal(
    (await send("recoveryPreview", { session: "a", generation: 1 })).value
      .previewToken,
    "preview-1",
  );
  assert.equal(
    (
      await send("recover", {
        session: "a",
        generation: 1,
        previewToken: "preview-1",
      })
    ).error.code,
    "malformed",
  );
  assert.equal(
    (
      await send("recover", {
        session: "a",
        generation: 1,
        previewToken: "preview-1",
        confirmedInstanceId: "a",
      })
    ).ok,
    true,
  );
  assert.equal(
    (await send("close", { session: "a", generation: 1 })).value.recovery,
    "not_needed",
  );
  assert.equal(p.sessions.has("a"), false);
  assert.equal(p.sessions.has("b"), true);
});
test("cold recovery-only provider refuses ordinary settings/output/input without requiring any pending marker", async () => {
  const f = fixture({ recoveryOnly: true });
  await f.send("hello", { protocol: 1 });
  await f.send("open", { session: "s", generation: 1, instanceId: "a" });
  assert.equal(f.p.input("s", 1, "key-1", "down"), false);
  await f.send("setSettings", {
    session: "s",
    generation: 1,
    changes: { count: 1 },
  });
  assert.equal(f.messages.at(-1).error.code, "recovery_only");
  assert.equal(f.states.get("a"), 0);
  await f.send("display", {
    session: "s",
    generation: 1,
    target: "screen",
    mime: "image/jpeg",
    data: "AAAA",
  });
  assert.equal(f.messages.at(-1).error.code, "recovery_only");
  await f.send("readState", { session: "s", generation: 1 });
  await tick();
  assert.equal(f.messages.at(-1).ok, true);
  await f.send("recoveryPreview", { session: "s", generation: 1 });
  await tick();
  assert.equal(f.messages.at(-1).error.code, "unsupported");
});
