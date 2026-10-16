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
- Portrait regression check: the engine is deterministic, so with `--clock false` the same user and options give byte-identical GIFs. Render the old code (e.g. a `git worktree` of `main`) and the new code back to back per effect and `cmp` them. Use a user whose repos rarely change: octocat's star/fork counts change within minutes and show up as a few differing pixels. Unauthenticated runs share 60 API calls/hour (2 per render).
- CI: `.github/workflows/demo.yml` runs the action from this checkout (`uses: ./`) on every push to `main` and daily, regenerating the README demo GIF on the `samsara` branch. A push to `main` is effectively the integration test.

## Architecture

**`src/engine.js`** is the core, an IIFE exposing one global, `window.Samsara`. It owns everything rendering-related: the `cfg` object (validated/clamped only through `set(patch)`), GitHub API fetching (`load`), drawing to the canvas, the 1-bit pipeline (Bayer-dithered fades, separately thresholded text, image effects in `EFFECTS`, two-color `PALETTES`), and a hand-written 2-color LZW GIF encoder (`Gif1Bit`) that emits only changed rectangles and transparent unchanged pixels. Light and dark GIFs share frames and differ only in palette.

Scene coordinates live per layout in `LAYOUTS` (`portrait` 480×720 is the original scene and must stay pixel-identical; `landscape` 960×540 adds `nameBox`). `W`/`H`, the queue curve LUT and the `bits` buffer are rebuilt in `layout()` when `cfg.layout` changes, so `Samsara.W/H` are getters. `applyEffect(T, w, h, clear)` turns a tone map into a 1-bit canvas with the active `fx`; the circle (`buildHalo`) and the `pixel` name style go through it. The other name styles (`blockName`) sample Press Start 2P at 2x into an 8×8-per-glyph bitmap and draw each pixel as a k×k cell, so they ignore `fx`; `buildName` stacks bars / name / tagline and caches the result per text, style, deco, fx and dot.

**`src/app.js`** is the configurator UI on top of the engine: controls, URL ↔ config sync (`syncURL`), live preview loop, in-browser GIF download, and generation of the workflow YAML / README snippets (`renderSnippets`). With `?headless=1` it does nothing except mount the canvas and set `window.samsaraReady`.

**`action/render.mjs`** (used by `action.yml`) starts a tiny static server for the repo root, launches headless Chrome on `index.html?headless=1`, talks to it over raw CDP via the built-in `WebSocket`, and calls `Samsara.exportForAction(params)`, which returns base64 GIFs. The action then force-pushes them as a single orphan commit to the `push_to` branch. Because the action runs the exact same `index.html`, configurator output and action output are pixel-identical; keep it that way (no Node-side rendering).

### Option naming crosses layers

An option exists in up to five places with different names, e.g. action input `max_repos` → `SAMSARA_MAX_REPOS` / `--max-repos` → render.mjs `params.max` → engine `cfg.max` → URL `?max=`; `timezone` → `tz`; `name_text` → `cfg.nameText`. The repo-queue toggle is `queue` because `repos` is already the `owner/repo` list. Adding or changing an option means updating:

1. `action.yml` input + `SAMSARA_*` env mapping
2. `action/render.mjs` `KEYS` and the `params` object in main
3. `src/engine.js` `DEFAULTS` and the `set()` switch (clamping/validation lives here)
4. `src/app.js` initial `S.set({...})` from URL, `syncURL`, `renderSnippets`, and the control in `index.html` if user-facing
5. `README.md` inputs table (and effects/palettes tables if relevant)

This is a fork of RchrdAriza/samsara-exe. `src/app.js` hardcodes the fork's action ref `AdolfLecompte/samsara-exe@v1` in generated snippets, so the fork needs a `v1` tag.
