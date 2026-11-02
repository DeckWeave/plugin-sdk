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
