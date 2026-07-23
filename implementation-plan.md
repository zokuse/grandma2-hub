# Art-Net Viewer — Implementation Plan

## Overview

A standalone tab in GrandMA2 Hub for passively monitoring live Art-Net traffic
on the local network — a per-universe channel heatmap plus a discovered-node
list, in the spirit of Artnetominator. Read-only in v1 (no DMX output).

This module differs structurally from every other tool in the Hub: it owns a
long-lived background resource (a UDP socket bound to port 6454) and streams
continuous data, rather than doing one-shot request/response calls against a
telnet session or a local file. That difference drives most of the
architectural decisions below.

---

## Architecture

```
/artnet
  index.html
  style.css
  script.js
/backend
  ArtnetClient.js        (new — parallel to MA2Client.js)
  ipcHandlers.js          (add artnet_* channels)
preload.js                 (add artnet_* invoke + artnetStream push bridge)
main.js                    (register artnet handlers alongside existing ones)
shell-app/src/App.tsx       (add tab entry to TOOLS array)
```

### Why the socket lives in the Electron main process, not the renderer

Every other module talks to Node only through narrow, named IPC channels.
Giving a renderer direct `dgram` access would be a materially bigger attack
surface than anything else in the app, and it breaks the pattern the rest of
the Hub already relies on. `ArtnetClient.js` owns the socket exclusively;
`ipcHandlers.js` exposes start/stop/poll methods; the renderer only ever
receives parsed, validated packet data.

### Why this gets its own push-signal bridge, not the existing `signalCallbacks` pattern

The existing `preload.js` signal routing (`activeRequesterByChannel`,
`signalToInvokeMap`) was built for one-shot operations — a `pull_patch` call
maps to exactly one eventual `patch_pulled` reply. Art-Net data is a
continuous stream with no corresponding "request" per packet. Forcing it
through that matching logic fights the abstraction. Instead:

- `artnet_start` binds delivery to `e.senderFrame` in the backend at
  subscribe time — this is what makes routing correct, not renderer-side
  filtering.
- A separate `window.artnetStream` bridge (`onUniverseData`, `onNodeUpdate`,
  `onError`) is exposed via `contextBridge`, independent of `makeSignal()`.

### Data flow

```
UDP packet → ArtnetClient._handlePacket()
  → validate header/opcode/length
  → update in-memory per-universe buffer
  → onUniverseUpdate callback (set by ipcHandlers on artnet_start)
    → e.senderFrame.send('artnet_universe_data', ...)
      → preload.js ipcRenderer.on → window.artnetStream.onUniverseData(cb)
        → renderer buffers into pendingUniverseData Map
          → requestAnimationFrame loop reads buffer, draws canvas
```

Ingestion (packet arrival, up to ~40Hz per universe) and rendering
(display-refresh-rate canvas draw) are deliberately decoupled. The renderer
never redraws per-packet — only per animation frame, and only for whichever
universe is currently in view.

---

## Backend: `ArtnetClient.js`

Responsibilities:
- Bind a `dgram` UDP4 socket to port 6454 with `reuseAddr: true` (other
  software — Resolume, MA2 itself, another Art-Net tool — may already hold
  this port; sharing it for receive is expected, not exceptional).
- Validate every inbound packet before trusting any field in it:
  - 8-byte `"Art-Net\0"` magic header
  - Known OpCode (`OpDmx` = 0x5000, `OpPollReply` = 0x2100 for v1)
  - Declared data length in-bounds (1–512) and consistent with actual
    packet size
- Maintain an in-memory `Map<universe, {data, lastSeen, sourceIp}>` — always
  current, decoupled from how often it's read.
- Maintain a `Map<ip, {shortName, longName, lastSeen}>` from ArtPollReply
  packets, for the discovered-node list.
- Expose `start()`, `stop()`, `poll()` (broadcasts an ArtPoll), and
  synchronous snapshot getters.
- Surface bind failures (e.g. permission issues, port genuinely
  unavailable) via an `onError` callback rather than throwing silently.

## Backend: `ipcHandlers.js` additions

