# Protocol contract 0.1

This documents the implemented DeckWeave host, not a certification of full Elgato SDK compatibility. The transport is local, unencrypted `ws://127.0.0.1:<port>`; use only the host-supplied port. The host starts one Node process per package with pairs `-port`, `-pluginUUID`, `-registerEvent`, `-info`. Send `{event: registerEvent, uuid: pluginUUID}` on open. Messages use `{event, action?, context?, device?, payload?}`. Do not infer hardware identity from `context`, which is opaque and can change on navigation.

| Incoming event | Payload / behavior |
|---|---|
| willAppear | `settings`, `controller`, optional `canvas: [width,height]`; context now visible |
| didReceiveSettings | Complete `settings` replacement |
| willDisappear | Stop context timers and cancel pending work; package can remain alive for other assignments |
| keyDown / keyUp | Key press/release. Execute ordinary actions on release, not both |
| dialDown / dialUp | Encoder press/release when supported by provider |
| dialRotate | Signed integer `ticks`; multiple detents may arrive together |
| touchTap | Elgato Encoder layout touch event, `tapPos` in its layout coordinate system, optional hold |
| panelDown / panelMove / panelUp / panelCancel / panelSwipe | DeckWeave extension. `position` can be null; when present `position.x/y` are normalized 0…1, and Y can be null if unmeasured. `canvas`, physical `control`, `hold` and swipe `right` boolean are supplied by the host. Forward payload unchanged; don't invent sampling/hold precision |
| sendToPlugin | Arbitrary PI payload; context may be invisible |
| didReceiveGlobalSettings | `settings` for whole plugin package |
| propertyInspectorDidAppear / propertyInspectorDidDisappear | PI lifecycle; release searches and PI-only resources |

Outgoing settings use `{event:'setSettings', context, payload:settings}` (no nested `settings`); globals use the plugin UUID as context. Image/title feedback uses `target:0`. `setFeedback` is an Elgato Encoder layout update; `Panel` draws an image directly and is DeckWeave-only. `setFeedbackLayout` accepts a supported layout path/name. Sending a message does not mean the host supports an arbitrary extension. No undocumented calls are added by this SDK.

To draw a full Encoder image, declare `"Encoder":{"layout":"$A0"}` on the action and call `setFeedbackLayout('$A0')`, then `setFeedback({'full-canvas':imageDataUrl})`. Its logical canvas is 200×100. The default `$X1` does not expose a full-image pixmap, and `setImage` alone is not a substitute for Encoder feedback. Keypad and native Panel images use `setImage`.

## Property Inspector

Declare `PropertyInspectorPath` in the manifest. Host calls `window.connectElgatoStreamDeckSocket(port, uuid, registerEvent, infoJson, actionInfoJson)` after the HTML loads. Register a second socket with `{event:registerEvent,uuid}`. The PI context is `uuid`; initial settings are `JSON.parse(actionInfoJson).payload.settings`. Save with `setSettings`, exchange plugin messages via `sendToPlugin` and `sendToPropertyInspector`; update fields on `didReceiveSettings`. Declare en/ru strings in the page and choose using `JSON.parse(infoJson).application.language`. Use `textContent`, never untrusted HTML. Backend and PI are separate clients, not shared JS state.

## Hardware providers (not implemented by this SDK)

Future providers should own discovery, transport and device controls, exposing one provider with many independent instances, capabilities/geometry and input events. Host owns profiles, navigation, action execution and compositing. An eventual contract must include identity across reconnects, key/encoder/pointer capabilities, output surfaces, cancellation and health. No provider loader, stable wire format or generated driver is shipped here; do not use action plugins to impersonate a registered hardware device.
