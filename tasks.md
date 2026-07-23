# Art-Net Viewer — Task List

Reference: see `implementation-plan.md` for architecture and rationale.

---

## Phase 0 — Setup

- [ ] Confirm port 6454 isn't already exclusively bound by another local
      tool during dev (Resolume, an existing Art-Net app) — verify
      `reuseAddr` behavior on your dev machine before writing UI around it.
- [ ] Create `/artnet` folder with `index.html`, `style.css`, `script.js`
      following the same file layout as every existing module.

---

## Phase 1 — Backend: `ArtnetClient.js`

- [ ] Create `backend/ArtnetClient.js`, structured parallel to
      `MA2Client.js`.
- [ ] Implement `start()`: bind `dgram` UDP4 socket, port 6454,
      `reuseAddr: true`, enable broadcast.
- [ ] Implement `stop()`: close socket, clear `universes`/`nodes` maps.
- [ ] Implement `_handlePacket()`:
  - [ ] Reject packets shorter than the minimum valid Art-Net length.
  - [ ] Validate the 8-byte `"Art-Net\0"` magic header before parsing
        anything else.
  - [ ] Dispatch on OpCode (`OpDmx` / `OpPollReply` for v1; ignore others).
- [ ] Implement `_handleDmx()`:
  - [ ] Parse `SubUni`/`Net` into a combined universe number.
  - [ ] Bounds-check declared data length (1–512) against actual packet
        size before reading the data segment.
  - [ ] Store into `universes` map with `lastSeen` timestamp and source IP.
  - [ ] Fire `onUniverseUpdate` callback.
- [ ] Implement `_handlePollReply()`:
  - [ ] Bounds-check packet length before parsing fixed-offset fields.
  - [ ] Extract short/long name, strip trailing null bytes.
  - [ ] Store into `nodes` map, fire `onNodeUpdate` callback.
  - [ ] Wrap in try/catch — malformed replies should be dropped, not
        crash the handler.
- [ ] Implement `poll()`: construct and broadcast a minimal ArtPoll packet.
- [ ] Implement `getUniverseSnapshot()` / `getActiveUniverses()` synchronous
      getters.
- [ ] Manual test: confirm the socket binds cleanly and unbinds cleanly on
      repeated start/stop cycles (no leaked handles).

---

## Phase 2 — Backend: `ipcHandlers.js` wiring

- [ ] Add `registerArtnetHandlers()` function, instantiate one
      `ArtnetClient` instance.
- [ ] `artnet_start` handler:
  - [ ] Record `e.senderFrame` as the active subscriber.
  - [ ] Wire `onUniverseUpdate`/`onNodeUpdate`/`onError` callbacks to
        `e.senderFrame.send(...)`, each wrapped in try/catch in case the
        frame is torn down mid-stream.
  - [ ] Call `artnetClient.start()`, return result as JSON.
- [ ] `artnet_stop` handler: call `artnetClient.stop()`, clear subscriber
      reference.
- [ ] `artnet_poll` handler: call `artnetClient.poll()`.
- [ ] `artnet_get_active_universes` handler: return current universe list
      as JSON.
- [ ] Register `registerArtnetHandlers()` call in `main.js` alongside the
      existing `registerIpcHandlers()` call.
- [ ] Consider extracting the `safeSend()` guard pattern (frame-null check
      + try/catch) as a shared helper if it isn't already, since this
      module needs it on every push call.

---

## Phase 3 — `preload.js` wiring

- [ ] Add `artnet_start`, `artnet_stop`, `artnet_poll`,
      `artnet_get_active_universes` to the `makeInvoke()` API object.
- [ ] Add standalone `window.artnetStream` bridge via
      `contextBridge.exposeInMainWorld` — separate from the existing
      `signalCallbacks` machinery (see implementation plan for why).
- [ ] Confirm this doesn't interact badly with the existing per-channel
      `activeRequesterByChannel` logic (it shouldn't — it's a fully
      separate bridge object).

