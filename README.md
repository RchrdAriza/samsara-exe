<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/RchrdAriza/samsara-exe/raw/samsara/samsara-dark.gif">
  <img alt="samsara.exe demo" src="https://github.com/RchrdAriza/samsara-exe/raw/samsara/samsara.gif" width="360">
</picture>

# samsara.exe

Your repos as an endless 1-bit queue of retro dialog windows.<br>
Each one approaches, gets clicked, dissolves, and is reborn at the back of the queue.

**[Try it with your username →](https://rchrdariza.github.io/samsara-exe/)**

</div>

## Demo

A minute-long tour of the configurator: every effect, every palette and every option.

https://github.com/user-attachments/assets/7b5fd2a6-f071-4bac-8d2c-75a42dc8d5f3

## Add it to your profile README

1. Open the **[configurator](https://rchrdariza.github.io/samsara-exe/)**, type your username and pick an effect.
   Hit **Get it for my README** to get both snippets with your settings filled in.
2. In your profile repo (`you/you`), create `.github/workflows/samsara.yml`:

   ```yaml
   name: samsara.exe

   on:
     schedule:
       - cron: "0 0 * * *" # once a day
     workflow_dispatch:

   permissions:
     contents: write

   jobs:
     samsara:
       runs-on: ubuntu-latest
       steps:
         - uses: RchrdAriza/samsara-exe@v1
           with:
             fx: atkinson
             timezone: "America/Bogota"
   ```

3. Run it once from the **Actions** tab. From then on it refreshes every day.
4. Paste this in your `README.md`, replacing `you` with your username:

   ```html
   <picture>
     <source media="(prefers-color-scheme: dark)" srcset="https://github.com/you/you/raw/samsara/samsara-dark.gif">
     <img alt="samsara.exe" src="https://github.com/you/you/raw/samsara/samsara.gif">
   </picture>
   ```

The GIFs are force-pushed to a separate `samsara` branch as a single commit, so your
history doesn't grow by a megabyte every day. Visitors with a dark GitHub theme get the
inverted version automatically.

## Effects

The circle shows your avatar (or any image you choose) through one of eight 1-bit effects:

| `fx` | Look |
|---|---|
| `halftone` | Newspaper dots on a 45° grid |
| `atkinson` | The classic Macintosh dither |
| `floyd` | Floyd–Steinberg error diffusion, fine and organic |
| `bayer` | Ordered dither, Game Boy style |
| `lines` | Wavy engraving lines that thicken in the shadows |
| `cross` | Hand-drawn crosshatching |
| `ascii` | Made of characters |
| `threshold` | Pure black and white, stencil style |

`dot` (3–16) sets the size of the dots, lines, characters or pixels.

## Layouts

| `layout` | Size | Scene |
|---|---|---|
| `portrait` | 480×720 | The original: the circle with the queue passing over it, and the clock below |
| `landscape` | 960×540 | The same circle and queue on the left, your name on the right drawn with the same effect, and the clock below it |

Each part can be turned off: `photo: false` hides the circle, `queue: false` hides the
repo windows (the GIF becomes a single static frame) and, in landscape, `name: false`
hides the name. The name is your GitHub display name, or your login if you don't have
one; `name_text` replaces it with any text.

| `name_style` | Look |
|---|---|
| `pixel` | Pixel font through the circle's effect (halftone, ascii…) |
| `block` | Solid blocks with a double-line drop shadow, like ANSI Shadow |
| `shade` | The same blocks with a `░▒▓█` gradient from top to bottom |
| `outline` | Only the double-line contour |

`name_deco` adds `bars` (`░▒▓██▓▒░` above and below) or `columns` (shaded brackets on
each side). Under the name goes a tagline: your GitHub bio by default, any text with
`tagline`, or nothing with `tagline: false`.

## Palettes

Everything is two colors, ink and paper. Pick a pair with `palette`:

| `palette` | Ink / paper |
|---|---|
| `classic` | black / white |
| `gameboy` | dark green / lime, like the 1989 Game Boy |
| `amber` | amber on near-black, like an amber CRT |
| `phosphor` | green phosphor terminal |
| `cyanotype` | pale blue on blueprint blue |
| `sepia` | brown on cream |
| `riso` | red on off-white, like a risograph print |
| `vapor` | pink on deep purple |
| `win95` | white on the Windows 95 teal |

For GitHub's dark theme, the dark GIF uses the palette with its darker color as the
background. Palettes that already have a dark background look the same in both themes.

## Inputs

| Input | Default | Description |
|---|---|---|
| `user` | repo owner | User whose public repos are shown |
| `repos` | | Comma-separated `owner/repo` list to show instead |
| `fx` | `halftone` | Effect for the circle (see above) |
| `palette` | `classic` | Two-tone colors (see above) |
| `dot` | `7` | Effect size, 3–16 |
| `image` | your avatar | Image for the circle: a path in your repo (add `actions/checkout` before this step) or a CORS-enabled URL |
| `sort` | `pushed` | `pushed`, `stars` or `name` |
| `forks` | `false` | Include forked repos |
| `max_repos` | `10` | Repos in the loop, `0` = all. Each one adds about 3 s and 130 KB |
| `layout` | `portrait` | `portrait` or `landscape` (see above) |
| `photo` | `true` | Show the circle. `false` hides it |
| `queue` | `true` | Show the repo windows. `false` makes a static GIF without them |
| `name` | `true` | Show your name (landscape only). `false` hides it |
| `name_text` | your GitHub name | Text to show instead of your name (landscape only) |
| `name_style` | `pixel` | `pixel`, `block`, `shade` or `outline` (see above) |
| `name_deco` | `none` | `none`, `bars` or `columns` |
| `tagline` | your GitHub bio | Line under the name. `false` hides it |
| `clock` | `true` | Show the time the GIF was rendered, labeled LAST SYNC. `false` hides it |
| `timezone` | `UTC` | IANA timezone for the clock |
| `windows` | `24` | Windows visible in the queue |
| `hold` / `move` | `2200` / `1000` | Milliseconds the front window stays still / the queue takes to advance |
| `fps` | `15` | GIF frame rate |
| `scale` | `1` | `1` = 480×720, `2` = 960×1440 |
| `output` / `dark_output` | `samsara.gif` / `samsara-dark.gif` | File names. The dark one is for GitHub's dark theme; `dark_output: false` skips it |
| `push_to` | `samsara` | Branch for the GIFs. `false` leaves them in the workspace so you can commit them yourself |
| `token` | `github.token` | Token to read repos and push |

## Run it locally

Open `index.html` in a browser. There's no build step and no dependencies. Add `?clean=1`
to the URL to show only the animation.

To render the GIFs from the command line (needs Node 22+ and Chrome or Chromium):

```sh
node action/render.mjs --user octocat --fx atkinson --timezone Europe/Madrid
```

## How it works

Everything is drawn on a 480×720 canvas and then snapped to pure black and white. Fading
windows go through an 8×8 Bayer matrix, which is why they dissolve instead of turning
gray. Text is rasterized separately with a hard threshold so it stays crisp. The GIF
encoder is a small hand-written one: two colors, LZW, and only the rectangle that changed
between frames. The light and dark GIFs share every frame and differ only in the palette.

The action runs the same `index.html` in headless Chrome, so the GIF matches what you see
in the configurator.

## Credits

Inspired by 1-bit "Windows Warning" illustration art. Fonts: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P)
and [VT323](https://fonts.google.com/specimen/VT323), both under the SIL Open Font License (see `fonts/`).

## License

[MIT](LICENSE)

---

<p align="center">Made with ♥ by <a href="https://github.com/RchrdAriza">Richard Ariza</a></p>
