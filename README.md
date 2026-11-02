# DeckWeave extension SDK

Two independent contracts share this repository: the existing **action** SDK
below, and the provisional **device provider** SDK in `device.mjs`
([device protocol](DEVICE-PROTOCOL.md)). Use `@deckweave/plugin-sdk/device` or
vendor `device.mjs`/`device.d.mts` with its licence. A device provider owns hardware
sessions and capabilities; it is not an Elgato action/Property Inspector.
`plugin-template/bin/create.mjs --device` generates a self-contained two-instance
mock provider and packager. No hardware, WebView, or third-party dependencies
are needed. The device contract is not frozen or publicly released.

Dependency-free Node.js 22+ ESM runtime for the current DeckWeave WebSocket action host. Version **0.1.0**, GPL-3.0-or-later. This package is source-distributed, not published on npm. Vendor `sdk.mjs`, `sdk.d.mts` (for relative ESM imports), `sdk.d.ts` (package exports), and `LICENSE` into a plugin's `lib/`; record the version. No Node dependencies or browser process are needed for a backend. The optional HTML Property Inspector runs only while its settings window is open.

```js
import { createPlugin, svgDataUrl, escapeXml } from './lib/sdk.mjs';
const plugin = createPlugin();
function draw(ctx) {
  const [w, h] = ctx.canvas;
  const image=svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#172233"/><text x="50%" y="60%" text-anchor="middle" fill="white" font-size="${Math.min(w,h)*.4}">${escapeXml(ctx.state.count)}</text></svg>`);
  if(ctx.controller==='Encoder') {
    if(!ctx.state.layout){ctx.setFeedbackLayout('$A0');ctx.state.layout=true;}
    ctx.setFeedback({'full-canvas':image});
  } else ctx.setImage(image);
}
plugin.on('willAppear', ctx => { ctx.state.count = 0; draw(ctx); });
plugin.on('keyUp', ctx => { ctx.state.count++; draw(ctx); });
plugin.on('dialRotate', (ctx, msg) => { ctx.state.count += msg.payload.ticks; draw(ctx); });
```

Start with `../plugin-template/bin/create.mjs` for a complete bilingual example, tests, validation and portable ZIP packaging. Host arguments are parsed automatically. Types in `sdk.d.ts` work with TypeScript or editor JS checking; runtime stays plain ESM. Build TypeScript to ESM yourself before packaging if desired.

Encoder images use layout feedback, not `setImage`: declare `"Encoder": {"layout":"$A0"}` on the manifest action and send the image through `setFeedback({'full-canvas':image})`. `$A0` exposes a 200×100 pixmap; the default `$X1` layout has text and does not display arbitrary `setImage` output. Keypad and native Panel still use `setImage`.

## Lifecycle

One process serves many independent contexts. `willAppear` creates `ctx`; `didReceiveSettings` replaces its settings before handlers run; `willDisappear` calls handlers, then disposes the context. `ctx.state` is transient per-appearance data; use `ctx.setSettings()` for persisted data. Settings are complete replacements: merge your own fields before saving. Registration and host messages outside a visible action can have **undefined context**; check `ctx` for `sendToPlugin` and global events.

`ctx.interval`, `ctx.timeout`, and `ctx.onDispose` automatically clean up on disappearance, replacement, plugin disposal or host disconnect. `ctx.signal` aborts context-scoped fetches. Late feedback from an old context returns `false`. Async handlers are caught, but execute concurrently: cancel stale requests or use your own generation tokens/queues. Timers may overlap if their async handler takes longer than the interval. Keep network cache/polling shared across contexts when appropriate.

Pass `onError(error, message)` through the `createPlugin({ onError })` option to handle errors; default writes to stderr. Never log credentials or complete settings. SDK does not reconnect or exit the process forcibly; close/dispose clears its resources, and a normally quiescent Node process exits. Register cleanup for any plugin-owned global timers or sockets with `plugin.onDispose`. Background processes must stop when no longer needed.

## Methods

Context: `setTitle`, `setImage` (data URL), `setState`, `setFeedback`, `setFeedbackLayout`, `setSettings`, `getSettings`, `showAlert`, `showOk`, `sendToPropertyInspector`, and raw `send`. All return whether a message was sent; this does **not** acknowledge execution by the host. Plugin: `on`, `send`, `setGlobalSettings`, `getGlobalSettings`, `onDispose`, `dispose`, `contexts`, `info`.

Read [the action protocol contract](PROTOCOL.md), [contribution guide](CONTRIBUTING.md), and run `npm test`. The action runtime does not open USB/HID or register devices. The separate provisional [device protocol](DEVICE-PROTOCOL.md) and `./device` entry support hardware providers; they are not part of the Elgato action API.
