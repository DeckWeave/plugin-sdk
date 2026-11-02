# Device provider protocol 1 (provisional)

This contract is separate from the Elgato action WebSocket contract. It remains
provisional until two physical adapters validate it. The SDK's mock is real
protocol exercise, not a claim that the application already installs providers.

One supervised process owns multiple independent sessions. UTF-8 JSON objects,
one per LF-terminated line, travel on stdin/stdout. stdout is protocol only;
diagnostics use stderr. No shell is used. Maximum line size is 1 MiB; the host
must also bound its process pipe and pending requests. Binary display payloads
are base64 within this limit. Protocol version and registry format are separate.

## Manifest and envelopes

`deckweave.device.json` contains `kind: "device"`, `protocol: 1`, reverse-DNS `id`,
semantic `version`, `name`, `runtime` (`node` or `native`), relative bundled `entry`, `models`, and
`platforms` (windows/macos/linux). The host launches its chosen Node runtime with
that entry and package working directory for Node. For `native`, it directly
executes the canonical bundled entry, without a shell, PATH lookup, manifest
arguments, or executable substitutions. Manifest schema is
`device-manifest.schema.json`. Resolve entry containment through symlinks before
execution; it must be a regular file within that exact package. A host-owned
`DECKWEAVE_PROVIDER_STATE_DIR` outside removable package directories is passed
for durable per-provider snapshots/recovery. Its absence disables writes that
require a snapshot. Never interpret an entry as a shell command.

Every host request is `{type, requestId, ...}`. A reply is
`{type:"result", requestId, ok:true, value}` or
`{type:"result", requestId, ok:false, error:{code,message}}`.
Session replies additionally echo `session` and `generation`. Request IDs are
unique strings within a process connection. They are never action contexts.

| Host request      | Required fields                                                | Successful value                    |
| ----------------- | -------------------------------------------------------------- | ----------------------------------- |
| `hello`           | `protocol:1`                                                   | `{protocol:1,providerId,limits}`    |
| `discover`        | —                                                              | `{devices:[descriptor]}`            |
| `open`            | `session`, `generation` (positive integer), `instanceId`       | `{descriptor,state}`                |
| `readState`       | `session`, `generation`                                        | observed state                      |
| `setSettings`     | `session`, `generation`, `changes` object                      | state/evidence                      |
| `display`         | `session`, `generation`, `target`, `mime`, `data` base64       | transport evidence                  |
| `cancel`          | `session`, `generation`                                        | cancellation result                 |
| `close`           | `session`, `generation`                                        | recovery result                     |
| `recoveryPreview` | `session`, `generation`, optional `snapshotId`                 | explicit recovery preview           |
| `recover`         | `session`, `generation`, `previewToken`, `confirmedInstanceId`, optional `resolution` | observed state plus recovery result |

`hello` must succeed before other requests. Unknown messages fail with
`unsupported`. Reused/older generations fail with `stale_generation`; an open
session cannot be replaced implicitly. Reopening after close needs a strictly
higher generation for that session ID. The host must discard late replies and
events of an older generation. Request timeout is host policy, initially 5s;
timeout never proves hardware cancellation or recovery.

## Descriptors, state, and input

Descriptor shape:

```json
{
  "instanceId": "mock-a",
  "modelId": "dev.example.mock",
  "name": "Mock A",
  "identity": { "confidence": "session", "persistentId": null },
  "geometry": { "width": 2, "height": 1 },
  "controls": [
    {
      "id": "key-1",
      "kind": "key",
      "x": 0,
      "y": 0,
      "width": 1,
      "height": 1,
      "events": ["down", "up"]
    }
  ],
  "displays": [],
  "settings": [],
  "lighting": []
}
```

