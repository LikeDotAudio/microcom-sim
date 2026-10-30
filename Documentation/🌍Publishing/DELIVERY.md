# Delivery — microcom-sim

## Where the code comes from

Written by the private `LikeDotAudio/microcom` archive: `tools/publish-sim.sh` there `rsync --delete`s its `mcom-web/`
into this checkout (minus `re/`, `specs/`, the original Ward-Beck files and any build). It refuses (exit 2) when this
repo holds a file `mcom-web/` lacks, unless `ALLOW_DELETE=1`. The commit and push here are by hand.

## Build and test

```
npm ci
npm test               # vitest — 126 passed, 11 skipped (2026-10-30); skips need MCOM.EXE / the Python engine
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
- The parity and CPU-diff tests never run in CI (no MCOM.EXE, no Python engine on the runner).
