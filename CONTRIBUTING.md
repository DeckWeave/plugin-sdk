# Contributing

1. Use Node 22+ and `npm test`; no install step or network needed.
2. Keep the runtime dependency-free and ESM. Change `sdk.d.ts` with every runtime API change.
3. Add tests for lifecycle, cancellation and multiple contexts, not only the happy path.
4. Escape dynamic SVG text and avoid external SVG images/fonts. Respect `ctx.canvas` for both keys and panels.
5. Document network endpoints, data disclosure, permissions, licensing and platform dependencies for plugins. No automatic OS/network side effects on assignment unless that is the action's explicit purpose.
6. Version the runtime on contract changes. Update the template's vendored runtime and `SDK-VERSION` in the same change; generated plugins must not depend on a sibling checkout or unpublished npm package.

Bug reports should include host/plugin/Node versions, controller type, reproduction and redacted logs. Never include settings with secrets. Proposed changes to hardware-provider contracts belong in a separate design, not in this action SDK.
