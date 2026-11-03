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
    services = new Map(),
    pending = new Map(),
    disposers = new Set();
  let disposed = false,
    requestSerial = 0;
  const capabilities = args.info?.deckweave?.services ?? {};
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
  const serviceRequest = (context, operation, payload) =>
    new Promise((resolve, reject) => {
      const capability =
        operation.startsWith("focus_")
          ? "focus"
          : operation === "sound"
          ? "sound"
          : operation === "timer"
            ? "timers"
            : "panels";
      if (!capabilities[capability]) {
        reject(
          Object.assign(new Error("Host does not support " + capability), {
            code: "unsupported",
          }),
        );
        return;
      }
      if (disposed || socket.readyState !== 1) {
        reject(
          Object.assign(new Error("Host is disconnected"), {
            code: "disconnected",
          }),
        );
        return;
      }
      if (pending.size >= 32) {
        reject(
          Object.assign(new Error("Too many service requests"), {
            code: "busy",
          }),
        );
        return;
      }
      const requestId = "service-" + ++requestSerial;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(
          Object.assign(new Error("Host service timed out"), {
            code: "timeout",
          }),
        );
      }, 8000);
      pending.set(requestId, { resolve, reject, timer });
      try {
        socket.send(
          JSON.stringify({
            event: "deckweaveService",
            requestId,
            context,
            operation,
            payload,
          }),
        );
      } catch (error) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(error);
      }
    });
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
      panel: message.payload?.panel,
      capabilities,
      service(operation, payload) {
        return active
          ? serviceRequest(ctx.id, operation, payload)
          : Promise.reject(
              Object.assign(new Error("Context is disposed"), {
                code: "disposed",
              }),
            );
      },
      playSound(options) {
        return ctx.service("sound", options);
      },
      panels: {
        get(key = "main") {
          return ctx.service("get", { key });
        },
        open(key, spec) {
          return ctx.service("open", { key, spec });
        },
        update(id, value, revision = ctx.panel?.revision) {
          return ctx.service("update", { id, value, revision });
        },
        configure(id, revision, spec) {
          return ctx.service("configure", { id, revision, spec });
        },
        close(id, revision) {
          return ctx.service("close", { id, revision });
        },
        timer(id, command, options = {}) {
          return ctx.service("timer", { id, command, ...options });
        },
      },
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
      showAlert(message) {
        return ctx.send("showAlert", typeof message === "string" ? { message: message.slice(0, 512) } : undefined);
      },
      showOk() {
        return ctx.send("showOk");
      },
      /** Request the current action's host-configured notification; never choose a target here. */
      notifyKeyLighting() {
        return ctx.send("deckweaveKeyLighting");
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
    if (message.event === "deckweaveServiceResult") {
      const request = pending.get(message.requestId);
      if (request) {
        pending.delete(message.requestId);
        clearTimeout(request.timer);
        if (message.ok) request.resolve(message.value);
        else
          request.reject(
            Object.assign(
              new Error(message.error?.message ?? "Service failed"),
              { code: message.error?.code ?? "service" },
            ),
          );
      }
      return;
    }
    if (message.event === "deckweaveServiceDidAppear") {
      services.get(message.context)?._dispose();
      const ctx = makeContext(message);
      services.set(message.context, ctx);
      emit(message.event, ctx, message);
      return;
    }
    if (message.event === "deckweaveServiceDidChange") {
      const ctx = services.get(message.context);
      if (ctx) {
        ctx.panel = message.payload?.panel;
        emit(message.event, ctx, message);
      }
      return;
    }
    if (message.event === "deckweaveServiceDidDisappear") {
      const ctx = services.get(message.context);
      emit(message.event, ctx, message);
      ctx?._dispose();
      services.delete(message.context);
      return;
    }
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
    for (const ctx of services.values()) ctx._dispose();
    services.clear();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(
        Object.assign(new Error("Host disconnected"), { code: "disconnected" }),
      );
    }
    pending.clear();
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
      if (capabilities.panels || capabilities.sound || capabilities.focus)
        socket.send(
          JSON.stringify({
            event: "deckweaveServiceRegister",
            payload: { version: 1 },
          }),
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
    services,
    capabilities,
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
