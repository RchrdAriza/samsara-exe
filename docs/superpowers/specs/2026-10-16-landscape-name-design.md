# Landscape layout + user name rendered with the 1-bit effects

Date: 2026-10-16
Status: draft, pending review

## Goal

Add to the fork a **landscape** layout (960×540) that keeps the original scene (photo circle with the repo queue passing over it) on the left and adds the **user's name** on the right, drawn with the same 1-bit effect as the photo (halftone, atkinson, ascii…). Each scene element can be turned on or off.

The original portrait mode stays **intact**: it is still the default and produces the same GIFs as today.

## Agreed decisions

- Landscape is a new `layout` option: `portrait` (default) | `landscape`.
- Landscape size: **960×540** (16:9).
- Landscape composition: photo + queue on the left (the original idea), name on the right, LAST SYNC at the bottom right.
- The name appears **only in landscape**.
- On/off toggles: photo, name, repos (queue), clock (already exists), forks (already exists).
- When the repos are hidden, their options (order, count, forks) are disabled in the configurator.

## Options

| Engine (`cfg`) | Action input | URL | Default | Meaning |
|---|---|---|---|---|
| `layout` | `layout` | `?layout=` | `portrait` | `portrait` \| `landscape` |
| `photo` | `photo` | `?photo=0` | `true` | Draws the circle with the photo. `false` = no circle at all |
| `name` | `name` | `?name=0` | `true` | Draws the name (landscape only) |
| `nameText` | `name_text` | `?name_text=` | `''` | Custom text. Empty = the GitHub display name, falling back to the login |
| `queue` | `queue` | `?queue=0` | `true` | Draws the repo queue |

The existing `bg` option (photo vs. placeholder gradient inside the circle) is unchanged. `photo` is a different thing: it removes the circle entirely.

Names: `repos` is already taken (list of `owner/repo`), so the toggle is called `queue`. These names can still change during review.

## Design

### 1. Variable canvas size (`src/engine.js`)

- `W`, `H` stop being constants: they depend on `cfg.layout` (480×720 or 960×540).
- When the layout changes, `set()` resizes the canvas (`cv.width/height`), reallocates `bits`, and recomputes the geometry.
- `window.Samsara.W/H` are exposed as getters so that `app.js` (`fitCanvas`) reads the current value.
- The GIF encoder already takes `w, h` as parameters, so it does not change.

### 2. Per-layout geometry

Today the scene is about 600px tall (curve from y=30 to y=404, front window down to y≈590, clock y=590–698). That does not fit in 540, so each layout gets its own set of constants:

```
GEOM.portrait  = { P0, P1, P2, HALO, WATER zone, CLOCK pos }   // exact current values
GEOM.landscape = { shorter curve, HALO r=150 on the left, NAME box on the right, CLOCK bottom right }
```

- The curve LUT (`LUT`, `L`, `TAN_*`) moves from module level into `layout()`, computed from the active layout's `P0/P1/P2`.
- Windows keep their size (`FRONT_W=256`, `BACK_W=140`) in both layouts, so the text stays legible.
- Landscape coordinates are tuned visually during implementation. Constraint: nothing gets clipped, including the cursor and the front window when it dissolves. Starting point: halo center ≈ (300, 230), curve from y≈20 to y≈300, name box x 500–930 × y 60–380, clock x≈520, y 430–520.
- Portrait uses exactly the current numbers.

### 3. Name rendered with the effect

- `buildHalo(img)` becomes a generic function `effect(toneSource, w, h)` that applies the active `fx`/`dot` to a w×h tone canvas. The circle and the name both use it. The internal loops that assume a square `D×D` switch to `w×h`.
- Name: offscreen canvas, black text on white, in **Press Start 2P**. Size is fitted: the largest size between 32 and 96px that fits the box in at most 2 lines (wrapped on spaces). If it still does not fit at 32px, it is truncated with `…`.
- The name skips the percentile auto-leveling (meant for photos): the tone is used as-is, with solid black = full ink.
- Cache: same pattern as `haloCache`, keyed `text|fx|dot|layout`.
- `bg` does not affect the name.

### 4. Where the name comes from (`load`)

- `user` mode: `GET /users/:user` in parallel with the repos, using `name || login`. If it fails, `login` is used (it does not break the render).
- `owner/repo` mode: the first repo's owner `login` (no extra request).
- Demo: `samsara.exe`.
- `nameText`, when set, always wins.

### 5. Rendering with toggles (`render`)

- `photo=false`: no circle or outline.
- `queue=false`: no windows are drawn. The scene is static, so `encodeGif` emits **a single frame** (a tiny static GIF) instead of `repos.length` cycles.
- `name` only draws in landscape.
- Portrait with every toggle at its default = the current render.

### 6. Configurator (`src/app.js`, `index.html`)

- New controls: `Layout` (select), checkboxes `Show photo`, `Show repos`, `Show name`, and a `Name` field (placeholder: "GitHub name").
- `Show name` and `Name` only appear in landscape.
- With `Show repos` off: `Order`, `Repos` and `Include forks` are disabled.
- `syncURL`, the initial URL read and `renderSnippets` include the new options (only when they differ from the default).
- `fitCanvas` already uses `S.W/S.H`, so it works with the getter. In landscape on a wide screen the preview may need more room than the side panel leaves; this gets checked visually.

### 7. Action (`action.yml`, `action/render.mjs`)

- New inputs: `layout`, `photo`, `name`, `name_text`, `queue`, mapped to `SAMSARA_*`.
- `render.mjs`: add to `KEYS` and to `params` (`name_text` → `nameText`).
- `--window-size` in Chrome does not affect the canvas (the canvas has its own internal size). It stays as is.

### 8. Fork

- `ACTION` in `app.js` points to `AdolfLecompte/samsara-exe@v1` so the generated snippets use the fork, which has the new inputs. This requires creating the `v1` tag on the fork.
- The configurator URL in the README is replaced with the fork's GitHub Pages one, if it gets enabled.

### 9. Docs

- README: inputs table, layouts section.
- CLAUDE.md: mention of `GEOM` per layout, and the new options in the "option naming crosses layers" list.

## Verification

There are no tests in the repo. Plan:

1. **Portrait unchanged (regression):** before touching any code, render `node action/render.mjs --user octocat --clock false` and save the sha256 of both GIFs. After the change, render again with the same command and the hashes must match. Run both close together so octocat's repos don't change in between.
2. **Landscape:** render with each `fx` and a few palettes, long and short names, each toggle off. Review the GIFs visually.
3. **`queue=false`:** the GIF has 1 frame (check its size and frame count in the log).
4. **Configurator:** open `index.html`, switch layouts and toggles, check URL ↔ controls and the generated snippets.

## Out of scope

- Name in portrait.
- Animating the name.
- Other landscape sizes.
- Changes to effects or palettes.
