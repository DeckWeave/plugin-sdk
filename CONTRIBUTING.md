# Contributing

1. Use Node 22+ and `npm test`; no install step or network needed.
2. Keep the runtime dependency-free and ESM. Change `sdk.d.ts` with every runtime API change.
3. Add tests for lifecycle, cancellation and multiple contexts, not only the happy path.
4. Escape dynamic SVG text and avoid external SVG images/fonts. Respect `ctx.canvas` for both keys and panels.
5. Document network endpoints, data disclosure, permissions, licensing and platform dependencies for plugins. No automatic OS/network side effects on assignment unless that is the action's explicit purpose.
6. Version the runtime on contract changes. Update the template's vendored runtime and `SDK-VERSION` in the same change; generated plugins must not depend on a sibling checkout or unpublished npm package.

Bug reports should include host/plugin/Node versions, controller type, reproduction and redacted logs. Never include settings with secrets.

Device changes belong in `device.mjs`, `device.d.mts`,
`device-manifest.schema.json` and `DEVICE-PROTOCOL.md`, independently of the action
WebSocket contract. Exercise multiple sessions, stale generations, queue/framing
failure, cancellation and real generated-process interoperability without hardware.
Keep the device API provisional until two physical adapters validate it. Update
the template's device snapshot and registry manifest schema together. No HID reset,
capture or setting writes on discovery/open; transport ACK is not physical evidence.