---

## Phase 4 — Renderer UI (`/artnet`)

- [ ] `index.html`: header (start/stop toggle, poll button), universe
      sidebar list, node list panel, canvas viewport — reuse
      `shared.css` classes (`status-header-card`, `glassy-surface`,
      `sidebar-card`, etc.) for visual consistency with the rest of the
      Hub.
- [ ] `style.css`: module-specific styles only (canvas sizing, node-list
      item styling) — don't duplicate anything `shared.css` already
      provides.
- [ ] `script.js`:
  - [ ] On load, call `artnet_start`, subscribe to
        `artnetStream.onUniverseData` / `onNodeUpdate` / `onError`.
  - [ ] Buffer incoming universe data into a `Map`, keyed by universe
        number — do not render directly from the callback.
  - [ ] `requestAnimationFrame` loop: read the buffer for the
        currently-selected universe, draw to canvas.
  - [ ] Canvas draw function: 32×16 grid (512 channels), color-intensity
        mapped from channel value, reusing the Hub's accent-color ramp.
  - [ ] Universe sidebar: populate/update from `artnet_get_active_universes`
        and from live `onUniverseData` arrivals (auto-discover universes
        as traffic appears, don't require manual entry).
  - [ ] Node list panel: render/update from `onNodeUpdate`, in place
        (don't rebuild the whole list on every update).
  - [ ] `visibilitychange` listener: call `artnet_stop` on hide,
        `artnet_start` on show.
  - [ ] Error display: surface `artnetStream.onError` (e.g. bind failure)
        as a visible toast/banner, not just a console log.
- [ ] Hover tooltip on a channel cell showing exact value + channel number
      (matches the interaction pattern already established in DMX View).

---

## Phase 5 — Shell integration

- [ ] Add Art-Net Viewer entry to `TOOLS` array in `App.tsx` with an
      appropriate icon.
- [ ] Confirm lazy iframe mounting works correctly for this tab (should,
      unmodified).
- [ ] Confirm the tab correctly triggers `visibilitychange` when hidden
      via the shell's existing `display:none` tab-switch mechanism —
      this is the one place this module's correctness depends on shell
      behavior that wasn't originally built with a streaming module in
      mind.

---

## Phase 6 — Testing

- [ ] Bind conflict test: start the app while another tool already holds
      port 6454 — confirm a visible error state, not a silent failure.
- [ ] Malformed packet test: send a few deliberately malformed UDP packets
      to port 6454 (wrong magic header, declared length exceeding actual
      packet size, truncated ArtPollReply) — confirm they're dropped
      without crashing the main process or corrupting other universes'
      data.
- [ ] Load test: point a real or simulated Art-Net source (MA2, Resolume,
      or a simple test script) sending multiple universes at ~40Hz —
      confirm the canvas stays smooth and CPU usage stays reasonable.
- [ ] Tab-switch test: start monitoring, switch to another Hub tab for a
      while, switch back — confirm the socket correctly stopped/restarted
      and the display resumes showing live data promptly.
- [ ] Multi-universe test: confirm switching the selected universe in the
      sidebar correctly redraws the canvas for the newly selected universe
      without lag or stale data from the previous selection.
- [ ] Long-session test: leave the tab open and receiving data for an
      extended period — confirm no memory growth from the `universes` /
      `nodes` maps (consider whether stale entries, e.g. a universe that
      stopped sending an hour ago, should eventually be pruned based on
      `lastSeen`).

---

## Explicitly deferred (do not implement in this pass)

- [ ] ~~DMX output / test-pattern injection~~ — separate, explicitly-gated
      feature if ever built.
- [ ] ~~Full ArtPoll/ArtPollReply active discovery~~ — v1 is passive-only.
- [ ] ~~Per-channel history / flicker detection~~ — phase 2 candidate.