`instanceId` is opaque discovery identity, not a verified permanent serial.
Only `identity.confidence:"verified"` with a real `persistentId` permits automatic
cross-reconnect binding. Session confidence requires explicit rebind after
ambiguous discovery. `modelId` and control IDs remain stable across versions.
Control kinds: `key`, `dial`, `touch`. A normal keyboard key has no display.
`displays` identify actual LCD/frame targets. `lighting` identifies independent
output groups (keys, dial LEDs, etc.), separate from LCDs. Settings descriptors
use `id`, `label:{en,ru}`, `type` (`boolean`, `number`, `choice`), optional
`min/max/step/choices`, `persistence` (`volatile`, `onboard`) and `readback` boolean.
Unsupported settings are absent. Opening/discovery/readState MUST NOT write.

Choice items are `{value: <JSON scalar>, label:{en,ru}}`; numeric values remain
numbers. `group:"lighting"` places a scalar in the full Lighting workspace.
A lighting group may declare
`staticColors:{settingId:"staticColors",address:"controlId"}` and `controls`;
then `changes.staticColors` is a bounded map of declared stable control IDs to
`{r,g,b}` integers 0–255. The provider maps addresses and preserves unknown bytes.

The provisional keyboard extension is separate from normal input events:
`keyboard.onboardMappings` declares `settingId`, `address:"controlId"`,
`layers:["main","fn"]`, and `bindingFormat:"keyboard-usage"`. Changes are
`keyMappings:{"key-49":{main:{usage:5}}}`; omitted layers/keys remain unchanged.
The initial IO adapter accepts standard usages 4–115 and 224–231, rejects paired
SOCD/RS records, and does not interpret a raw disabled assignment as capture.
`keyboard.actuation` declares its `settingId`, `address`, `minUm/maxUm/stepUm` and
`rapidMinUm` and explicit editable `fields`. Changes are a physical-control map with optional `triggerUm`,
`pressUm`, `releaseUm`, `rapidTrigger`, `wholeTravel`, `rampage` fields. The IO
range is trigger 100–3200 µm, RT 10–3200 µm, step 10 µm. Axis type and unknown flag
bits are read-only/preserved. Only the host's supported explicit declarations
enable these maps; unknown complex settings are not passed through unchecked.
Onboard remapping is a deliberate persistent device edit, separate from assigning
a DeckWeave action and from observing depth/digital input.

State is `{observed:{...}, requested:{...}, evidence:{transport,readback,physical}}`.
Evidence values are `unknown`, `accepted`, `verified`, or `unsupported`; transport
acceptance is never physical verification. Hardware readback only proves readback.

Provider events are `{type:"input",session,generation,sequence,control,event,value}`.
Sequence starts at 1, increases per session, and digital edges are ordered without
coalescing. No ordinary key text or raw hardware identity belongs in logs. A
session failure is `{type:"sessionError",session,generation,error:{code,message}}`;
it gates input until explicit reopen. Never silently drop edges on overflow.

The current provisional desktop external-provider host translates `down`, `up`
and `rotate` (plus a legacy `click`) into Core input. `touchStart/touchMove/touchEnd`
are reserved SDK declarations pending host translation; sending them currently
fails the external session. External-provider display frame rendering is also
unfinished. This limitation does not change Mirabox's existing built-in touch,
dial or LCD path. Do not advertise a third-party touch/display adapter as fully
working on the strength of a descriptor alone.

## Scheduling, cancellation, and recovery

SDK defaults: 32 queued requests per session, 32 sessions, 128 outbound messages,
1 MiB per line. Work is serialized per instance and independent sessions progress
concurrently. `cancel`/`close` abort the current cooperative operation, cancel
queued work and get priority; handlers receive an AbortSignal. A handler must
stop hardware writes on abort and serialize its USB owner. Cancellation cannot
preempt a blocked native call: the host must timeout, gate that session and
preserve any physical-recovery obligation. Closing one session must not stop
siblings. Process loss affects all sessions. No automatic action replay occurs.

Input/output queue overflow fails the affected session (or process transport if
stdout is blocked); fail closed rather than report successful delivery. Frame
coalescing is host-side policy keyed by session/target before sending. The SDK
does not claim OS-pipe writes are LCD acknowledgements. Host queues and input
validation remain required even when the provider uses this SDK.

