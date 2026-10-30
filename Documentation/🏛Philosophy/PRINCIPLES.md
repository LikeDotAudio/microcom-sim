# Principles — microcom-sim

What the public MicroCOM simulator keeps, each with the code that keeps it.

| Principle | Kept by |
|---|---|
| **Static first.** The whole intercom runs in the browser with no server; the Python engine is detected, never required. On `*.github.io` or `file:` the engine is always local. | `src/local/mode.ts:20` (host test), `:24` (`/api/state` probe) |
| **One matrix per browser.** The engine lives in a SharedWorker so every tab and frame on the origin shares it; without SharedWorker it runs in the page and says so. | `src/local/socket.ts:12`; `src/local/worker.ts` |
| **Nothing leaves the browser on the static site.** Drive C: and the matrix setup are in IndexedDB. | `src/local/store.ts:8`; `src/emu/store.ts` |
| **The local engine answers like the real one.** One message script runs through both engines and every reply and broadcast is compared. | `test/local-parity.test.ts:159` (skips without the Python engine) |
| **The CPU is checked against a reference.** The TypeScript 8086 is stepped against Unicorn on MCOM.EXE with time frozen. | `test/emu-diff.test.ts` (skips without MCOM.EXE and mcom-tui) |
| **Bring your own original.** No part of MCOM.EXE, MCOM.HLP or MCOMFILE.* is in this repo; the emulator runs the visitor's copy. | the archive's `tools/publish-sim.sh` (excludes, then deletes, those files) |
| **A framed strip tells its parent what it needs, and nothing else.** | `postMessage({ source: 'microcom-strip', … })` (`src/strip/main.ts:64`) |

## Where it does not hold

- **This repo is a copy.** Everything but `README.md`, `.github/` and `Documentation/` is written by the private archive's
  `tools/publish-sim.sh`; an edit made here directly is overwritten or (now) blocks the next publish until carried back.
- **The strip posts to `'*'`** (`src/strip/main.ts:64`): any parent that frames it receives the station and width.
- **11 tests skip here** — the parity and CPU-diff tests need MCOM.EXE and the Python engine, which are not public — so the
  published build is never checked against the reference in CI.
