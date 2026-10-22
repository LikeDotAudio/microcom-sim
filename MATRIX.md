# Web matrix UI (`matrix.html`)

Browser client for the emulated 2048×2048 MicroCOM II matrix engine (`mcom-tui/mcommatrix`). Plain
TypeScript + DOM + canvas + WebAudio, no runtime dependencies.

## Run

```sh
# engine (HTTP + WebSocket on :8048, serial links tcp 7000-7031)
cd mcom-tui && .venv/bin/python -m mcommatrix serve --demo

# development: Vite dev server, /ws and /api proxied to 127.0.0.1:8048
cd mcom-web && npm run dev          # open http://localhost:5173/matrix.html

# production: the engine serves dist/matrix.html at http://127.0.0.1:8048/
npm run build                       # tsc --noEmit + vite build -> dist/matrix.html
npm test                            # vitest (store, grid math, audio mix, helpers)
```

The build inlines JS and CSS into `dist/matrix.html` (plugin in `vite.config.ts`), because the engine
only mounts `/assets` if `dist/assets` existed when it started. A browser refresh picks up a rebuild.
`vite.config.ts` is multi-page (`build.rolldownOptions.input`); add `index.html` there for the MCOM page.

## Architecture (`src/matrix/`)

| module | role |
|---|---|
| `types.ts` | wire types (snapshot, route/port tuples, station, client/server messages) |
| `store.ts` | state store: applies server messages, indexes routes by `(src,dst)`, src and dst, tallies, counts; pub/sub topics |
| `ws.ts` | WebSocket client, auto-reconnect (exp. backoff ≤ 5 s), re-requests the watched station |
| `gridMath.ts` / `grid.ts` | pure viewport math (zoom about cursor, pan, fit, hit-test with slop) / canvas crosspoint view |
| `ports.ts` | ports table (facility or global search) with live tallies |
| `keypanel.ts` | emulated keypanel: click = latch toggle, hold > 300 ms = momentary, keys 1–9/0/A–D |
| `extkeys.ts`, `portPicker.ts` | extended-keys editor, searchable picker over all ports |
| `facility.ts` | relays, XT01–24, IFB live state, EPC, serial link status + fault injection |
| `log.ts` | event log (newest first, kind/facility filters) |
| `audioMix.ts` / `audio.ts` / `monitor.ts` | pure mix computation / WebAudio graph / Monitor panel |
| `main.ts` | layout and wiring; `window.mcom` exposes `{store, client, select, setFacility, grid, monitor}` for debugging |

## WebSocket handling

- `snapshot` (on connect and after any config change, e.g. `extkeys`, uploads): replaces all state;
  views re-render; the selected station is re-requested.
- `routes` (after every key / trigger change): replaces routes, relays, `active` keys and `xt`; the grid
  redraws (only routes are drawn, batched by kind), tallies/relays/IFB/EPC/key lamps update, the audio
  mix is recomputed, and `{t:'station', gid}` is re-sent for the selected station.
- `station`: keypanel layout; rebuilt only when the programming changes (lamps come from `active`, so
  a held momentary key is not re-created under the pointer).
- `event` → log, `links` → header count + facility link status, `error` → header message.
- Client sends: `key` (toggle / press / release), `xt`, `clear`, `station`, `extkeys`, `fault`.

## Audio monitor

The output of the monitored port (default: the selected station) is the sum over routes with that `dst`
of `source(src) × route.gain` (muted `listen-lm` routes have gain 0; an interrupted IFB program feed is
0.1). Each input defaults to a test signal (tone at a per-port pitch; speech-like or pink noise
selectable) and can be set per port to off / tone / speech / noise / microphone (one mic, one port) /
looped audio file. Nodes exist only for inputs feeding the monitored port; crosspoint gains ramp over
20 ms; the master bus has volume, mute, a limiter and a peak/RMS meter. Audio starts only after
"Enable audio".
