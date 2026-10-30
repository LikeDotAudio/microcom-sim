# MicroCOM Simulator

**Live: https://likedotaudio.github.io/microcom-sim/**

The Ward-Beck Systems MicroCOM II intercom matrix (1988–93), running in a web browser:

| Page | What |
|---|---|
| [Emulator](https://likedotaudio.github.io/microcom-sim/emu.html) | The original MicroCOM II Assignment Software (MCOM.EXE v3.20), unmodified, on an 8086 PC emulated in TypeScript (`src/emu/`). You supply MCOM.EXE; it is not hosted here. COM1 can go to a simple simulated frame or to the matrix simulator. |
| [Matrix simulator](https://likedotaudio.github.io/microcom-sim/matrix.html) | A 2048-port matrix engine (32 productions × 64 ports) with routing and live audio (`src/matrix/`), running in a SharedWorker so all your tabs share one matrix. |
| [Panels](https://likedotaudio.github.io/microcom-sim/panel.html) | M7880 key panels, talent turrets, and the MicroCOM 2026 station and producer panels (`src/panel/`, `src/m2026/`). Panels in different tabs hear each other. |
| [MicroCOM III](https://likedotaudio.github.io/microcom-sim/mc3.html) | The assignment software in the MicroCOM II look, for the large virtual matrix (`src/mc3/`). |
| `strip.html` | One station's keys in a single row, small enough for a taskbar (`src/strip/`). `strip.html?p=PROD01/PNL02&keys=12`; framed, it reports its width and station to its parent with `{ source: 'microcom-strip', … }`. The APK.audio OS footer frames it. Not linked from the landing page. |

`index.html` is the landing page of the static build.

## Where the engine runs

Every page talks to a matrix engine over a WebSocket-shaped connection. `src/local/mode.ts` decides once per page load which engine:

- `?ws=URL` — a real engine at that URL; `?engine=local` / `?engine=remote` force one or the other.
- On `*.github.io` or `file:` — the **local engine**: `src/local/` runs the matrix in a SharedWorker (`worker.ts`, or in the page when SharedWorker is missing), with state in the browser's IndexedDB (`store.ts`).
- Anywhere else it probes `GET /api/state`: a JSON answer or a 403 means the Python engine (`mcommatrix`, in the private microcom archive; HTTP + WebSocket on 127.0.0.1:8048) is serving the page, and the page connects to its `/ws`. Otherwise it runs locally.

On the static site nothing leaves your browser: the emulator's drive C: and the matrix setup live in IndexedDB.

## Build and test

```bash
npm ci
npm test               # vitest: 126 pass, 11 skip — the skips need MCOM.EXE or mcom-tui's Python engine
npm run typecheck      # tsc --noEmit
npm run build:static   # -> dist-static/: relative assets, works under any sub-path, includes index.html
npm run build          # -> dist/: absolute assets, for the Python engine to serve
npm run dev            # vite dev server; /ws and /api are proxied to 127.0.0.1:8048
npm run mc3            # MicroCOM III in a terminal (node bin/mc3.mjs [--url ws://127.0.0.1:8048/ws] [--prod N])
```

`.github/workflows/pages.yml` runs `npm ci`, `npm test` and `npm run build:static`, and deploys `dist-static/` to GitHub Pages on every push to `main`.

APK.audio's TRUNK-CASTER pins this repo and builds it into its own tracked `intercom/` folder (`tools/build-intercom.sh` there), always with `?engine=local`.

## Where the other docs come from

`MATRIX.md`, `MC3.md`, `M2026.md` and `src/emu/README.md` explain how each part works. They, and everything here except `README.md` and `.github/`, are copied from `mcom-web/` of the private [microcom](https://github.com/LikeDotAudio/microcom) archive by its `tools/publish-sim.sh`. The exception is the key strip (`strip.html`, `src/strip/`, `test/strip/` and its entry in `vite.config.ts`), committed here directly and not yet in the archive — `publish-sim.sh` runs `rsync --delete`, so the next publish would remove it unless the strip is carried into `mcom-web/` first. Their commands (`cd mcom-tui …`, `cd mcom-web …`) are written for that archive: `mcom-web/` is this repo, and `mcom-tui/` (the Python engine and the Unicorn reference emulator) is not published.

## Philosophy

- **Static first.** The whole intercom runs in the browser with no server (`src/local/`); the Python engine is an option the page detects, never a requirement (`src/local/mode.ts`).
- **One matrix per browser.** The engine lives in a SharedWorker, so every tab and every frame on the origin is on the same matrix (`src/local/socket.ts`, `worker.ts`).
- **The local engine answers like the real one.** `test/local-parity.test.ts` runs one script through both engines and compares every reply and broadcast when the Python engine is present.
- **Bring your own original.** The emulator runs the visitor's own MCOM.EXE; nothing of Ward-Beck's program is in this repo, and `tools/publish-sim.sh` in the archive deletes MCOM.EXE, MCOM.HLP and MCOMFILE.* from anything it publishes.
- **The CPU is checked against a reference.** `test/emu-diff.test.ts` steps the TypeScript 8086 against Unicorn on MCOM.EXE (skipped without them).

## Copyright

MicroCOM II and its software are © 1991–93 Ward-Beck Systems Ltd., developed by Weitech Computer Solutions.
This repository contains no part of the original program. Part of the
[Ward-Beck Systems Preservation Society](https://likedotaudio.github.io/WBSps.ca/) archive.

<!-- wiki:smoke -->
**Smoke test** — ✅ PASS 2/2 since 2026-10-30 12:51 EDT — [results](Documentation/%F0%9F%A7%A9Manual%20and%20Artifacts/SMOKE.md)
<!-- /wiki:smoke -->