`close` returns `{recovery:"not_needed"|"completed"|"pending"}`. A provider that
temporarily remaps onboard input must register a host-retained recovery snapshot
before takeover; this first SDK deliberately exposes no takeover method. Retain
recovery code/data outside removable package directories. No firmware update,
reset, calibration, capture or flash is permitted on discovery/open.

## Explicit recovery

`recover.resolution` is optional: omitted or `"restore"` requests restoration;
`"keepCurrent"` explicitly accepts the already verified complete requested state.
It never means “ignore the error” or “trust an ACK”. Preview declares
`restoreAvailable` and `canKeepCurrent`; a legacy incomplete snapshot can return
`restoreAvailable:false,canKeepCurrent:true,reason:"legacy_lighting_projection"`.
If neither action is available there is no confirmation token.

For `keepCurrent`, the token is tied to the current full readback, original
snapshot, selected live instance and expiry. The adapter reads again and requires
the complete canonical requested target to match, writes a durable
`accepted_verified_current` receipt, atomically retires the pending intent and
retains the original historical snapshot. It sends no hardware settings write.
Success must explicitly include `recovery:"completed",resolution:"keepCurrent",
outcome:"accepted_verified_current"`; missing proof is an error. The SDK and host
refuse this resolution unless the latest matching preview advertised support,
protecting against older providers that ignore unfamiliar fields. No preview or
matching readback automatically accepts changes or deletes a pending marker.

Recovery methods are optional adapter methods; absent methods fail with
`unsupported`. A descriptor declares `recovery:{preview:true,restore:true}` only
when implemented. Ordinary state can include
`recovery:{state:"pending"|"not_needed",pending:[{snapshotId,createdAtMs,summary}]}`.
Persist original snapshot and pending intent in the host-owned state directory
**before the first SET**. Successful full readback clears pending intent while
retaining historical snapshots. Uncertain writes leave it pending across crashes,
USB loss, removal attempts and process restarts. Do not silently reuse a vanished
discovery identity or guess a physical unit from model/firmware/USB path.

`recoveryPreview` only reads. A normal response is
`{snapshotId,createdAtMs,previewToken,expiresInMs:60000,confirmedInstanceId,
requiresConfirmation:true,identityConfidence:"session",summary:{groups,keys,changedBytes}}`.
Dates come from the durable original record. Keys are human-readable labels, no
raw paths. Multiple ambiguous retained records return
`{requiresSnapshotSelection:true,pending:[{snapshotId,createdAtMs,summary}]}`;
the user chooses a record and requests its preview explicitly. No pending record
returns `{state:"not_needed",pending:[],requiresConfirmation:false}`.

After the owner explicitly identifies/confirms the selected live unit, the host
sends `recover` with the opaque `previewToken` and `confirmedInstanceId` from that
preview. Tokens are one-use, expire after 60 seconds, and bind the live
session/generation, exact instance, retained record and fresh observed revision.
Changed state, expired token, another instance or partial restore fails closed
and retains pending intent. Restore changes only the originally edited fields,
preserves unrelated current keys/reserved data and verifies full readback. A
successful response includes `recovery:"completed"` and `recoveryState` with any
remaining pending records. This is explicit restoration, never an automatic reset.

`close` with `recovery:"pending"` retains a recovery-only session/context and
compatible code. Release the old hardware handle so an explicit fresh-instance
rebind can acquire it. Read-only state/preview/recover remain reachable, while
ordinary SET, output and input execution are gated. Retrying close after completed
recovery can finish teardown. The SDK implements this pending-close lifecycle.

For cold recovery the host may start retained code with
`DECKWEAVE_PROVIDER_RECOVERY_ONLY=1`. The native IO provider and `serveDevice`
refuse ordinary `setSettings`/`display` and input in that mode, even after markers
are resolved. Only explicit recovery writes are allowed. Completing recovery does
not clear the host's removal/disable intent; normal use requires explicit reconnect.

## Volatile key travel observation