New channels:
| Channel | Type | Purpose |
|---|---|---|
| `artnet_start` | invoke | Subscribes the calling frame, binds the socket if not already bound |
| `artnet_stop` | invoke | Unsubscribes, closes the socket, clears buffers |
| `artnet_poll` | invoke | Sends an ArtPoll broadcast |
| `artnet_get_active_universes` | invoke | Returns currently-known universe list |
| `artnet_universe_data` | push | `(universe, data[], sourceIp)` — sent to `e.senderFrame` only |
| `artnet_node_update` | push | `(ip, {shortName, longName})` |
| `artnet_error` | push | Socket-level errors (bind failure, etc.) |

`artnet_start` records `e.senderFrame` as the active subscriber and wires
`ArtnetClient`'s callbacks to send exclusively to that frame — this is the
same `senderFrame`-scoping fix already applied elsewhere in `ipcHandlers.js`
for the iframe-routing bug, applied from day one here rather than
discovered later.

## `preload.js` additions

- New `makeInvoke()` entries for the four invoke channels above.
- New standalone bridge:
  ```js
  contextBridge.exposeInMainWorld('artnetStream', {
      onUniverseData: (cb) => ipcRenderer.on('artnet_universe_data', (e, u, d, ip) => cb(u, d, ip)),
      onNodeUpdate: (cb) => ipcRenderer.on('artnet_node_update', (e, ip, info) => cb(ip, info)),
      onError: (cb) => ipcRenderer.on('artnet_error', (e, msg) => cb(msg))
  });
  ```
- No changes to the existing `signalCallbacks`/`activeRequesterByChannel`
  machinery — this module deliberately bypasses it.

## Renderer: `/artnet/script.js`

- Buffer incoming universe data into a `Map`, do not render on packet
  arrival.
- Drive a `requestAnimationFrame` loop that reads the buffer for the
  currently-selected universe only, and draws to a `<canvas>` — not DOM
  cells. At up to 40Hz input, direct DOM mutation of 512 cells is
  measurably worse than a single canvas paint per frame.
- Universe selector reuses the Hub's existing sidebar-tab visual language
  (`shared.css` classes) so it feels consistent with DMX View without
  sharing its DOM-grid implementation.
- Node list panel renders discovered ArtPollReply senders (IP, short/long
  name, last-seen), updating in place rather than re-sorting/rebuilding on
  every update.
- `visibilitychange` listener calls `artnet_stop`/`artnet_start` so the
  socket doesn't need to run — and packets don't need to be parsed — while
  the tab isn't in view.

## Shell: `App.tsx`

One entry added to the `TOOLS` array, same shape as every existing tool:
```tsx
{ id: 'artnet', label: 'Art-Net Viewer', url: '../../artnet/index.html', icon: <svg .../> }
```
No other shell changes required — lazy iframe mounting, sidebar nav, and
tab switching all work unmodified through existing mechanisms.

---

## Security / robustness notes specific to this module

Unlike telnet (typed by the user) or file import (a file the user
explicitly picked), Art-Net packets arrive from **any device on the
network**, unauthenticated, with no integrity layer. Treat all inbound data
as untrusted:

- Never index into a buffer using a length/offset field from the packet
  without bounds-checking it first.
- Never assume every UDP packet on port 6454 is well-formed Art-Net —
  validate the magic header and OpCode before parsing further.
- A malformed or malicious packet should be silently dropped, not crash the
  main process or corrupt in-memory state for other universes.

## Explicitly out of scope for v1

- **Sending/output mode.** This module is receive-only. Injecting DMX onto
  a live network is a meaningfully different risk profile (accidental
  interference with a real rig) and should be a separate, explicitly-gated
  feature if ever built — not bundled into the initial viewer.
- **Full ArtPoll/ArtPollReply discovery handshake.** v1 infers active
  universes and sources passively from observed `OpDmx` traffic; active
  polling for a full device list (firmware, port config, etc.) is a
  phase-2 addition.
- **Per-channel history / flicker detection.** Genuinely useful for
  diagnosing a flaky DMX line, but adds meaningful complexity — deferred
  until the core viewer is stable.

## Open questions to confirm during implementation

1. Does `visibilitychange` fire reliably for a `display:none` iframe under
   the Hub's current tab-switching mechanism? (Expected yes, needs
   confirmation in testing — nothing in the shell is explicitly wired for
   this today.)
2. What should happen if `artnet_start` is called while port 6454 is
   already bound by something else with `reuseAddr` unsupported on the
   host OS/network stack? Needs a clear, visible error state in the UI
   rather than a silent no-op.
