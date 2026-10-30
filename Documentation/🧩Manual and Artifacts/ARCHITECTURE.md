# Architecture — microcom-sim

## Use

**Live: https://likedotaudio.github.io/microcom-sim/** (200 on 2026-10-30).

| Page | Source | What |
|---|---|---|
| `index.html` | — | Landing page (static build only) |
| `emu.html` | `src/emu/` | MCOM.EXE v3.20 on a TypeScript 8086 (you supply MCOM.EXE); COM1 to a simulated frame or the matrix |
| `matrix.html` | `src/matrix/` | The 2048-port matrix (32 productions × 64 ports), routing and live audio |
| `panel.html` | `src/panel/`, `src/m2026/` | M7880 key panels, talent turrets, MicroCOM 2026 station and producer panels |
| `mc3.html` | `src/mc3/` | MicroCOM III assignment software |
| `strip.html` | `src/strip/` | One station's keys in a row, for a taskbar: `strip.html?p=PROD01/PNL02&keys=12` |

`npm run mc3` runs MicroCOM III in a terminal (`bin/mc3.mjs`).

## Where the engine runs — `src/local/mode.ts`, once per page load

```
?ws=URL                       → that engine
?engine=local | remote        → forced
host *.github.io or file:     → local
else GET /api/state           → JSON or 403: the Python engine (mcommatrix, 127.0.0.1:8048) serves this page → its /ws
                                anything else: local
local = src/local/: engine.ts + routing.ts + … in a SharedWorker (worker.ts), reached over one MessagePort
        (socket.ts, wire.ts); state in IndexedDB (store.ts)
```

## Build

`vite.config.ts` has two builds: `vite build` → `dist/` (absolute assets, for the Python engine to serve) and
`vite build --mode static` → `dist-static/` (relative assets, any sub-path, plus `index.html`). Entries: matrix,
panel, mc3, emu, strip (+ index on static).

## Deeper reading

`MATRIX.md`, `MC3.md`, `M2026.md`, `src/emu/README.md` — copied from the archive with the code.
