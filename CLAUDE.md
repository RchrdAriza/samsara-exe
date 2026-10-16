# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

samsara.exe renders a user's GitHub repos as an animated 1-bit GIF (a queue of retro dialog windows) for profile READMEs. It ships two ways from the same code: a static configurator page (`index.html`, served via GitHub Pages) and a composite GitHub Action (`action.yml`).

No build step, no package.json, no npm dependencies, no test suite or linter. Plain browser JS plus one Node script.

## Commands

- Configurator: open `index.html` in a browser (or serve the repo root statically). URL params: `?clean=1` shows only the animation; `?user=`, `?repos=`, `?fx=`, `?palette=`, `?dot=`, `?tz=`, etc. preset config.
- Render GIFs locally (Node 22+, Chrome/Chromium on PATH or `CHROME_PATH`):
  ```sh
  node action/render.mjs --user octocat --fx atkinson --timezone Europe/Madrid
  ```
  Flags mirror the action inputs (`--max-repos`, `--dark-output`, ...); `SAMSARA_*` env vars work too. `GITHUB_TOKEN` is picked up if set (avoids the 60 req/hour unauthenticated limit). Output goes to `samsara.gif` / `samsara-dark.gif` in cwd.
- CI: `.github/workflows/demo.yml` runs the action from this checkout (`uses: ./`) on every push to `main` and daily, regenerating the README demo GIF on the `samsara` branch. A push to `main` is effectively the integration test.

## Architecture

**`src/engine.js`** is the core, an IIFE exposing one global, `window.Samsara`. It owns everything rendering-related: the `cfg` object (validated/clamped only through `set(patch)`), GitHub API fetching (`load`), drawing to a fixed 480×720 canvas, the 1-bit pipeline (Bayer-dithered fades, separately thresholded text, image effects in `EFFECTS`, two-color `PALETTES`), and a hand-written 2-color LZW GIF encoder (`Gif1Bit`) that emits only changed rectangles and transparent unchanged pixels. Light and dark GIFs share frames and differ only in palette.

**`src/app.js`** is the configurator UI on top of the engine: controls, URL ↔ config sync (`syncURL`), live preview loop, in-browser GIF download, and generation of the workflow YAML / README snippets (`renderSnippets`). With `?headless=1` it does nothing except mount the canvas and set `window.samsaraReady`.

**`action/render.mjs`** (used by `action.yml`) starts a tiny static server for the repo root, launches headless Chrome on `index.html?headless=1`, talks to it over raw CDP via the built-in `WebSocket`, and calls `Samsara.exportForAction(params)`, which returns base64 GIFs. The action then force-pushes them as a single orphan commit to the `push_to` branch. Because the action runs the exact same `index.html`, configurator output and action output are pixel-identical; keep it that way (no Node-side rendering).

### Option naming crosses layers

An option exists in up to five places with different names, e.g. action input `max_repos` → `SAMSARA_MAX_REPOS` / `--max-repos` → render.mjs `params.max` → engine `cfg.max` → URL `?max=`; `timezone` → `tz`. Adding or changing an option means updating:

1. `action.yml` input + `SAMSARA_*` env mapping
2. `action/render.mjs` `KEYS` and the `params` object in main
3. `src/engine.js` `DEFAULTS` and the `set()` switch (clamping/validation lives here)
4. `src/app.js` initial `S.set({...})` from URL, `syncURL`, `renderSnippets`, and the control in `index.html` if user-facing
5. `README.md` inputs table (and effects/palettes tables if relevant)

`src/app.js` hardcodes the published action ref `RchrdAriza/samsara-exe@v1` in generated snippets.
