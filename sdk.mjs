// SPDX-License-Identifier: GPL-3.0-or-later
// DeckWeave action plugin SDK 0.1.0. No external dependencies.
export const SDK_VERSION = "0.1.0";
export const escapeXml = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export const svgDataUrl = (svg) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

export function parseArguments(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("-") || argv[i + 1] === undefined)
      throw new Error("Expected flag/value host arguments");
    args[argv[i]] = argv[i + 1];
  }
  const port = Number(args["-port"]);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid host port");
  if (!args["-pluginUUID"] || !args["-registerEvent"])
    throw new Error("Missing plugin registration arguments");
  let info = {};
  if (args["-info"]) info = JSON.parse(args["-info"]);
  return {
    port,
    uuid: args["-pluginUUID"],
    registerEvent: args["-registerEvent"],
    info,
  };
}

/** Call once per plugin process. No reconnect: the host owns process lifecycle. */
export function createPlugin(options = {}) {
  const args = options.arguments ?? parseArguments(options.argv);
  const Socket = options.WebSocket ?? globalThis.WebSocket;
  if (!Socket)
    throw new Error(
      "A Node.js runtime with built-in WebSocket is required (Node 22+)",
    );
  const socket = new Socket(`ws://127.0.0.1:${args.port}`);
  const contexts = new Map(),
    handlers = new Map(),
    disposers = new Set();
  let disposed = false;
  const report = (error, message) => {
    try {
      (options.onError ?? ((e) => console.error("[DeckWeave plugin]", e)))(
        error,
        message,
      );
    } catch (e) {
      console.error("[DeckWeave error handler]", e);
    }
  };
  const send = (event, context, payload) => {
    if (disposed || socket.readyState !== 1) return false;
    const message = { event };
    if (context !== undefined) message.context = context;
    if (payload !== undefined) message.payload = payload;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch (e) {
      report(e, message);
      return false;
    }
  };
  const call = (fn, ...values) => {
    try {
      Promise.resolve(fn(...values)).catch((e) => report(e, values[1]));
    } catch (e) {
      report(e, values[1]);
    }
  };
  const emit = (event, context, message) => {
    for (const fn of [...(handlers.get(event) ?? [])])
      call(fn, context, message);
  };
  const makeContext = (message) => {
    const cleanup = new Set(),
      abort = new AbortController();
    let active = true;
    const ctx = {
      id: message.context,
      action: message.action ?? "",
      device: message.device ?? "",
      controller: message.payload?.controller ?? "Keypad",
      settings: message.payload?.settings ?? {},
      canvas:
        message.payload?.canvas ??
        (message.payload?.controller === "Encoder" ? [200, 100] : [112, 112]),
      state: {},
      signal: abort.signal,
      get active() {
        return active;
      },
      send(event, payload) {
        return active && send(event, ctx.id, payload);
      },
      setTitle(title) {
        return ctx.send("setTitle", { title, target: 0 });
      },
      setImage(image) {
        return ctx.send("setImage", { image, target: 0 });
      },
      setState(state) {
        return ctx.send("setState", { state });
      },
      setFeedback(payload) {
        return ctx.send("setFeedback", payload);
      },
      setFeedbackLayout(layout) {
        return ctx.send("setFeedbackLayout", { layout });
      },
      setSettings(settings) {
        ctx.settings = settings;
        return ctx.send("setSettings", settings);
      },
      getSettings() {
        return ctx.send("getSettings");
      },
      showAlert() {
        return ctx.send("showAlert");
      },
      showOk() {
        return ctx.send("showOk");
      },
      sendToPropertyInspector(payload) {
        return ctx.send("sendToPropertyInspector", payload);
      },
      onDispose(fn) {
        if (!active) call(fn);
        else cleanup.add(fn);
        return () => cleanup.delete(fn);
      },
      interval(fn, milliseconds) {
        if (!Number.isFinite(milliseconds) || milliseconds < 10)
          throw new Error("Interval must be >= 10ms");
        if (!active) return () => {};
        const id = setInterval(() => {
          if (active) call(fn);
        }, milliseconds);
        const clear = () => {
          clearInterval(id);
          cleanup.delete(clear);
        };
        cleanup.add(clear);
        return clear;
      },
      timeout(fn, milliseconds) {
        if (!Number.isFinite(milliseconds) || milliseconds < 0)
          throw new Error("Timeout must be >= 0ms");
        if (!active) return () => {};
        const id = setTimeout(() => {
          cleanup.delete(clear);
          if (active) call(fn);
        }, milliseconds);
        const clear = () => {
          clearTimeout(id);
          cleanup.delete(clear);
        };
        cleanup.add(clear);
        return clear;
      },
      _dispose() {
        if (!active) return;
        active = false;
        abort.abort();
        for (const fn of cleanup) call(fn);
        cleanup.clear();
      },
    };
    return ctx;
  };
  const onMessage = ({ data }) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch (e) {
      report(e);
      return;
    }
    if (!message || typeof message.event !== "string") return;
    let ctx = contexts.get(message.context);
    if (message.event === "willAppear") {
      ctx?._dispose();
      ctx = makeContext(message);
      contexts.set(message.context, ctx);
    }
    if (ctx) {
      if (message.event === "didReceiveSettings")
        ctx.settings = message.payload?.settings ?? {};
      if (message.payload?.canvas) ctx.canvas = message.payload.canvas;
    }
    emit(message.event, ctx, message);
    if (message.event === "willDisappear") {
      ctx?._dispose();
      contexts.delete(message.context);
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const ctx of contexts.values()) ctx._dispose();
    contexts.clear();
    handlers.clear();
    for (const fn of disposers) call(fn);
    disposers.clear();
    socket.removeEventListener("message", onMessage);
    if (socket.readyState < 2) socket.close();
  };
  socket.addEventListener("open", () => {
    if (disposed) return;
    try {
      socket.send(
        JSON.stringify({ event: args.registerEvent, uuid: args.uuid }),
      );
    } catch (e) {
      report(e);
      dispose();
    }
  });
  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", (event) =>
    report(new Error("Host WebSocket error"), event),
  );
  socket.addEventListener("close", dispose);
  return {
    socket,
    contexts,
    info: args.info,
    send,
    dispose,
    on(event, fn) {
      if (disposed) return () => {};
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
      return () => handlers.get(event)?.delete(fn);
    },
    onDispose(fn) {
      if (disposed) call(fn);
      else disposers.add(fn);
      return () => disposers.delete(fn);
    },
    setGlobalSettings(settings) {
      return send("setGlobalSettings", args.uuid, settings);
    },
    getGlobalSettings() {
      return send("getGlobalSettings", args.uuid);
    },
  };
}
