# Protocol contract 0.1

This documents the implemented DeckWeave host, not a certification of full Elgato SDK compatibility. The transport is local, unencrypted `ws://127.0.0.1:<port>`; use only the host-supplied port. The host starts one Node process per package with pairs `-port`, `-pluginUUID`, `-registerEvent`, `-info`. Send `{event: registerEvent, uuid: pluginUUID}` on open. Messages use `{event, action?, context?, device?, payload?}`. Do not infer hardware identity from `context`, which is opaque and can change on navigation.

| Incoming event                                             | Payload / behavior                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| willAppear                                                 | `settings`, `controller`, optional `canvas: [width,height]`; context now visible                                                                                                                                                                                                       |
| didReceiveSettings                                         | Complete `settings` replacement                                                                                                                                                                                                                                                        |
| willDisappear                                              | Stop context timers and cancel pending work; package can remain alive for other assignments                                                                                                                                                                                            |
| keyDown / keyUp                                            | Key press/release. Execute ordinary actions on release, not both                                                                                                                                                                                                                       |
| dialDown / dialUp                                          | Encoder press/release when supported by provider                                                                                                                                                                                                                                       |
| dialRotate                                                 | Signed integer `ticks`; multiple detents may arrive together                                                                                                                                                                                                                           |
| touchTap                                                   | Elgato Encoder layout touch event, `tapPos` in its layout coordinate system, optional hold                                                                                                                                                                                             |
| panelDown / panelMove / panelUp / panelCancel / panelSwipe | DeckWeave extension. `position` can be null; when present `position.x/y` are normalized 0…1, and Y can be null if unmeasured. `canvas`, physical `control`, `hold` and swipe `right` boolean are supplied by the host. Forward payload unchanged; don't invent sampling/hold precision |
| sendToPlugin                                               | Arbitrary PI payload; context may be invisible                                                                                                                                                                                                                                         |
| didReceiveGlobalSettings                                   | `settings` for whole plugin package                                                                                                                                                                                                                                                    |
| propertyInspectorDidAppear / propertyInspectorDidDisappear | PI lifecycle; release searches and PI-only resources                                                                                                                                                                                                                                   |

Outgoing settings use `{event:'setSettings', context, payload:settings}` (no nested `settings`); globals use the plugin UUID as context. Image/title feedback uses `target:0`. `setFeedback` is an Elgato Encoder layout update; `Panel` draws an image directly and is DeckWeave-only. `setFeedbackLayout` accepts a supported layout path/name. Sending a message does not mean the host supports an arbitrary extension. No undocumented calls are added by this SDK.

To draw a full Encoder image, declare `"Encoder":{"layout":"$A0"}` on the action and call `setFeedbackLayout('$A0')`, then `setFeedback({'full-canvas':imageDataUrl})`. Its logical canvas is 200×100. The default `$X1` does not expose a full-image pixmap, and `setImage` alone is not a substitute for Encoder feedback. Keypad and native Panel images use `setImage`.

## Experimental key lighting notification

`ctx.notifyKeyLighting()` sends only
`{event:"deckweaveKeyLighting",context:ctx.id}`. It carries no device, key,
colour, or arbitrary target payload. A `true` return means the local socket
accepted the message; it is not a hardware acknowledgment. Invisible contexts
cannot send it. The host resolves the current assignment and its saved
`deckweaveKeyLightingAlert` configuration: `{deviceId,controlId,color:[r,g,b],
periodMs,durationMs,enabled}`. This field is configured by DeckWeave's native
action UI, currently for the bundled Timer action only. The event does not
extend manifest permissions, bypass experimental opt-in, or let an action
choose another assignment's target. Other hosts may ignore this DeckWeave
extension. The device adapter capability and RAM ownership are documented in
[DEVICE-PROTOCOL.md](DEVICE-PROTOCOL.md#experimental-temporary-key-lighting).

## Property Inspector

DeckWeave-only sound/panel requests and background service contexts are specified
in [Host services v1](HOST-SERVICES.md). They require explicit capability
negotiation after standard registration and are unavailable to PI sockets.

Declare `PropertyInspectorPath` in the manifest. Host calls `window.connectElgatoStreamDeckSocket(port, uuid, registerEvent, infoJson, actionInfoJson)` after the HTML loads. Register a second socket with `{event:registerEvent,uuid}`. The PI context is `uuid`; initial settings are `JSON.parse(actionInfoJson).payload.settings`. Save with `setSettings`, exchange plugin messages via `sendToPlugin` and `sendToPropertyInspector`; update fields on `didReceiveSettings`. Declare en/ru strings in the page and choose using `JSON.parse(infoJson).application.language`. Use `textContent`, never untrusted HTML. Backend and PI are separate clients, not shared JS state.

## Separate provisional device SDK

Hardware providers use `device.mjs` and the distinct provisional
[device protocol](DEVICE-PROTOCOL.md), independently of this action SDK.
Providers own transport and device controls; the host owns profiles, navigation
and action execution. The protocol is not a stable public driver ABI. An action
plugin or notification event does not impersonate a registered hardware device.
