# Shared host services (version 1)

Optional DeckWeave extensions, independent of Elgato compatibility. Inspect
`plugin.capabilities` (`sound`, `panels`, `timers`). Absent or zero means unsupported;
SDK promises reject with `error.code === 'unsupported'`. Existing SDK boolean
methods still only acknowledge sending a message.

```js
plugin.on('keyUp', async ctx => {
  const panel = await ctx.panels.open('note', {
    title: 'Reminder', content: {type: 'note', text: 'Take a break'},
    placement: {anchor: 'top_right', width: 320, height: 160}
  });
  // Repeated Open preserves saved text/placement. Explicit configuration is separate:
  // await ctx.panels.configure(panel.id, panel.revision, newSpec);
  await ctx.playSound({sound: 'notice', volume: 35, eventId: crypto.randomUUID()});
});
```

`panels.get(key)` reads this action’s existing saved panel without opening it (`not_found` if absent).
`panels.open(key,spec)` persists an independent instance for this package, action
context and local key. Repeating it reopens that instance without overwriting its
configuration. Copying an action creates a separate origin. Closing preserves
its record; page/profile changes and disappearing visible contexts do not close it.
Global Settings → Panels provides reopen, removal and position/click-through recovery.

Specs contain `title`, `content` and optional `placement`. Content is escaped text:
`{type:'note',text}`, `{type:'metric',value,detail}` or
`{type:'timer',seconds,sound:null|'complete'|'notice'|'warning',volume:0..100}`.
Timer defaults are silent/35. Placement accepts `anchor` (`top_left`, `top_right`,
`bottom_left`, `bottom_right`, `free`), optional monitor name, logical `x/y`,
`width` 160..1280, `height` 80..960, six-digit hex `background/foreground`,
`opacity` 0..100, and `click_through`. Defaults are 320×160, top right, interactive.
Images, arbitrary HTML/scripts, arbitrary callbacks and host screenshot capture
are **not supported** in this slice (`images:0`, `callbacks:0`).

Native timer control: `await ctx.panels.timer(panel.id,'start'|'pause'|'reset'|'stop')`.
The host owns the run, including completion while the plugin is absent. Closing
only dismisses its panel. Explicit package disable/removal pauses its native jobs.
Elapsed alarms at application startup are consumed silently, never replayed;
future deadlines are restored. New timer sound/config applies at the next start;
reset before restarting to apply a changed duration to a paused run.

Live metrics opt into separate background service contexts:

```js
plugin.on('deckweaveServiceDidAppear', ctx => {
  const publish = () => ctx.panels.update(ctx.panel.id, {value:'42%',detail:'CPU'})
    .catch(error => console.error(error.code));
  publish(); ctx.interval(publish, 2000);
});
```

`plugin.services` is separate from `plugin.contexts`; a visible `willDisappear`
does not dispose a background context. `deckweaveServiceDidChange` replaces
`ctx.panel`; `deckweaveServiceDidDisappear` disposes it and cancels its timers.
Only open metric panels keep their producer process alive. Notes/native timers
need no background Node process. The existing package supervisor owns both forms
of demand. Share samplers across contexts; do not launch one helper per panel.

`panels.update(id,{value,detail},revision?)` is ephemeral, does not write SQLite,
and cannot reopen a closed panel. Service contexts supply their current panel
revision automatically; visible contexts must pass the revision returned by Open.
Configure/close require the current saved revision. A stale producer or another
origin/package cannot overwrite another service instance.

Sound uses three original offline PCM cues. Volume scales only this sound, never
Windows master volume. The host serializes up to four queued cues without a player
process. A repeated `(package,eventId)` within five minutes in this application run is `duplicate`;
`accepted` means queued. `deckweaveSoundFinished` reports `finished` or `failed`
in a package event (undefined context); it is not proof of audibility. An event can
be consumed but unheard after a crash: the host prefers no duplicate alarms.

Raw protocol: after authenticated standard registration, send
`{event:'deckweaveServiceRegister',payload:{version:1}}`. Requests are
`{event:'deckweaveService',context,requestId,operation,payload}`; replies are
`{event:'deckweaveServiceResult',requestId,ok,value}` or `ok:false,error:{code,message}`.
SDK bounds pending promises to 32, timeout to eight seconds, and rejects them on
disconnect. The host bounds input to 24 KiB, eight requests/second/package,
32 queued commands, eight open/128 saved panels, 8 KiB note text, 256-byte metric
values and 1024-byte details. Errors include `unsupported`, `busy`, `quota`,
`owner`, `conflict`, `closed`, `storage`, `content`, `placement`.
Windows audio is implemented; other platforms return a playback failure until
their adapter is implemented. No capability here grants device/HID access.
