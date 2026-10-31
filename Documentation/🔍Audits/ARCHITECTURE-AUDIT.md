# 🔍 Architecture audit — microcom-sim (2026-10-30)

Audited against the APK.audio multi-repo architecture standard: coupling, boundaries, duplication, contracts.
← [Audits](INDEX.md) · Improvements: [🛣Roadmap/IMPROVEMENTS.md](../%F0%9F%9B%A3Roadmap/IMPROVEMENTS.md)

## Bounded context
The public, browser-only MicroCOM II intercom simulator: an 8086 emulator for MCOM.EXE (`src/emu/`), a 2048-port matrix engine in a SharedWorker (`src/local/`), key panels (`src/panel/`, `src/m2026/`), MicroCOM III (`src/mc3/`), a taskbar key strip (`src/strip/`). TypeScript + Vite 8 + Vitest, ~150 tracked files, a nested submodule of INTERCOM.TRUNK-CASTER. **Sampled:** `package.json`, `vite.config.ts`, `.github/workflows/pages.yml`, `src/local/{mode,wire,frameLink,socket}.ts`, `src/strip/main.ts`, the `test/` tree, README.

## Context map
| Talks to | How (topic / endpoint / file / import) | Relationship |
|---|---|---|
| private `microcom` archive (`mcom-web/`) | one-way `tools/publish-sim.sh` rsync into this repo (README § "Where the other docs come from") | Customer–Supplier: the archive is upstream; this repo is its published copy |
| Python engine `mcommatrix` (archive, not published) | WebSocket `/ws` + `GET /api/state` on `127.0.0.1:8048`, probed by `src/local/mode.ts`; dev proxy in `vite.config.ts` | Published Language: the local engine must answer like it (`test/local-parity.test.ts`) |
| INTERCOM.TRUNK-CASTER (parent) | pins this repo as a submodule; `tools/build-intercom.sh` builds it into tracked `intercom/` with `?engine=local`, writing `intercom/BUILT-FROM` | Customer–Supplier (this repo supplies) |
| APK.audio OS footer | `strip.html` framed; `postMessage({source:'microcom-strip',…})` out, `{source:'apkos-footer', room}` in (`src/strip/main.ts:64`, `:179`) | Published Language (an untyped message pair) |
| GitHub Pages | `.github/workflows/pages.yml`: `npm ci`, `npm test`, `build:static`, deploy | delivery |

## Scorecard
| Category | Score (0–3) | Finding |
|---|---|---|
| Coupling & Cohesion | 2 | No file references out of the repo; but it is a mirror of an upstream archive (edits here are refused by `publish-sim.sh`), so ownership is split across two repos — deliberate (the archive holds the copyrighted originals). |
| Boundary Integrity | 3 | Engine choice behind one seam (`mode.ts`); page↔worker messages typed (`src/local/wire.ts`); COM1 behind `FrameLink`; the strip↔footer pair typed and versioned (`src/strip/wire.ts`). |
| Duplication Control | 2 | The local engine is a deliberate TypeScript twin of the Python engine, now held by a parity test that runs in CI. Docs (`MATRIX.md`, `MC3.md`, `M2026.md`) are copies of the archive's. |
| Testing & Contracts | 3 | Vitest: 135 pass / 6 skip, CI runs them before every deploy (`pages.yml`), including engine parity against the recorded trace. Only `test/emu-diff.test.ts` (needs MCOM.EXE) skips in CI. |
| Change management | 3 | Consumers pin by commit (TRUNK-CASTER submodule + `intercom/BUILT-FROM`); `package.json` 0.2.0; `/ws` carries `hello.proto`, the footer pair `v`. |
Score key: 3 meets the standard · 2 minor gaps · 1 significant gaps · 0 absent / violated.

## Findings
1. **Good — static first, engine behind one seam.** `src/local/mode.ts:46` returns either the in-browser engine socket or a real `WebSocket`; every page is engine-agnostic.
2. **Good — typed internal protocol.** `src/local/wire.ts` defines the page↔SharedWorker messages as discriminated unions.
3. **Split ownership (kept by design).** Everything except `README.md`, `.github/`, LICENSE and `Documentation/` is copied from the private archive, which keeps the copyrighted originals; `publish-sim.sh` refuses when this repo holds a file the archive lacks. Fixes go upstream first.
4. **Good — no proprietary code.** README § Philosophy/Copyright: MCOM.EXE is brought by the user and stripped by `publish-sim.sh`; the recorded parity trace holds digests only.

Findings on the parity test, the footer message pair, versions and the docs' survival were delivered — see [🌍Publishing/DELIVERY.md](../%F0%9F%8C%8DPublishing/DELIVERY.md).
