// SPDX-License-Identifier: GPL-3.0-or-later
/** Provisional device protocol; action SDK remains independent. */
export const DEVICE_PROTOCOL = 1;
export const LIMITS = Object.freeze({
  lineBytes: 1048576,
  sessionQueue: 32,
  sessions: 32,
  outbound: 128,
});
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const token = (v) =>
  typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
export class DeviceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
export function validateDeviceManifest(m) {
  const fields = [
    "kind",
    "protocol",
    "id",
    "name",
    "version",
    "runtime",
    "entry",
    "models",
    "platforms",
  ];
  if (
    !object(m) ||
    Object.keys(m).some((k) => !fields.includes(k)) ||
    fields.some((k) => !Object.hasOwn(m, k))
  )
    throw new DeviceError("manifest", "Invalid device manifest fields");
  const id = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_-]*){2,}$/;
  if (
    m.kind !== "device" ||
    m.protocol !== 1 ||
    !id.test(m.id) ||
    typeof m.name !== "string" ||
    !m.name.trim() ||
    m.name.length > 120 ||
    !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(m.version) ||
    !["node", "native"].includes(m.runtime)
  )
    throw new DeviceError("manifest", "Invalid device metadata/runtime");
  if (
    typeof m.entry !== "string" ||
    /[\\:\x00-\x1f]/.test(m.entry) ||
    m.entry.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new DeviceError("manifest", "entry must be a bundled relative file");
  for (const [key, valid] of [
    ["models", (v) => typeof v === "string" && id.test(v)],
    ["platforms", (v) => ["windows", "macos", "linux"].includes(v)],
  ])
    if (
      !Array.isArray(m[key]) ||
      !m[key].length ||
      new Set(m[key]).size !== m[key].length ||
      m[key].some((v) => !valid(v))
    )
      throw new DeviceError("manifest", `Invalid ${key}`);
  return m;
}
export function validateDescriptor(d) {
  if (
    !object(d) ||
    !token(d.instanceId) ||
    !token(d.modelId) ||
    typeof d.name !== "string" ||
    !d.name.trim()
  )
    throw new DeviceError("descriptor", "Missing device identity");
  if (
    !object(d.identity) ||
    !["session", "verified"].includes(d.identity.confidence) ||
    (d.identity.confidence === "session" && d.identity.persistentId !== null) ||
    (d.identity.confidence === "verified" && !token(d.identity.persistentId))
  )
    throw new DeviceError("descriptor", "Unverified persistent identity");
  if (
    !object(d.geometry) ||
    ![d.geometry.width, d.geometry.height].every(
      (v) => Number.isFinite(v) && v > 0,
    )
  )
    throw new DeviceError("descriptor", "Invalid geometry");
  if (!Array.isArray(d.controls) || d.controls.length > 512)
    throw new DeviceError("descriptor", "Invalid controls");
  const ids = new Set();
  for (const c of d.controls) {
    if (
      !token(c.id) ||
      ids.has(c.id) ||
      !["key", "dial", "touch"].includes(c.kind) ||
      ![c.x, c.y, c.width, c.height].every(Number.isFinite) ||
      c.x < 0 ||
      c.y < 0 ||
      c.width <= 0 ||
      c.height <= 0 ||
      c.x + c.width > d.geometry.width ||
      c.y + c.height > d.geometry.height ||
      !Array.isArray(c.events) ||
      c.events.some(
        (v) =>
          ![
            "down",
            "up",
            "rotate",
            "touchStart",
            "touchMove",
            "touchEnd",
          ].includes(v),
      )
    )
      throw new DeviceError("descriptor", "Invalid or duplicate control");
    ids.add(c.id);
    if (
      c.telemetry !== undefined &&
      (!object(c.telemetry) ||
        c.kind !== "key" ||
        c.telemetry.keyTravel !== true)
    )
      throw new DeviceError(
        "descriptor",
        "Invalid key travel control capability",
      );
  }
  if (d.observation !== undefined) {
    const range = d.observation?.keyTravel;
    if (
      !object(range) ||
      !Number.isInteger(range.minUm) ||
      range.minUm !== 0 ||
      !Number.isInteger(range.maxUm) ||
      range.maxUm <= 0 ||
      range.maxUm > 10000 ||
      range.staleAfterMs !== 600 ||
      typeof range.normalTyping !== "boolean" ||
      !["partial", "verified"].includes(range.evidence)
    )
      throw new DeviceError(
        "descriptor",
        "Invalid key travel observation range",
      );
  }
  for (const k of ["displays", "settings", "lighting"])
    if (!Array.isArray(d[k]))
      throw new DeviceError("descriptor", `Missing ${k}`);
  if (d.decorations !== undefined) {
    if (
      !Array.isArray(d.decorations) ||
      d.decorations.length > 32 ||
      new Set(d.decorations.map((v) => v?.id)).size !== d.decorations.length
    )
      throw new DeviceError("descriptor", "Invalid passive decorations");
    for (const decoration of d.decorations)
      if (
        !object(decoration) ||
        !token(decoration.id) ||
        decoration.kind !== "light-strip" ||
        !object(decoration.label) ||
        ![decoration.label.en, decoration.label.ru].every(
          (s) => typeof s === "string" && s.trim() && s.length <= 120,
        ) ||
        ![
          decoration.x,
          decoration.y,
          decoration.width,
          decoration.height,
        ].every(Number.isFinite) ||
        decoration.x < 0 ||
        decoration.y < 0 ||
        decoration.width <= 0 ||
        decoration.height <= 0 ||
        decoration.x + decoration.width > d.geometry.width ||
        decoration.y + decoration.height > d.geometry.height
      )
        throw new DeviceError(
          "descriptor",
          "Invalid passive decoration geometry",
        );
  }
  const label = (v) =>
    object(v) &&
    [v.en, v.ru].every(
      (s) => typeof s === "string" && s.trim() && s.length <= 120,
    );
  for (const [collection, max] of [
    [d.displays, 64],
    [d.settings, 64],
    [d.lighting, 32],
  ]) {
    if (
      collection.length > max ||
      new Set(collection.map((v) => v?.id)).size !== collection.length ||
      collection.some((v) => !object(v) || !token(v.id))
    )
      throw new DeviceError("descriptor", "Invalid or duplicate capability ID");
  }
  for (const display of d.displays)
    if (
      ![display.width, display.height].every(
        (v) => Number.isInteger(v) && v > 0 && v <= 8192,
      ) ||
      !Array.isArray(display.mime) ||
      !display.mime.length ||
      display.mime.some((v) => typeof v !== "string" || v.length > 120)
    )
      throw new DeviceError("descriptor", "Invalid display target");
  for (const setting of d.settings) {
    if (
      !label(setting.label) ||
      !["volatile", "onboard"].includes(setting.persistence) ||
      typeof setting.readback !== "boolean" ||
      !["boolean", "number", "choice"].includes(setting.type)
    )
      throw new DeviceError("descriptor", "Invalid setting metadata");
    if (
      setting.type === "number" &&
      (!Number.isFinite(setting.min) ||
        !Number.isFinite(setting.max) ||
        setting.min > setting.max ||
        (setting.step !== undefined &&
          (!Number.isFinite(setting.step) || setting.step <= 0)))
    )
      throw new DeviceError("descriptor", "Invalid numeric range");
    if (
      setting.type === "choice" &&
      (!Array.isArray(setting.choices) ||
        !setting.choices.length ||
        setting.choices.length > 64 ||
        new Set(setting.choices.map((c) => JSON.stringify(c?.value))).size !==
          setting.choices.length ||
        setting.choices.some(
          (c) =>
            !object(c) ||
            !label(c.label) ||
            (!["string", "number", "boolean"].includes(typeof c.value) &&
              c.value !== null),
        ))
    )
      throw new DeviceError("descriptor", "Invalid choices");
    if (
      setting.presentation !== undefined &&
      (setting.presentation !== "slider" || setting.type !== "number")
    )
      throw new DeviceError("descriptor", "Invalid setting presentation");
  }
  const condition = (value, owner) => {
    if (value === undefined) return;
    const ref = d.settings.find((s) => s.id === value?.settingId);
    if (
      !object(value) ||
      Object.keys(value).some((k) => !["settingId", "values"].includes(k)) ||
      !ref ||
      ref.id === owner ||
      !["choice", "boolean"].includes(ref.type) ||
      !Array.isArray(value.values) ||
      value.values.length < 1 ||
      value.values.length > 32 ||
      new Set(value.values.map((v) => JSON.stringify(v))).size !==
        value.values.length ||
      value.values.some((v) =>
        ref.type === "boolean"
          ? typeof v !== "boolean"
          : !ref.choices.some((c) => Object.is(c.value, v)),
      )
    )
      throw new DeviceError("descriptor", "Invalid visibility condition");
  };
  for (const setting of d.settings) condition(setting.visibleWhen, setting.id);
  for (const setting of d.settings) {
    const seen = new Set();
    let current = setting;
    while (current?.visibleWhen) {
      if (seen.has(current.id))
        throw new DeviceError("descriptor", "Cyclic visibility condition");
      seen.add(current.id);
      current = d.settings.find((s) => s.id === current.visibleWhen.settingId);
    }
  }
  for (const group of d.lighting)
    if (
      !label(group.label) ||
      typeof group.kind !== "string" ||
      group.controls?.some((id) => !ids.has(id)) ||
      group.settings?.some((id) => !d.settings.some((s) => s.id === id))
    )
      throw new DeviceError("descriptor", "Invalid lighting group");
  for (const group of d.lighting) {
    condition(group.staticColors?.visibleWhen);
    if (group.colorChannels === undefined) continue;
    if (
      !Array.isArray(group.colorChannels) ||
      group.colorChannels.length > 16 ||
      new Set(group.colorChannels.map((c) => c?.id)).size !==
        group.colorChannels.length
    )
      throw new DeviceError("descriptor", "Invalid lighting color channels");
    for (const channel of group.colorChannels) {
      const refs = [channel?.r, channel?.g, channel?.b];
      if (
        !object(channel) ||
        !token(channel.id) ||
        (channel.label !== undefined && !label(channel.label)) ||
        new Set(refs).size !== 3 ||
        refs.some((id) => {
          const s = d.settings.find((s) => s.id === id);
          return (
            !group.settings?.includes(id) ||
            !s ||
            s.type !== "number" ||
            s.min !== 0 ||
            s.max !== 255 ||
            (s.step !== undefined && s.step !== 1)
          );
        })
      )
        throw new DeviceError("descriptor", "Invalid lighting RGB references");
      condition(channel.visibleWhen);
    }
  }
  if (d.keyLighting !== undefined) {
    const cap = d.keyLighting;
    if (
      !object(cap) ||
      Object.keys(cap).some(
        (k) =>
          ![
            "experimental",
            "maxKeys",
            "maxRateHz",
            "maxTtlMs",
            "baseline",
            "physical",
          ].includes(k),
      ) ||
      cap.experimental !== true ||
      !Number.isSafeInteger(cap.maxKeys) ||
      cap.maxKeys < 1 ||
      cap.maxKeys > 14 ||
      !Number.isSafeInteger(cap.maxRateHz) ||
      cap.maxRateHz < 1 ||
      cap.maxRateHz > 10 ||
      !Number.isSafeInteger(cap.maxTtlMs) ||
      cap.maxTtlMs < 100 ||
      cap.maxTtlMs > 3000 ||
      cap.physical !== "unverified" ||
      !object(cap.baseline) ||
      Object.keys(cap.baseline).some(
        (k) => !["lightingMode", "colorMode", "minBrightness"].includes(k),
      ) ||
      cap.baseline.lightingMode !== 1 ||
      cap.baseline.colorMode !== 0 ||
      cap.baseline.minBrightness !== 2
    )
      throw new DeviceError(
        "descriptor",
        "Invalid experimental key lighting capability",
      );
  }
  return d;
}
function validateKeyLighting(m, descriptor) {
  const cap = descriptor.keyLighting;
  if (!cap)
    throw new DeviceError(
      "unsupported",
      "Experimental key lighting is not declared",
    );
  const fields = [
    "type",
    "requestId",
    "session",
    "generation",
    "leaseId",
    ...(m.type === "keyLighting" ? ["sequence", "ttlMs", "colors"] : []),
  ];
  if (Object.keys(m).some((key) => !fields.includes(key)))
    throw new DeviceError("malformed", "Unexpected key lighting payload field");
  if (
    typeof m.leaseId !== "string" ||
    !m.leaseId.length ||
    m.leaseId.length > 128
  )
    throw new DeviceError("malformed", "Invalid key lighting lease ID");
  if (m.type === "releaseKeyLighting") return;
  if (
    !Number.isSafeInteger(m.sequence) ||
    m.sequence < 1 ||
    !Number.isSafeInteger(m.ttlMs) ||
    m.ttlMs < 100 ||
    m.ttlMs > cap.maxTtlMs ||
    !object(m.colors) ||
    Object.keys(m.colors).length < 1 ||
    Object.keys(m.colors).length > cap.maxKeys
  )
    throw new DeviceError(
      "malformed",
      "Invalid key lighting sequence, TTL, or slot count",
    );
  for (const [id, rgb] of Object.entries(m.colors)) {
    if (!descriptor.controls.some((c) => c.id === id && c.kind === "key"))
      throw new DeviceError(
        "malformed",
        "Key lighting requires declared physical keys",
      );
    if (
      !object(rgb) ||
      Object.keys(rgb).length !== 3 ||
      !["r", "g", "b"].every(
        (c) => Number.isInteger(rgb[c]) && rgb[c] >= 0 && rgb[c] <= 255,
      )
    )
      throw new DeviceError("malformed", "Invalid key lighting RGB color");
  }
}
export class DeviceProvider {
  constructor({ id, discover, open, send, limits = {}, recoveryOnly = false }) {
    if (
      !token(id) ||
      typeof discover !== "function" ||
      typeof open !== "function" ||
      typeof send !== "function"
    )
      throw new TypeError("Provider requires id/discover/open/send");
    this.id = id;
    this.discover = discover;
    this.openHandler = open;
    this.send = send;
    this.limits = { ...LIMITS, ...limits };
    for (const [key, value] of Object.entries(this.limits))
      if (
        !Object.hasOwn(LIMITS, key) ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > LIMITS[key]
      )
        throw new TypeError(
          "Limits must be positive integers within SDK bounds",
        );
    this.sessions = new Map();
    this.generations = new Map();
    this.ready = false;
    this.recoveryOnly = recoveryOnly;
  }
  reply(m, ok, value) {
    this.send({
      type: "result",
      requestId: m.requestId,
      ...(m.session ? { session: m.session, generation: m.generation } : {}),
      ok,
      ...(ok
        ? { value }
        : {
            error: {
              code: value.code ?? "provider",
              message: value.message ?? "Provider failed",
            },
          }),
    });
  }
  async receive(m) {
    try {
      if (!object(m) || !token(m.requestId) || typeof m.type !== "string")
        throw new DeviceError("malformed", "Invalid request envelope");
      if (m.type === "hello") {
        if (m.protocol !== 1)
          throw new DeviceError("version", "Unsupported device protocol");
        this.ready = true;
        this.reply(m, true, {
          protocol: 1,
          providerId: this.id,
          limits: this.limits,
        });
        return;
      }
      if (!this.ready) throw new DeviceError("handshake", "hello is required");
      if (m.type === "discover") {
        const devices = await this.discover();
        if (!Array.isArray(devices) || devices.length > 256)
          throw new DeviceError("descriptor", "Invalid discovery result");
        devices.forEach(validateDescriptor);
        if (new Set(devices.map((d) => d.instanceId)).size !== devices.length)
          throw new DeviceError(
            "descriptor",
            "Discovery contains duplicate instance handles",
          );
        this.reply(m, true, { devices });
        return;
      }
      if (
        !token(m.session) ||
        !Number.isSafeInteger(m.generation) ||
        m.generation < 1
      )
        throw new DeviceError("malformed", "Invalid session generation");
      if (m.type === "open") {
        if (this.sessions.has(m.session))
          throw new DeviceError("busy", "Session already open");
        if (m.generation <= (this.generations.get(m.session) ?? 0))
          throw new DeviceError(
            "stale_generation",
            "Generation already retired",
          );
        if (this.sessions.size >= this.limits.sessions)
          throw new DeviceError("overload", "Session limit reached");
        if (
          !token(m.instanceId) ||
          [...this.sessions.values()].some((s) => s.instanceId === m.instanceId)
        )
          throw new DeviceError("busy", "Instance already owned or invalid");
        const s = {
          instanceId: m.instanceId,
          generation: m.generation,
          queue: [],
          running: false,
          controller: new AbortController(),
          sequence: 0,
          depthSequence: 0,
          depthSamples: new Map(),
          observing: false,
          failed: false,
          closing: false,
          adapter: null,
        };
        this.sessions.set(m.session, s);
        this.generations.set(m.session, m.generation);
        try {
          s.adapter = await this.openHandler(m.instanceId, {
            signal: s.controller.signal,
            input: (control, event, value) =>
              this.input(m.session, m.generation, control, event, value),
            depth: (control, value) =>
              this.depth(m.session, m.generation, control, value),
          });
          s.descriptor = validateDescriptor(s.adapter.descriptor);
          if (s.descriptor.instanceId !== m.instanceId)
            throw new DeviceError("descriptor", "Opened instance mismatch");
          if (s.controller.signal.aborted)
            throw new DeviceError("cancelled", "Open cancelled");
          const state = await s.adapter.readState({
            signal: s.controller.signal,
          });
          if (s.controller.signal.aborted)
            throw new DeviceError("cancelled", "Open cancelled");
          this.reply(m, true, { descriptor: s.descriptor, state });
          if (state?.recovery?.state === "pending") {
            s.failed = true;
            s.recoveryOnly = true;
          }
          this.drain(m.session, s);
        } catch (e) {
          this.sessions.delete(m.session);
          for (const q of s.queue.splice(0))
            this.reply(q, false, new DeviceError("cancelled", "Open failed"));
          try {
            await s.adapter?.close?.();
          } catch {}
          this.reply(m, false, e);
        }
        return;
      }
      if (
        this.recoveryOnly &&
        ["setSettings", "display", "keyLighting"].includes(m.type)
      )
        throw new DeviceError(
          "recovery_only",
          "Provider is running only for explicit recovery",
        );
      const s = this.sessions.get(m.session);
      if (!s || s.generation !== m.generation)
        throw new DeviceError(
          "stale_generation",
          "Session generation is not active",
        );
      if (s.closing)
        throw new DeviceError("closing", "Session close is pending");
      if (m.type === "observe" && typeof m.enabled !== "boolean")
        throw new DeviceError("malformed", "observe.enabled must be boolean");
      if (
        m.type === "observe" &&
        m.enabled &&
        (this.recoveryOnly || s.recoveryOnly)
      )
        throw new DeviceError(
          "recovery_only",
          "Observation is unavailable during recovery",
        );
      if (["close", "cancel"].includes(m.type)) {
        if (m.type === "close") s.closing = true;
        s.controller.abort();
        for (const q of s.queue.splice(0))
          this.reply(
            q,
            false,
            new DeviceError("cancelled", "Session work cancelled"),
          );
        // A cooperative running operation finishes before priority teardown.
        s.queue.unshift(m);
        this.drain(m.session, s);
        return;
      }
      if (
        s.failed &&
        !(
          s.recoveryOnly &&
          ["readState", "recoveryPreview", "recover"].includes(m.type)
        ) &&
        !(m.type === "observe" && m.enabled === false) &&
        m.type !== "releaseKeyLighting"
      )
        throw new DeviceError(
          "session_failed",
          "Close and reopen the failed session",
        );
      if (
        ![
          "readState",
          "setSettings",
          "display",
          "recoveryPreview",
          "recover",
          "observe",
          "keyLighting",
          "releaseKeyLighting",
        ].includes(m.type)
      )
        throw new DeviceError("unsupported", "Unsupported request");
      if (s.queue.length >= this.limits.sessionQueue) {
        s.failed = true;
        s.controller.abort();
        for (const q of s.queue.splice(0))
          this.reply(
            q,
            false,
            new DeviceError("overload", "Session queue overflow"),
          );
        this.send({
          type: "sessionError",
          session: m.session,
          generation: m.generation,
          error: { code: "overload", message: "Session queue overflow" },
        });
        throw new DeviceError("overload", "Session queue overflow");
      }
      s.queue.push(m);
      this.drain(m.session, s);
    } catch (e) {
      if (object(m) && token(m.requestId)) this.reply(m, false, e);
      else
        this.send({
          type: "protocolError",
          error: { code: e.code ?? "malformed", message: e.message },
        });
    }
  }
  async drain(session, s) {
    if (s.running || !s.adapter) return;
    s.running = true;
    try {
      while (s.queue.length) {
        const m = s.queue.shift();
        try {
          let value;
          if (m.type === "close") {
            await this.stopObservation(s);
            value = (await s.adapter.close?.()) ?? { recovery: "not_needed" };
            if (
              !["not_needed", "completed", "pending"].includes(value?.recovery)
            )
              throw new DeviceError(
                "recovery_pending",
                "Close did not confirm recovery state",
              );
            if (value?.recovery === "pending") {
              s.recoveryOnly = true;
              s.failed = true;
              s.closing = false;
              s.controller = new AbortController();
            } else this.sessions.delete(session);
          } else if (m.type === "cancel") {
            await this.stopObservation(s);
            value = (await s.adapter.cancel?.()) ?? { cancelled: true };
            s.controller = new AbortController();
          } else {
            if (
              s.failed &&
              !(
                s.recoveryOnly &&
                ["readState", "recoveryPreview", "recover"].includes(m.type)
              ) &&
              !(m.type === "observe" && m.enabled === false) &&
              m.type !== "releaseKeyLighting"
            )
              throw new DeviceError(
                "session_failed",
                "Resolve recovery or reopen before ordinary work",
              );
            if (
              s.controller.signal.aborted &&
              !(m.type === "observe" && m.enabled === false) &&
              m.type !== "releaseKeyLighting"
            )
              throw new DeviceError("cancelled", "Session work cancelled");
            if (m.type === "setSettings" && !object(m.changes))
              throw new DeviceError("malformed", "changes must be an object");
            if (["keyLighting", "releaseKeyLighting"].includes(m.type))
              validateKeyLighting(m, s.descriptor);
            if (
              m.type === "keyLighting" &&
              (this.recoveryOnly || s.recoveryOnly)
            )
              throw new DeviceError(
                "recovery_only",
                "Key lighting is unavailable during recovery",
              );
            if (
              m.type === "observe" &&
              m.enabled &&
              !s.descriptor.observation?.keyTravel
            )
              throw new DeviceError(
                "unsupported",
                "Key travel observation is not declared",
              );
            if (
              m.type === "recoveryPreview" &&
              m.snapshotId !== undefined &&
              !token(m.snapshotId)
            )
              throw new DeviceError("malformed", "Invalid snapshot identifier");
            if (
              m.type === "recover" &&
              (!token(m.previewToken) ||
                !token(m.confirmedInstanceId) ||
                (m.resolution !== undefined &&
                  !["restore", "keepCurrent"].includes(m.resolution)))
            )
              throw new DeviceError(
                "malformed",
                "Recovery needs a preview token and explicit instance confirmation",
              );
            if (
              m.type === "recover" &&
              m.resolution === "keepCurrent" &&
              (!s.recoveryPreview?.canKeepCurrent ||
                s.recoveryPreview.previewToken !== m.previewToken ||
                s.recoveryPreview.instance !== m.confirmedInstanceId ||
                Date.now() > s.recoveryPreview.expires)
            )
              throw new DeviceError(
                "recovery_preview",
                "Keeping current settings requires a fresh explicit supported preview",
              );
            if (
              m.type === "recover" &&
              m.resolution !== "keepCurrent" &&
              s.recoveryPreview?.previewToken === m.previewToken &&
              s.recoveryPreview.restoreAvailable === false
            )
              throw new DeviceError(
                "recovery_snapshot_incomplete",
                "Original settings cannot be restored from this snapshot",
              );
            if (
              m.type === "display" &&
              (!token(m.target) ||
                typeof m.mime !== "string" ||
                typeof m.data !== "string" ||
                !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
                  m.data,
                ))
            )
              throw new DeviceError("malformed", "Invalid display payload");
            const fn = s.adapter[m.type];
            if (typeof fn !== "function")
              throw new DeviceError("unsupported", `${m.type} unsupported`);
            if (m.type === "observe" && m.enabled)
              s.observationNeedsStop = true;
            value = await fn.call(s.adapter, {
              ...m,
              signal:
                (m.type === "observe" && !m.enabled) ||
                m.type === "releaseKeyLighting"
                  ? new AbortController().signal
                  : s.controller.signal,
            });
            if (
              m.type === "keyLighting" &&
              (value?.accepted !== true ||
                value?.leaseId !== m.leaseId ||
                value?.sequence !== m.sequence ||
                value?.experimental !== true)
            )
              throw new DeviceError(
                "write_uncertain",
                "Adapter did not acknowledge this queued lighting frame",
              );
            if (
              m.type === "releaseKeyLighting" &&
              (value?.released !== true || value?.recovery !== "not_needed")
            )
              throw new DeviceError(
                "recovery_pending",
                "Adapter did not acknowledge RAM restoration",
              );
            if (m.type === "recoveryPreview") {
              s.recoveryPreview =
                token(value?.previewToken) &&
                token(value?.confirmedInstanceId) &&
                Number.isFinite(value?.expiresInMs) &&
                value.expiresInMs > 0 &&
                value.expiresInMs <= 60000
                  ? {
                      previewToken: value.previewToken,
                      instance: value.confirmedInstanceId,
                      canKeepCurrent: value.canKeepCurrent === true,
                      restoreAvailable: value.restoreAvailable,
                      expires: Date.now() + value.expiresInMs,
                    }
                  : null;
            }
            if (m.type === "recover") {
              s.recoveryPreview = null;
              if (
                m.resolution === "keepCurrent" &&
                (value?.recovery !== "completed" ||
                  value?.resolution !== "keepCurrent" ||
                  value?.outcome !== "accepted_verified_current")
              )
                throw new DeviceError(
                  "recovery_pending",
                  "Adapter did not confirm explicit acceptance of verified current settings",
                );
            }
            if (m.type === "observe") {
              if (value?.observing !== m.enabled)
                throw new DeviceError(
                  "observation",
                  "Adapter did not confirm observation state",
                );
              if (!m.enabled) {
                this.clearObservation(s);
                s.observationNeedsStop = false;
              } else {
                s.observing = true;
                clearTimeout(s.depthLease);
                s.depthLease = setTimeout(() => {
                  this.clearObservation(s);
                  void this.receive({
                    type: "observe",
                    requestId: `lease-${session}`,
                    session,
                    generation: s.generation,
                    enabled: false,
                  });
                }, 3000);
                s.depthLease.unref?.();
              }
            }
            if (
              s.controller.signal.aborted &&
              !(m.type === "observe" && m.enabled === false) &&
              m.type !== "releaseKeyLighting"
            )
              throw new DeviceError("cancelled", "Session work cancelled");
            const recovery = value?.recoveryState ?? value?.recovery;
            if (recovery?.state === "pending") {
              s.failed = true;
              s.recoveryOnly = true;
              await this.stopObservation(s);
            } else if (
              m.type === "recover" &&
              value?.recovery === "completed"
            ) {
              s.failed = false;
              s.recoveryOnly = false;
            }
          }
          this.reply(m, true, value);
        } catch (e) {
          if (m.type === "close") s.closing = false;
          if (
            [
              "write_uncertain",
              "readback_mismatch",
              "recovery_pending",
              "recovery_required",
            ].includes(e.code)
          ) {
            s.failed = true;
            s.recoveryOnly = true;
            await this.stopObservation(s).catch(() => {});
          }
          this.reply(m, false, e);
        }
      }
    } finally {
      s.running = false;
    }
  }
  input(session, generation, control, event, value) {
    const s = this.sessions.get(session);
    if (
      this.recoveryOnly ||
      !s ||
      s.generation !== generation ||
      s.failed ||
      s.controller.signal.aborted ||
      !s.descriptor
    )
      return false;
    const c = s.descriptor.controls.find((c) => c.id === control);
    if (!c || !c.events.includes(event))
      throw new DeviceError("input", "Input is not declared by descriptor");
    this.send({
      type: "input",
      session,
      generation,
      sequence: ++s.sequence,
      control,
      event,
      ...(value !== undefined ? { value } : {}),
    });
    return true;
  }
  clearObservation(s) {
    s.observing = false;
    clearTimeout(s.depthLease);
    clearTimeout(s.depthFlush);
    s.depthFlush = undefined;
    s.depthSamples.clear();
  }
  async stopObservation(s) {
    const active = s.observationNeedsStop;
    this.clearObservation(s);
    if (active && typeof s.adapter?.observe === "function") {
      const reply = await s.adapter.observe({
        enabled: false,
        signal: new AbortController().signal,
      });
      if (reply?.observing !== false)
        throw new DeviceError("observation", "Observation stop is unconfirmed");
      s.observationNeedsStop = false;
    }
  }
  depth(session, generation, control, value) {
    const s = this.sessions.get(session);
    if (
      !s ||
      s.generation !== generation ||
      !s.observing ||
      s.failed ||
      s.closing ||
      this.recoveryOnly
    )
      return false;
    const c = s.descriptor.controls.find((c) => c.id === control);
    if (
      c?.telemetry?.keyTravel !== true ||
      !Number.isInteger(value?.travelUm) ||
      value.travelUm < 0 ||
      value.travelUm > 10000 ||
      (value.maxTravelUm !== undefined &&
        (!Number.isInteger(value.maxTravelUm) ||
          value.maxTravelUm < 0 ||
          value.maxTravelUm > 10000))
    )
      throw new DeviceError(
        "observation",
        "Undeclared or invalid key travel sample",
      );
    s.depthSamples.set(control, {
      value: {
        travelUm: value.travelUm,
        ...(value.maxTravelUm === undefined
          ? {}
          : { maxTravelUm: value.maxTravelUm }),
      },
      received: performance.now(),
    });
    if (!s.depthFlush) {
      s.depthFlush = setTimeout(() => {
        s.depthFlush = undefined;
        if (s.observing && !s.failed && !s.closing)
          for (const [control, sample] of s.depthSamples)
            if (performance.now() - sample.received < 600)
              this.send({
                type: "depth",
                session,
                generation,
                sequence: ++s.depthSequence,
                control,
                value: sample.value,
              });
        s.depthSamples.clear();
      }, 34);
      s.depthFlush.unref?.();
    }
    return true;
  }
  shutdown() {
    for (const [session, s] of this.sessions) {
      s.controller.abort();
      // Keep teardown behind the running adapter call, exactly like explicit cancel.
      if (!s.closing)
        void this.receive({
          type: "cancel",
          requestId: `shutdown-${session}`,
          session,
          generation: s.generation,
        });
    }
  }
}
/** Bounded framing. Returns cleanup; never buffers an unbounded partial line. */
export function serveDevice(
  options,
  {
    input = process.stdin,
    output = process.stdout,
    onError = (e) => console.error(e.message),
  } = {},
) {
  let bytes = Buffer.alloc(0),
    blocked = false,
    ended = false;
  const outgoing = [];
  const fail = (error) => {
    if (ended) return;
    ended = true;
    bytes = Buffer.alloc(0);
    outgoing.length = 0;
    input.pause();
    provider.shutdown();
    onError(error);
  };
  const send = (message) => {
    if (ended) return;
    const line = JSON.stringify(message) + "\n";
    if (Buffer.byteLength(line) > LIMITS.lineBytes)
      return fail(new DeviceError("oversize", "Outbound line too large"));
    if (blocked) {
      if (outgoing.length >= LIMITS.outbound)
        return fail(new DeviceError("overload", "Outbound queue overflow"));
      outgoing.push(line);
    } else blocked = !output.write(line);
  };
  const provider = new DeviceProvider({
    ...options,
    recoveryOnly:
      options.recoveryOnly ||
      process.env.DECKWEAVE_PROVIDER_RECOVERY_ONLY === "1",
    send,
  });
  const data = (chunk) => {
    if (ended) return;
    bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
    let n;
    while ((n = bytes.indexOf(10)) >= 0) {
      if (n > LIMITS.lineBytes)
        return fail(new DeviceError("oversize", "Input line too large"));
      const line = bytes.subarray(0, n);
      bytes = bytes.subarray(n + 1);
      try {
        void provider.receive(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)),
        );
      } catch {
        send({
          type: "protocolError",
          error: { code: "malformed", message: "Invalid JSON" },
        });
      }
    }
    if (bytes.length > LIMITS.lineBytes)
      fail(new DeviceError("oversize", "Input line too large"));
  };
  const drain = () => {
    blocked = false;
    while (outgoing.length && !blocked)
      blocked = !output.write(outgoing.shift());
  };
  const end = () => {
    provider.shutdown();
    if (bytes.length)
      onError(new DeviceError("truncated", "Unterminated input"));
  };
  input.on("data", data);
  input.on("end", end);
  output.on("drain", drain);
  output.on("error", fail);
  return {
    provider,
    close() {
      ended = true;
      input.off("data", data);
      input.off("end", end);
      output.off("drain", drain);
      output.off("error", fail);
      provider.shutdown();
    },
  };
}
