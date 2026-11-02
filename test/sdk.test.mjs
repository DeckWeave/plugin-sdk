import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPlugin,
  parseArguments,
  escapeXml,
  svgDataUrl,
} from "../sdk.mjs";
class Socket extends EventTarget {
  static last;
  readyState = 0;
  sent = [];
  constructor(url) {
    super();
    this.url = url;
    Socket.last = this;
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  message(value) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: typeof value === "string" ? value : JSON.stringify(value),
      }),
    );
  }
  send(value) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}
const args = {
  port: 1234,
  uuid: "dev.test",
  registerEvent: "registerPlugin",
  info: {},
};
function setup(onError = () => {}) {
  const p = createPlugin({ arguments: args, WebSocket: Socket, onError });
  Socket.last.open();
  return [p, Socket.last];
}
test("key lighting helper sends only its own context event and stops when invisible", () => {
  const [p, s] = setup();
  s.message({ event: "willAppear", context: "a" });
  const ctx = p.contexts.get("a");
  assert.equal(
    ctx.notifyKeyLighting({ device: "arbitrary", colors: {} }),
    true,
  );
  assert.deepEqual(s.sent.at(-1), {
    event: "deckweaveKeyLighting",
    context: "a",
  });
  s.message({ event: "willDisappear", context: "a" });
  assert.equal(ctx.notifyKeyLighting(), false);
  p.dispose();
});
test("registration, isolated contexts, settings replacement and outbound feedback", () => {
  const [p, s] = setup();
  assert.deepEqual(s.sent[0], { event: "registerPlugin", uuid: "dev.test" });
  p.on("willAppear", (c) => {
    c.state.n = 0;
    c.setTitle("Ready");
  });
  s.message({
    event: "willAppear",
    context: "a",
    action: "dev.test.counter",
    payload: { settings: { prefix: "A" }, canvas: [800, 128] },
  });
  s.message({
    event: "willAppear",
    context: "b",
    payload: { settings: { prefix: "B" } },
  });
  const a = p.contexts.get("a"),
    b = p.contexts.get("b");
  a.state.n++;
  assert.equal(b.state.n, 0);
  assert.deepEqual(a.canvas, [800, 128]);
  s.message({
    event: "didReceiveSettings",
    context: "a",
    payload: { settings: { prefix: "new" } },
  });
  assert.deepEqual(a.settings, { prefix: "new" });
  a.setSettings({ prefix: "saved" });
  assert.deepEqual(s.sent.at(-1), {
    event: "setSettings",
    context: "a",
    payload: { prefix: "saved" },
  });
  p.dispose();
});
test("invisible contexts abort work, clear timers and reject stale output", async () => {
  const [p, s] = setup();
  s.message({ event: "willAppear", context: "a" });
  const a = p.contexts.get("a");
  let ticks = 0,
    cleanup = 0;
  a.interval(() => ticks++, 10);
  a.timeout(() => ticks++, 10);
  a.onDispose(() => cleanup++);
  s.message({ event: "willDisappear", context: "a" });
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(ticks, 0);
  assert.equal(cleanup, 1);
  assert.equal(a.signal.aborted, true);
  assert.equal(a.setTitle("late"), false);
  assert.equal(p.contexts.size, 0);
  p.dispose();
  assert.equal(cleanup, 1);
});
test("all encoder and panel events preserve host payloads", () => {
  const [p, s] = setup();
  s.message({ event: "willAppear", context: "a" });
  for (const event of [
    "dialDown",
    "dialRotate",
    "dialUp",
    "touchTap",
    "panelDown",
    "panelMove",
    "panelUp",
    "panelCancel",
    "panelSwipe",
  ]) {
    let got;
    p.on(event, (c, m) => {
      got = [c.id, m.payload];
    });
    const payload = {
      ticks: -2,
      position: { x: 0.5, y: null },
      control: "dial-3",
    };
    s.message({ event, context: "a", payload });
    assert.deepEqual(got, ["a", payload]);
  }
  p.dispose();
});
test("bad messages and async handlers report errors without taking down other handlers", async () => {
  const errors = [];
  const [p, s] = setup((e) => errors.push(e));
  let called = 0;
  p.on("keyUp", async () => {
    throw new Error("bad");
  });
  p.on("keyUp", () => called++);
  s.message("not json");
  s.message({ event: "keyUp", context: "missing" });
  await Promise.resolve();
  assert.equal(called, 1);
  assert.equal(errors.length, 2);
  p.dispose();
});
test("repeated appearance disposes old state and socket close disposes every context", () => {
  const [p, s] = setup();
  s.message({ event: "willAppear", context: "a" });
  const first = p.contexts.get("a");
  s.message({ event: "willAppear", context: "a" });
  assert.equal(first.active, false);
  const second = p.contexts.get("a");
  s.close();
  assert.equal(second.active, false);
  assert.equal(p.contexts.size, 0);
});
test("argument validation and escaping", () => {
  assert.equal(
    parseArguments([
      "-port",
      "3000",
      "-pluginUUID",
      "dev.test",
      "-registerEvent",
      "registerPlugin",
    ]).port,
    3000,
  );
  assert.throws(() => parseArguments(["-port", "0"]));
  assert.throws(() => parseArguments(["-port"]));
  assert.equal(escapeXml("<a&\"'>"), "&lt;a&amp;&quot;&apos;&gt;");
  assert.equal(
    Buffer.from(svgDataUrl("<svg/>").split(",")[1], "base64").toString(),
    "<svg/>",
  );
});
test("disposing a connecting client cannot register later", () => {
  const p = createPlugin({ arguments: args, WebSocket: Socket });
  const s = Socket.last;
  p.dispose();
  s.open();
  assert.equal(s.sent.length, 0);
});
test("Encoder defaults to Elgato logical canvas and retains controller", () => {
  const [p, s] = setup();
  s.message({
    event: "willAppear",
    context: "a",
    payload: { controller: "Encoder" },
  });
  assert.deepEqual(p.contexts.get("a").canvas, [200, 100]);
  assert.equal(p.contexts.get("a").controller, "Encoder");
  p.dispose();
});
