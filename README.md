# FIELD — GitHub Pages site

Static download + docs site for FIELD. No build step. Served at
**https://field.poetics.studio/**.

## Contents

| File | Purpose |
|---|---|
| `index.html` | Download page. Auto-detects OS, links to GitHub Release assets. |
| `learn.html` | Beginner's guide (self-contained). |
| `AI-JS.md` | Agent guide: build p5.js / vanilla-JS interactivity with FIELD. |
| `AI-PLUGINS.md` | Agent guide: add custom hardware via `.field-plugin.json`. |
| `field-bridge.js` | The library JS pages load to read FIELD values. |
| `icon.png` | Site icon. |
| `CNAME` | Custom domain for GitHub Pages. |

All internal links are **relative** so the folder can be served from any path.
Binary download links point at **GitHub Releases** (not this repo), because the
installers exceed GitHub's 100 MB per-file limit.

## macOS build is universal (Intel + Apple Silicon)

The site's macOS link points at `FIELD-0.1.0-universal.dmg`. `apps/desktop/package.json`
sets mac `arch: ["universal"]`, so `pnpm desktop:mac` emits the universal `.dmg`/`.zip`.
**If your `dist/` only has `-arm64` artifacts, they will not run on Intel Macs** —
rebuild with `pnpm desktop:mac` before releasing. `create-release.sh` warns if the
universal artifact is missing.

## Deploy

1. Push binaries to a release (once per version):
   ```bash
   pnpm desktop:all            # build universal .dmg / .exe / .zip into apps/desktop/dist
   ./scripts/create-release.sh # upload them as release v0.1.0 assets
   ```
2. Publish this folder with GitHub Pages. Either:
   - Settings → Pages → Deploy from branch → `main` / `/github-site`, **or**
   - copy these files to the repo root / a `gh-pages` branch.
3. Set the custom domain to `field.poetics.studio` (the `CNAME` file already
   declares it). Add a DNS `CNAME` record pointing the subdomain at
   `studio-poetics.github.io`.

## Updating the version

Download links are pinned to `v0.1.0`. When you cut a new version, run
`VERSION=0.2.0 ./scripts/create-release.sh` and update the `v0.1.0` strings and
sizes in `index.html`.