This optional telemetry path is separate from action input and persisted settings.
Opening a device or reading its state never enables it. A descriptor can declare
`observation:{keyTravel:{minUm:0,maxUm:4000,staleAfterMs:600,normalTyping:true,evidence:"partial"}}`
and `telemetry:{keyTravel:true}` on each supported physical key control. `maxUm`
is the documented visualization scale, not a calibration guarantee; IO84 uses a
nominal 4 mm scale and partial physical evidence. Passive `decorations` such as a
`light-strip` have geometry and localized labels but no control/input address.

`observe` carries `{session,generation,enabled:boolean}` and returns
`{observing:boolean}` only after the adapter confirms the requested mode. Enable
must preserve ordinary typing. Recovery-only and pending-recovery sessions reject
enable; disable, cancel and close still attempt to stop observation. No mapping,
capture, reset or calibration command belongs to this operation.

Fresh telemetry messages are
`{type:"depth",session,generation,sequence,control,value:{travelUm,maxTravelUm?}}`.
Values are integer micrometres, bounded to 0..10000; `maxTravelUm` is optional
packet evidence and must not be assumed to be the normalization denominator.
Depth uses its own monotonically increasing sequence, independent of ordered
digital input. Coalesce latest samples per declared key, at most 30 flushes per
second, and never retransmit cached samples as fresh observations. The SDK's
`context.depth(control,value)` performs that bounded coalescing. There are no raw
ADC dumps, permanent telemetry logs or fabricated zero/release events.

Observation has a three-second renewable lease. The host renews `observe(true)`
while editor subscribers are alive; adapters must stop on expiry, EOF, cancel,
close and destruction. Renewal need not issue repeated USB mode commands. The
desktop additionally expires individual window subscriptions after three seconds
without targeted polling. Samples use host receipt age and become unknown after
600 ms; stale samples disappear instead of showing zero. An uncertain stop is
reported as an error, rather than claiming that hardware mode was restored.

Desktop IPC `set_provider_observation(deviceId,enabled)` and
`provider_observation(deviceId)` return the narrow volatile snapshot
`{enabled,state,sequence,samples:[{controlId,travelUm,maxTravelUm,ageMs}],error}`.
States are `off`, `starting`, `observing`, `stopping`, or `error`. Polling renews
only the caller window's already enabled lease; closing that window removes its
subscriptions. These updates do not clone the application snapshot, modify Core
configuration revisions, dispatch actions or emit application-wide change events.

## Optional settings presentation

Providers can describe compact controls without device-specific renderer rules.
These fields describe presentation only; they do not add writable settings or
permit a write that the provider cannot validate against current hardware.

A numeric setting can declare `presentation:"slider"`. A setting can also declare
`visibleWhen:{settingId:"effect",values:["solid"]}`. The referenced setting must
be a declared choice or boolean; the condition lists 1–32 distinct scalar values
from that setting's declared domain. Conditions cannot reference their own
setting or form cycles. Conditions support equality membership only, with no
scripts, arbitrary expressions or numeric range evaluation. Editors evaluate
visibility from observed values; an unknown or unconfirmed controlling value
must not enable a dependent hardware control.

Each lighting group can optionally include up to 16 color controls:

```json
"colorChannels": [{
  "id": "primary",
  "label": {"en": "Color", "ru": "Цвет"},
  "r": "redAmount", "g": "greenAmount", "b": "blueAmount",
  "visibleWhen": {"settingId": "effect", "values": ["solid"]}
}]
```

Each RGB component references a distinct declared numeric setting owned by that
lighting group's `settings` list, with minimum 0, maximum 255 and step 1 or an
omitted step. IDs are unique within the group's color controls. Labels are
optional bounded en/ru plain text; the ID supplies a fallback. A color control
uses the same bounded `visibleWhen` condition. Unknown presentation fields do
not create new hardware capabilities. Existing descriptors without presentation
metadata retain the generic setting list.

The existing per-key `lighting[].staticColors` capability can likewise declare
`visibleWhen:{settingId:"effect",values:["individual"]}`. It uses the same
bounded declared-choice/boolean condition, even when the group has no
`colorChannels`. The editor obtains the required effect's name from the
referenced setting's localized choices. Visibility is based on observed state;
the adapter separately rejects individual-color writes in unsupported effects.
