# MicroCOM Simulator

**Live: https://likedotaudio.github.io/microcom-sim/**

The Ward-Beck Systems MicroCOM II intercom matrix (1988–93), running in a web browser:

| Page | What |
|---|---|
| [Emulator](https://likedotaudio.github.io/microcom-sim/emu.html) | The original MicroCOM II Assignment Software (MCOM.EXE v3.20), unmodified, on an 8086 PC emulated in TypeScript. You supply MCOM.EXE; it is not hosted here. COM1 can go to a simple simulated frame or to the matrix simulator. |
| [Matrix simulator](https://likedotaudio.github.io/microcom-sim/matrix.html) | A 2048-port matrix engine (32 productions × 64 ports) with routing and live audio, running in a SharedWorker so all your tabs share one matrix. |
| [Panels](https://likedotaudio.github.io/microcom-sim/panel.html) | M7880 key panels, talent turrets, and the MicroCOM 2026 station and producer panels. Panels in different tabs hear each other. |
| [MicroCOM III](https://likedotaudio.github.io/microcom-sim/mc3.html) | The assignment software in the MicroCOM II look, for the large virtual matrix. |

Everything is static: no server, nothing leaves your browser. State (the drive C: of the emulator, the matrix setup) is kept in your browser's IndexedDB.

## Build

```bash
npm ci
npm test               # tests that need MCOM.EXE or the Python reference engine skip without them
npm run build:static   # -> dist-static/, works under any sub-path
npm run dev            # vite dev server
```

`.github/workflows/pages.yml` builds and deploys to GitHub Pages on every push to `main`.

See `MATRIX.md`, `MC3.md`, `M2026.md` and `src/emu/README.md` for how each part works.

## Copyright

MicroCOM II and its software are © 1991–93 Ward-Beck Systems Ltd., developed by Weitech Computer Solutions.
This repository contains no part of the original program. Part of the
[Ward-Beck Systems Preservation Society](https://likedotaudio.github.io/WBSps.ca/) archive.
