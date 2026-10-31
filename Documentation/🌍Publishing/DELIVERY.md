# Delivery — microcom-sim

## Where the code comes from

Written by the private `LikeDotAudio/microcom` archive: `tools/publish-sim.sh` there `rsync --delete`s its `mcom-web/`
into this checkout (minus `re/`, `specs/`, the original Ward-Beck files and any build). It refuses (exit 2) when this
repo holds a file `mcom-web/` lacks, unless `ALLOW_DELETE=1`, and refuses (exit 3) when the archive's tests fail. This
repo's `README.md`, `.github/`, `LICENSE` and `Documentation/` are excluded from the copy, so `--delete` never touches
them. The commit and push here are by hand.

## Build and test

```
npm ci
npm test               # vitest — 135 passed, 6 skipped (2026-10-31); skips need MCOM.EXE / the original MCOMFILE.*
npm run typecheck
npm run build:static   # → dist-static/
```

## Ship

- **Repository**: `https://github.com/LikeDotAudio/microcom-sim` (public).
- **Workflow**: `.github/workflows/pages.yml` — on push to `main` (or by hand): Node 24, `npm ci`, `npm test`,
  `npm run build:static`, upload `dist-static/`, deploy to GitHub Pages.
- **Live**: https://likedotaudio.github.io/microcom-sim/
- **In APK.audio**: a submodule of TRUNK-CASTER at `SRC/microcom-sim`. TRUNK-CASTER's `tools/build-intercom.sh`
  builds this pinned commit into its tracked `intercom/` folder, which is what the OS serves; this checkout itself is
  not served by any image.

## Not automated

- `publish-sim.sh` → commit → push is manual.
- The CPU-diff test never runs in CI (no MCOM.EXE on the runner); the engine parity runs there against the recorded trace.

## Delivered 2026-10-31: portable file names (no `:` `|` or case twins)

- The monorepo now checks out on Windows and macOS: no tracked name holds `<>:"|?*`, a trailing dot or space, a device name or a case-only twin. Colon folders became dot folders (the POD.x convention).
- `vendor/apk-contracts/` re-synced: the bundled topic grammar names its producer `PLUGIN.CHROMECAST/SRC/Discovery.ChromeCast/src/lib.rs`. No behaviour change.

## Delivered from the 2026-10-30 audit

All four items were made in the archive's `mcom-web/` and published here by `publish-sim.sh`. This repo is the intercom TRUNK-CASTER builds into its `intercom/`.

- **Parity runs in CI** — `test/local-parity.test.ts` compares the browser engine against `test/fixtures/local-parity.trace.json` (the Python engine's answers as one sha256 per part, keyed to the script's digest) when the Python engine is absent, and live when present. Verified here without the venv: `npm test` 135 passed, 6 skipped (was 126 / 11); a tampered digest fails naming the step. `.github/workflows/pages.yml` already runs `npm test`, so it now gates Pages on parity.
- **Versioned strip ↔ footer pair** — `src/strip/wire.ts`: `STRIP_WIRE = 1`, `StripToFrame` / `FrameToStrip`, every strip message carries `v`, footer messages are accepted unversioned or at `STRIP_WIRE`, and the strip posts to the framing origin instead of `'*'` when the browser names it. Verified: `test/strip/wire.test.ts`. The OS footer side is another repo (handoff filed).
- **Versioned releases and handshake** — `package.json` 0.2.0; both engines send `hello.proto` = `PROTOCOL` (`src/matrix/types.ts`), and `Store.proto` records it and warns on a mismatch, so a TRUNK-CASTER bump that changes the protocol is visible. Git tags here: publishing them needs the owner.
- **Docs survive a publish** — `Documentation/` (and README, `.github/`, LICENSE) are rsync-excluded, which also protects them from `--delete`; verified by the publish above leaving this wiki and the audit files in place. `publish-sim.sh`'s header now says so.
- **WS-07 accent from the brand token** (from the SDK/contracts audit) — `#f5a524` replaced: `--accent` in `index.html`, `src/emu/emu.css`, `src/matrix/style.css` reads `var(--apk-accent)` from `vendor/apk-contracts/apk-tokens.css` (the APK.audio SDK's tokens, vendored), the matrix amber `--warn` is the token's `kinda`, the strip's key LEDs are a declared lamp amber (`#ffb000`, not the accent). Made upstream and published. Verified: tsc, static build, `npm test`.
- **WS-07 tints and light-mode accent** (6cbd11f, LOOSE-sdk-microcom-sim) — the `rgba(245,165,36,a)` tints (`.drop.over`, `--sel`, `--grid-sel`) are `rgba(var(--apk-accent-rgb), a)`; the light-mode `--accent` (was `#b86e00` / `#c47a00`) is a `color-mix` of `var(--apk-accent)` with black and the light `--warn` one of `var(--apk-state-kinda)`; the favicon `data:` URIs keep the brand hex (a `data:` URI cannot read CSS variables). Published from the archive (12449ac there). Verified: `npm test` 135 passed, 6 skipped (2026-10-31).
