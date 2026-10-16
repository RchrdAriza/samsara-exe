/*
 * samsara.exe — render engine.
 *
 * Draws the repo queue onto a 480x720 canvas, turns everything into 1-bit
 * pixels and encodes animated GIFs. Shared by the configurator page and the
 * GitHub Action (which drives this same file in headless Chrome), so both
 * produce identical frames.
 *
 * Exposes a single global: window.Samsara
 */
(() => {
'use strict';

let W = 480, H = 720; // set by the layout
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const DEFAULTS = {
  windows: 24,       // windows visible in the queue
  hold: 2200,        // ms the front window stays still
  move: 1000,        // ms the queue takes to advance
  invert: false,     // preview colors only; GIF export always yields both variants
  forks: false,
  sort: 'pushed',    // pushed | stars | name
  max: 10,           // repos in the loop (0 = all)
  fps: 15,
  scale: 1,
  fx: 'halftone',
  palette: 'classic',
  dot: 7,
  tz: '',            // IANA timezone for the clock ('' = local)
  bg: true,          // draw the avatar / custom image in the circle
  clock: true,       // show the "last sync" time (when the frame/GIF was rendered)
  layout: 'portrait', // portrait (480x720) | landscape (960x540)
  photo: true,       // draw the circle at all
  queue: true,       // draw the repo queue
  name: true,        // draw the user's name (landscape only)
  nameText: '',      // custom name ('' = GitHub display name, else login)
  nameStyle: 'pixel', // pixel | block | shade | outline
  nameDeco: 'none',  // none | bars | columns
  tagline: '',       // line under the name ('' = GitHub bio, false = hidden)
};
const cfg = { ...DEFAULTS };

// Two-tone palettes: every pixel ends up as either ink or paper.
const PALETTES = {
  classic: { name: 'Classic', ink: '#000000', paper: '#ffffff' },
  gameboy: { name: 'Game Boy', ink: '#0f380f', paper: '#9bbc0f' },
  amber: { name: 'Amber CRT', ink: '#ffb000', paper: '#1c1000' },
  phosphor: { name: 'Phosphor', ink: '#41ff7a', paper: '#04170a' },
  cyanotype: { name: 'Cyanotype', ink: '#eaf2ff', paper: '#1d4e89' },
  sepia: { name: 'Sepia', ink: '#3b2716', paper: '#f0e2c4' },
  riso: { name: 'Riso', ink: '#e0453a', paper: '#f7f0e4' },
  vapor: { name: 'Vapor', ink: '#ff5fa8', paper: '#1d0b3d' },
  win95: { name: 'Windows 95', ink: '#ffffff', paper: '#008080' },
};
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const luma = ([r, g, b]) => (r * 299 + g * 587 + b * 114) / 1000;

// { ink: [r,g,b], paper: [r,g,b] } for the current palette, optionally swapped
function colors(invert = cfg.invert) {
  const p = PALETTES[cfg.palette];
  const ink = rgb(p.ink), paper = rgb(p.paper);
  return invert ? { ink: paper, paper: ink } : { ink, paper };
}
// the variant with the darker background, for GitHub's dark theme
function darkColors() {
  const c = colors(false);
  return luma(c.paper) < luma(c.ink) ? c : colors(true);
}

const EFFECTS = {
  halftone: 'Halftone',
  atkinson: 'Atkinson (Mac)',
  floyd: 'Floyd–Steinberg',
  bayer: 'Bayer',
  lines: 'Lines',
  cross: 'Crosshatch',
  ascii: 'ASCII',
  threshold: 'Threshold',
};

const DEMO = [
  ['dotfiles', 'Personal config for fish, neovim and friends.', 12, 1, 'Shell'],
  ['pixel-shrine', 'A 1-bit renderer with ordered dithering for canvas.', 87, 9, 'JavaScript'],
  ['exid-comeback', 'Are you sure you want continue?', 404, 42, 'TypeScript'],
  ['tiny-kv', 'Embedded key-value store in under 500 lines.', 31, 4, 'Rust'],
  ['weather-cli', 'The weather in your terminal, in ASCII.', 8, 0, 'Go'],
  ['homelab', 'Docker compose for my home server.', 3, 0, 'Dockerfile'],
  ['notes', '', 0, 0, 'Markdown'],
  ['gameboy-emu', 'A Game Boy emulator written to learn how it works.', 156, 17, 'C'],
].map(([name, desc, stars, forks, lang]) => ({ name, owner: 'demo', desc, stars, forks, lang, pushed: '' }));

let allRepos = DEMO;
let profileName = 'samsara.exe'; // GitHub display name (or login) of the loaded user
let profileBio = 'endless 1-bit queue';
let repos = DEMO;
let image = null;
let cv = null, ctx = null;

// ---------------------------------------------------------------------------
// Queue geometry: a curve (back/top -> left -> front/bottom) with gaps that
// grow towards the front, so the back of the queue reads as stacked stripes.
// ---------------------------------------------------------------------------
// Each layout has its own canvas size and scene coordinates. Portrait is the
// original scene; landscape squeezes the curve to fit 540px and adds the name
// on the right.
const LAYOUTS = {
  portrait: {
    w: 480, h: 720,
    P0: { x: 120, y: 30 }, P1: { x: -80, y: 182 }, P2: { x: 168, y: 404 },
    halo: { x: 292, y: 212, r: 150 },
    waterDx: 0, waterDy: 0,
    clock: { x: 30, y: 590 },
    nameBox: null,
  },
  landscape: {
    w: 960, h: 540,
    P0: { x: 120, y: 20 }, P1: { x: -80, y: 150 }, P2: { x: 168, y: 330 },
    halo: { x: 292, y: 190, r: 150 },
    waterDx: -50, waterDy: -132,
    clock: { x: 500, y: 400 },
    nameBox: { x: 465, y: 30, w: 480, h: 360 },
  },
};
let LY = LAYOUTS.portrait;

let P0, P1, P2, LUT, L, TAN_END, TAN_START;
const bez = t => {
  const a = (1 - t) ** 2, b = 2 * (1 - t) * t, c = t * t;
  return { x: a * P0.x + b * P1.x + c * P2.x, y: a * P0.y + b * P1.y + c * P2.y };
};
const norm = (x, y) => { const m = Math.hypot(x, y); return { x: x / m, y: y / m }; };
function buildCurve() {
  ({ P0, P1, P2 } = LY);
  LUT = [{ t: 0, d: 0 }];
  L = 0;
  for (let i = 1, prev = bez(0); i <= 400; i++) {
    const p = bez(i / 400);
    L += Math.hypot(p.x - prev.x, p.y - prev.y);
    LUT.push({ t: i / 400, d: L });
    prev = p;
  }
  TAN_END = norm(P2.x - P1.x, P2.y - P1.y);
  TAN_START = norm(P0.x - P1.x, P0.y - P1.y);
}

function atLen(d) {
  if (d <= 0) return { x: P0.x - TAN_START.x * d, y: P0.y - TAN_START.y * d };
  if (d >= L) return { x: P2.x + TAN_END.x * (d - L), y: P2.y + TAN_END.y * (d - L) };
  let lo = 0, hi = LUT.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (LUT[m].d < d) lo = m; else hi = m; }
  const a = LUT[lo], b = LUT[hi];
  return bez(a.t + (b.t - a.t) * ((d - a.d) / (b.d - a.d)));
}

// geometric spacing: the front gap is 4x the back gap
let R, G0, TITLED;
function layout() {
  const next = LAYOUTS[cfg.layout];
  if (next !== LY || !LUT) {
    LY = next;
    W = LY.w; H = LY.h;
    bits = new Uint8Array(W * H);
    if (cv) { cv.width = W; cv.height = H; }
    buildCurve();
  }
  const N = cfg.windows;
  R = Math.pow(1 / 4, 1 / (N - 2));
  G0 = L * (1 - R) / (1 - Math.pow(R, N - 1));
  TITLED = Math.log(18 / G0) / Math.log(R); // past this slot the title bars would overlap
}
const distFront = s => G0 * (1 - Math.pow(R, s)) / (1 - R); // also valid for s < 0

const FRONT_W = 256, BACK_W = 140;
function geom(s) {
  const d = distFront(s);
  const p = atLen(L - d);
  const w = d < 0 ? FRONT_W - d * 0.9 : FRONT_W - (FRONT_W - BACK_W) * Math.pow(Math.min(1, d / L), 0.85);
  return { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(w), h: Math.round(w * 0.72) };
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------
const FONT_TITLE = '8px "Press Start 2P"';
const FONT_BODY = '20px VT323';
const FONT_CLOCK = '32px "Press Start 2P"';

// Text is rasterized separately with a hard threshold (no antialiasing), so
// the dithering pass can't break the strokes. It only "dissolves" when the
// whole window fades.
const glyphCache = new Map();
function crispText(str, x, y) {
  const key = ctx.font + '|' + ctx.fillStyle + '|' + str;
  let g = glyphCache.get(key);
  if (!g) {
    if (glyphCache.size > 3000) glyphCache.clear();
    const size = parseInt(ctx.font, 10);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(ctx.measureText(str).width) + 4);
    c.height = Math.ceil(size * 1.6);
    const g2 = c.getContext('2d', { willReadFrequently: true });
    g2.font = ctx.font;
    g2.fillStyle = ctx.fillStyle;
    g2.fillText(str, 0, size);
    const img = g2.getImageData(0, 0, c.width, c.height), d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0;
    g2.putImageData(img, 0, 0);
    g = { c, base: size };
    glyphCache.set(key, g);
  }
  ctx.drawImage(g.c, Math.round(x), Math.round(y) - g.base);
}

function fitText(str, maxW) {
  if (ctx.measureText(str).width <= maxW) return str;
  while (str.length > 1 && ctx.measureText(str + '…').width > maxW) str = str.slice(0, -1);
  return str + '…';
}

function wrap(text, maxW, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const test = cur ? cur + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width <= maxW) { cur = test; continue; }
    if (cur) lines.push(cur);
    cur = words[i];
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const used = lines.join(' ').split(/\s+/).filter(Boolean).length;
  if (used < words.length || lines.some(l => ctx.measureText(l).width > maxW)) {
    const last = lines.length - 1;
    lines[last] = fitText(lines[last] + (used < words.length ? '…' : ''), maxW);
  }
  return lines;
}

function warnIcon(x, y) {
  ctx.lineWidth = 3;
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(x + 17, y + 1); ctx.lineTo(x + 33, y + 30); ctx.lineTo(x + 1, y + 30);
  ctx.closePath(); ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.fillRect(x + 15, y + 10, 4, 11);
  ctx.fillRect(x + 15, y + 23, 4, 4);
}

function button(x, y, w, h, label, pressed) {
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  if (pressed) { ctx.fillStyle = '#000'; ctx.fillRect(x + 2, y + 2, w - 4, h - 4); ctx.fillStyle = '#fff'; ctx.fillRect(x + 4, y + 4, w - 8, h - 8); }
  ctx.fillStyle = '#000';
  ctx.font = '20px VT323';
  const tw = ctx.measureText(label).width;
  const tx = Math.round(x + (w - tw) / 2) + (pressed ? 1 : 0);
  const ty = y + h - 6 + (pressed ? 1 : 0);
  crispText(label, tx, ty);
  ctx.fillRect(tx, ty + 2, Math.round(ctx.measureText(label[0]).width), 2); // underlined accelerator key
}

// Pixel icons for the stats line, so they don't depend on the system having
// a font with ★ / ⑂ (GitHub's runners don't have one for the fork glyph).
const STAR = [
  '.....#.....', '.....#.....', '....###....', '....###....', '###########', '.#########.',
  '..#######..', '...#####...', '..###.###..', '..##...##..', '.#.......#.',
];
const FORK = [
  '##......##', '##......##', '##......##', '.##....##.', '..##..##..', '...####...',
  '....##....', '....##....', '....##....', '...####...', '...####...',
];
function sprite(rows, x, y) {
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < rows[r].length; c++)
      if (rows[r][c] === '#') ctx.fillRect(x + c, y + r, 1, 1);
}

// Minimize / maximize / close boxes on the right of every title bar
const TITLE_GLYPHS = [
  ['.......', '.......', '.......', '.......', '.......', '#####..', '#####..'],
  ['#######', '#######', '#.....#', '#.....#', '#.....#', '#.....#', '#######'],
  ['##...##', '###.###', '.#####.', '..###..', '.#####.', '###.###', '##...##'],
];
const TITLE_BUTTONS_W = 3 * 11 + 2 * 2 + 4;
function titleButtons(x, y) {
  TITLE_GLYPHS.forEach((glyph, i) => {
    const bx = x + i * 13;
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx, y + 3, 11, 11);
    ctx.fillStyle = '#000';
    sprite(glyph, bx + 2, y + 5);
  });
}

// 1-bit cursor: '#' = black, 'o' = white outline
const CURSOR = [
  'o', 'oo', 'o#o', 'o##o', 'o###o', 'o####o', 'o#####o', 'o######o', 'o#######o',
  'o########o', 'o#####ooooo', 'o##o##o', 'o#o o##o', 'oo  o##o', 'o    o##o', '     o##o', '      oo',
];
function cursor(x, y) {
  for (let r = 0; r < CURSOR.length; r++) {
    for (let c = 0; c < CURSOR[r].length; c++) {
      const ch = CURSOR[r][c];
      if (ch === ' ') continue;
      ctx.fillStyle = ch === '#' ? '#000' : '#fff';
      ctx.fillRect(x + c * 2, y + r * 2, 2, 2);
    }
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const WATER = Array.from({ length: 46 }, () => {
  const y = 572 + Math.floor(rnd() * 84);
  const x0 = y > 600 ? 300 : 150;
  return { x: x0 + Math.floor(rnd() * (470 - x0)), y, w: 8 + Math.floor(rnd() * 46), h: rnd() < 0.3 ? 3 : 2 };
});

// ordered dithering threshold map (Bayer 8x8), scaled to 0..255
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map(v => (v + 0.5) * 4);

// The circle's image goes through the selected 1-bit effect. Computed once
// per image/effect/size combination and cached.
// image -> Map("fx|dot" -> canvas); small LRU so flipping between effects is instant
const haloCache = new Map();
function haloFor(img) {
  let byImg = haloCache.get(img);
  if (!byImg) {
    byImg = new Map();
    haloCache.set(img, byImg);
    if (haloCache.size > 4) haloCache.delete(haloCache.keys().next().value);
  }
  const key = cfg.fx + '|' + cfg.dot;
  let canvas = byImg.get(key);
  if (!canvas) {
    canvas = buildHalo(img);
    byImg.set(key, canvas);
    if (byImg.size > 32) byImg.delete(byImg.keys().next().value);
  }
  return canvas;
}

function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    const a = pass ? tmp : src, b = pass ? out : tmp;
    const lines = pass ? w : h, len = pass ? h : w;
    for (let j = 0; j < lines; j++) {
      let acc = 0, n = 0;
      const at = i => (pass ? i * w + j : j * w + i);
      for (let i = 0; i <= r && i < len; i++) { acc += a[at(i)]; n++; }
      for (let i = 0; i < len; i++) {
        b[at(i)] = acc / n;
        if (i + r + 1 < len) { acc += a[at(i + r + 1)]; n++; }
        if (i - r >= 0) { acc -= a[at(i - r)]; n--; }
      }
    }
  }
  return out;
}

function buildHalo(img) {
  const D = LY.halo.r * 2;
  const src = document.createElement('canvas');
  src.width = src.height = D;
  const s = src.getContext('2d', { willReadFrequently: true });
  if (img) {
    const k = Math.max(D / img.width, D / img.height);
    s.drawImage(img, (D - img.width * k) / 2, (D - img.height * k) / 2, img.width * k, img.height * k);
  } else {
    const g = s.createRadialGradient(D / 2, D / 2, 10, D / 2, D / 2, LY.halo.r);
    g.addColorStop(0, '#fff');
    g.addColorStop(1, '#bbb');
    s.fillStyle = g;
    s.fillRect(0, 0, D, D);
  }

  // tone 0 (black) .. 1 (white), auto-leveled between the 2nd and 98th
  // percentiles so very dark or very light avatars don't become a flat blob
  const px = s.getImageData(0, 0, D, D).data;
  const raw = new Uint8Array(D * D), hist = new Uint32Array(256);
  for (let p = 0; p < D * D; p++) {
    const i = p << 2;
    hist[(raw[p] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8)]++;
  }
  const pct = q => { let acc = 0; for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= q * D * D) return v; return 255; };
  const lo = pct(0.02), hi = Math.max(lo + 1, pct(0.98));
  const T = new Float32Array(D * D);
  for (let p = 0; p < D * D; p++) T[p] = 1 - Math.pow(1 - clamp((raw[p] - lo) / (hi - lo), 0, 1), 1.4) * 0.92;
  return applyEffect(T, D, D, false);
}

// Turns a tone map (0 = black .. 1 = white) into a 1-bit canvas with the
// selected effect. With `clear`, paper pixels are transparent.
function applyEffect(T, w, h, clear) {
  const size = cfg.dot, N = w * h;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const o = out.getContext('2d', { willReadFrequently: true });
  o.fillStyle = '#fff';
  o.fillRect(0, 0, w, h);
  o.fillStyle = '#000';
  const ink = new Uint8Array(N); // 1 = black
  const fx = cfg.fx;

  if (fx === 'halftone' || fx === 'ascii') {
    // "vector" effects: drawn first, then snapped to 1-bit
    const B = boxBlur(T, w, h, Math.floor(size / 2));
    const tone = (x, y) => B[clamp(Math.round(y), 0, h - 1) * w + clamp(Math.round(x), 0, w - 1)];
    if (fx === 'halftone') {
      const c = Math.SQRT1_2, ext = Math.max(w, h) * 0.75;
      for (let v = -ext; v <= ext; v += size) {
        for (let u = -ext; u <= ext; u += size) {
          const cx = w / 2 + (u - v) * c, cy = h / 2 + (u + v) * c;
          if (cx < -size || cy < -size || cx > w + size || cy > h + size) continue;
          const r = size * 0.5 * Math.SQRT2 * Math.sqrt(1 - tone(cx, cy)); // dots touch at full black
          if (r < 0.7) continue;
          o.beginPath();
          o.arc(cx, cy, r, 0, Math.PI * 2);
          o.fill();
        }
      }
    } else {
      const RAMP = ' .:-=+*#%@';
      const cw = Math.max(6, size + 1);
      o.font = `${cw}px "Press Start 2P"`;
      for (let y = 0; y < h; y += cw) {
        for (let x = 0; x < w; x += cw) {
          const dk = Math.min(1, (1 - tone(x + cw / 2, y + cw / 2)) * 1.35);
          const ci = Math.min(RAMP.length - 1, Math.floor(dk * RAMP.length));
          if (ci > 0) o.fillText(RAMP[ci], x, y + cw);
        }
      }
    }
    const d = o.getImageData(0, 0, w, h).data;
    for (let p = 0; p < N; p++) ink[p] = d[p << 2] < 128 ? 1 : 0;
  } else if (fx === 'lines' || fx === 'cross') {
    const B = boxBlur(T, w, h, Math.floor(size / 2));
    const m = a => ((a % size) + size) % size;
    for (let y = 0, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p++) {
        const dk = 1 - B[p];
        if (fx === 'lines') {
          // wavy lines whose thickness follows darkness (engraving style)
          const yy = y + Math.sin(x / 14) * size * 0.35;
          ink[p] = Math.abs(m(yy) - size / 2) < (dk * size) / 2 ? 1 : 0;
        } else {
          ink[p] = (dk > 0.12 && m(x + y) === 0) || (dk > 0.35 && m(x - y) === 0) ||
                   (dk > 0.6 && m(y) === 0) || (dk > 0.8 && m(x) === 0) || dk > 0.95 ? 1 : 0;
        }
      }
    }
  } else {
    // per-pixel effects on a reduced grid: bigger size = chunkier pixels
    const b = Math.max(1, Math.round(size / 4)), gw = Math.ceil(w / b), gh = Math.ceil(h / b);
    const G = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let sum = 0, n = 0;
        for (let y = gy * b; y < Math.min(h, gy * b + b); y++)
          for (let x = gx * b; x < Math.min(w, gx * b + b); x++) { sum += T[y * w + x]; n++; }
        G[gy * gw + gx] = sum / n;
      }
    }
    const diffuse = fx === 'floyd'
      ? [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]
      : [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];
    const Gi = new Uint8Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const i = gy * gw + gx, v = G[i];
        const on = fx === 'bayer' ? v * 255 <= BAYER[((gy & 7) << 3) | (gx & 7)] : v < 0.5;
        Gi[i] = on ? 1 : 0;
        if (fx === 'floyd' || fx === 'atkinson') {
          const err = v - (on ? 0 : 1);
          for (const [dx, dy, wt] of diffuse) {
            const nx = gx + dx, ny = gy + dy;
            if (nx >= 0 && nx < gw && ny < gh) G[ny * gw + nx] += err * wt;
          }
        }
      }
    }
    for (let y = 0, p = 0; y < h; y++)
      for (let x = 0; x < w; x++, p++) ink[p] = Gi[((y / b) | 0) * gw + ((x / b) | 0)];
  }

  const id = o.createImageData(w, h), d = id.data;
  for (let p = 0; p < N; p++) {
    const v = ink[p] ? 0 : 255, i = p << 2;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = clear && !ink[p] ? 0 : 255;
  }
  o.putImageData(id, 0, 0);
  return out;
}

// ---------------------------------------------------------------------------
// The name (landscape only): drawn in one of NAME_STYLES, with an optional
// decoration and a tagline (the GitHub bio by default), stacked and centered
// in LY.nameBox. Everything ends up as black ink on a transparent canvas.
// ---------------------------------------------------------------------------
const NAME_STYLES = { pixel: 'Pixel (uses the effect)', block: 'Block', shade: 'Shade', outline: 'Outline' };
const NAME_DECOS = { none: 'None', bars: 'Bars', columns: 'Columns' };
const nameCache = new Map();

// greedy word wrap; words only break when `breakWords` (else null if one doesn't fit)
function wrapWith(text, fits, breakWords) {
  const lines = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = cur ? cur + ' ' + word : word;
    if (fits(test)) { cur = test; continue; }
    if (cur) lines.push(cur);
    cur = '';
    if (!breakWords && !fits(word)) return null;
    for (const ch of word) {
      if (fits(cur + ch)) cur += ch;
      else { if (cur) lines.push(cur); cur = ch; }
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// first (largest) size, from `sizes`, whose wrap into at most 3 lines fits
function fitLines(text, sizes, widthOk, heightOk) {
  for (const breakWords of [false, true]) {
    for (const size of sizes) {
      const lines = wrapWith(text, t => widthOk(t, size), breakWords);
      if (lines && lines.length <= 3 && heightOk(lines.length, size)) return { lines, size };
    }
  }
  const size = sizes[sizes.length - 1];
  return { lines: wrapWith(text, t => widthOk(t, size), true).slice(0, 3), size };
}

// a canvas whose ink pixels are set with rect(); toCanvas() makes it black on transparent
function inkCanvas(w, h) {
  const ink = new Uint8Array(w * h);
  return {
    w, h, ink,
    rect(x, y, rw, rh, level = 1) {
      for (let j = Math.max(0, y); j < Math.min(h, y + rh); j++)
        for (let i = Math.max(0, x); i < Math.min(w, x + rw); i++)
          if (level >= 1 || BAYER[((j & 7) << 3) | (i & 7)] < level * 256) ink[j * w + i] = 1;
    },
    toCanvas() {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      const id = g.createImageData(w, h);
      for (let p = 0; p < w * h; p++) if (ink[p]) id.data[(p << 2) + 3] = 255;
      g.putImageData(id, 0, 0);
      return c;
    },
  };
}

// Pixel style: the name in Press Start 2P, through the active effect.
function pixelName(text, maxW, maxH) {
  const c = document.createElement('canvas');
  const m = c.getContext('2d', { willReadFrequently: true });
  const LH = 1.35, font = size => `${size}px "Press Start 2P"`;
  const sizes = [];
  for (let sz = 96; sz >= 24; sz -= 4) sizes.push(sz);
  const pick = fitLines(text, sizes,
    (t, sz) => { m.font = font(sz); return m.measureText(t).width <= maxW; },
    (n, sz) => n * sz * LH <= maxH);
  const w = maxW, h = Math.ceil(pick.lines.length * pick.size * LH);
  c.width = w; c.height = h;
  m.fillStyle = '#fff';
  m.fillRect(0, 0, w, h);
  m.fillStyle = '#000';
  m.font = font(pick.size);
  pick.lines.forEach((l, i) => {
    const x = Math.round((w - m.measureText(l).width) / 2);
    m.fillText(l, x, Math.round(i * pick.size * LH + pick.size * 1.1));
  });
  const px = m.getImageData(0, 0, w, h).data, N = w * h;
  const T = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const i = p << 2;
    T[p] = ((px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8) / 255;
  }
  return applyEffect(T, w, h, true);
}

// 1-bit rows of a line of text, sampled from Press Start 2P (an 8x8 pixel font)
// at 2x so every glyph pixel lands on a whole cell.
let glyphRows = null; // [top, bottom) rows that any glyph uses, incl. accents and descenders
function glyphBits(text) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  const FONT = '16px "Press Start 2P"';
  g.font = FONT;
  const w = Math.max(1, Math.ceil(g.measureText(text).width / 2));
  c.width = w * 2; c.height = 40;
  g.font = FONT;
  g.fillText(text, 0, 24);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const on = new Uint8Array(w * 20);
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < w; x++) on[y * w + x] = d[((y * 2 + 1) * c.width + x * 2 + 1) * 4 + 3] >= 128 ? 1 : 0;
  return { w, on };
}
function rowRange() {
  if (!glyphRows) {
    const { w, on } = glyphBits('ÁÉÑgjpqy|');
    let top = 20, bottom = 0;
    for (let y = 0; y < 20; y++) for (let x = 0; x < w; x++) if (on[y * w + x]) { top = Math.min(top, y); bottom = y + 1; }
    glyphRows = [top, Math.max(top + 1, bottom)];
  }
  return glyphRows;
}

// Block styles: every glyph pixel becomes a k×k cell. `block` and `shade` add a
// drop shadow drawn as a double line (like ANSI Shadow's ═║╗╚), `outline` keeps
// only the double-line contour.
function blockName(text, maxW, maxH, style) {
  const [top, bottom] = rowRange(), gh = bottom - top;
  const cellsW = t => glyphBits(t).w + 1, cellsH = n => n * gh + (n - 1) * 2 + 1;
  const sizes = [];
  for (let k = 12; k >= 2; k--) sizes.push(k);
  const { lines, size: k } = fitLines(text, sizes, (t, k) => cellsW(t) * k <= maxW, (n, k) => cellsH(n) * k <= maxH);

  // mask of the whole name, lines centered
  const bits = lines.map(glyphBits);
  const mw = Math.max(...bits.map(b => b.w)) + 1, mh = cellsH(lines.length);
  const M = new Uint8Array(mw * mh);
  bits.forEach((b, li) => {
    const ox = Math.floor((mw - 1 - b.w) / 2), oy = li * (gh + 2);
    for (let y = 0; y < gh; y++) for (let x = 0; x < b.w; x++) if (b.on[(y + top) * b.w + x]) M[(oy + y) * mw + ox + x] = 1;
  });
  const inM = (x, y) => x >= 0 && y >= 0 && x < mw && y < mh && M[y * mw + x] === 1;
  const inS = (x, y) => inM(x - 1, y - 1);

  const out = inkCanvas(mw * k, mh * k), t = Math.max(1, Math.round(k / 6));
  // double line along the edges of `cell` that border cells outside `inside`
  const contour = (x, y, inside) => {
    const X = x * k, Y = y * k;
    if (!inside(x, y - 1)) { out.rect(X, Y, k, t); out.rect(X, Y + 2 * t, k, t); }
    if (!inside(x, y + 1)) { out.rect(X, Y + k - t, k, t); out.rect(X, Y + k - 3 * t, k, t); }
    if (!inside(x - 1, y)) { out.rect(X, Y, t, k); out.rect(X + 2 * t, Y, t, k); }
    if (!inside(x + 1, y)) { out.rect(X + k - t, Y, t, k); out.rect(X + k - 3 * t, Y, t, k); }
  };
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      if (style === 'outline') {
        if (inM(x, y)) contour(x, y, inM);
        continue;
      }
      if (inM(x, y)) {
        // shade: light at the top of each glyph row, solid at the bottom
        const row = y % (gh + 2);
        const level = style === 'shade' ? 0.3 + 0.75 * (row / Math.max(1, gh - 1)) : 1;
        out.rect(x * k, y * k, k, k, level);
      } else if (inS(x, y)) {
        contour(x, y, (cx, cy) => inS(cx, cy) || inM(cx, cy));
      }
    }
  }
  return out.toCanvas();
}

// Tagline in VT323, thresholded so it stays crisp. Up to 2 lines.
function taglineCanvas(text, maxW, spaced) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  const FONT = '24px VT323', LH = 24;
  g.font = FONT;
  const fits = s => g.measureText(s).width <= maxW;
  const wide = text.split('').join(' ');
  let lines;
  if (spaced && fits(wide)) lines = [wide];
  else if (!spaced && fits(`── ${text} ──`)) lines = [`── ${text} ──`];
  else {
    lines = wrapWith(text, fits, true);
    if (lines.length > 2) {
      lines = lines.slice(0, 2);
      let last = lines[1];
      while (last.length > 1 && !fits(last + '…')) last = last.slice(0, -1);
      lines[1] = last + '…';
    }
  }
  c.width = maxW; c.height = lines.length * LH + 6;
  g.font = FONT;
  lines.forEach((l, i) => g.fillText(l, Math.round((maxW - g.measureText(l).width) / 2), (i + 1) * LH - 4));
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
  for (let i = 3; i < d.length; i += 4) { d[i] = d[i] >= 110 ? 255 : 0; d[i - 3] = d[i - 2] = d[i - 1] = 0; }
  g.putImageData(id, 0, 0);
  return c;
}

// ░▒▓████▓▒░ across the box
function barCanvas(w) {
  const h = 8, out = inkCanvas(w, h), seg = 12;
  [0.25, 0.5, 0.75].forEach((lv, i) => {
    out.rect(i * seg, 0, seg, h, lv);
    out.rect(w - (i + 1) * seg, 0, seg, h, lv);
  });
  out.rect(3 * seg, 0, w - 6 * seg, h);
  return out.toCanvas();
}

// a "( )" of shaded cells on each side, as tall as the name
function columnsCanvas(w, h) {
  const out = inkCanvas(w, h), ck = 8, n = Math.max(3, Math.floor(h / ck));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, bulge = Math.sin(Math.PI * t);
    const dx = Math.round(bulge * 2) * ck, lv = 0.3 + 0.7 * bulge;
    const y = Math.round(i * h / n);
    out.rect(2 * ck - dx + ck, y, 2 * ck, ck - 1, lv);              // left
    out.rect(w - 4 * ck + dx - ck, y, 2 * ck, ck - 1, lv);          // right
  }
  return out.toCanvas();
}

function buildName(text, tagline, box) {
  const style = cfg.nameStyle, deco = cfg.nameDeco;
  const GAP = 18, SIDE = deco === 'columns' ? 64 : 0;
  const tag = tagline ? taglineCanvas(tagline, box.w, style === 'shade') : null;
  const bar = deco === 'bars' ? barCanvas(box.w) : null;
  const reserved = (tag ? tag.height + GAP : 0) + (bar ? 2 * (bar.height + GAP) : 0);
  const maxW = box.w - 2 * SIDE, maxH = Math.max(40, box.h - reserved);
  const name = style === 'pixel' ? pixelName(text, maxW, maxH) : blockName(text, maxW, maxH, style);

  const parts = [bar, name, tag, bar].filter(Boolean);
  const total = parts.reduce((a, c) => a + c.height, 0) + GAP * (parts.length - 1);
  const c = document.createElement('canvas');
  c.width = box.w; c.height = box.h;
  const g = c.getContext('2d');
  let y = Math.max(0, Math.round((box.h - total) / 2));
  for (const part of parts) {
    g.drawImage(part, Math.round((box.w - part.width) / 2), y);
    if (part === name && deco === 'columns') {
      const cols = columnsCanvas(name.width + 2 * SIDE, name.height);
      g.drawImage(cols, Math.round((box.w - cols.width) / 2), y);
    }
    y += part.height + GAP;
  }
  return c;
}

function nameFor(text, tagline, box) {
  const key = [text, tagline, cfg.nameStyle, cfg.nameDeco, cfg.fx, cfg.dot, box.w, box.h].join('|');
  let canvas = nameCache.get(key);
  if (!canvas) {
    canvas = buildName(text, tagline, box);
    nameCache.set(key, canvas);
    if (nameCache.size > 32) nameCache.delete(nameCache.keys().next().value);
  }
  return canvas;
}

const displayName = () => (cfg.nameText || profileName).trim();
const displayTagline = () => (cfg.tagline === false ? '' : (cfg.tagline || profileBio).replace(/\s+/g, ' ').trim());

function drawName() {
  const box = LY.nameBox, text = displayName();
  if (!box || !cfg.name || !text) return;
  ctx.drawImage(nameFor(text, displayTagline(), box), box.x, box.y);
}

function drawBackground() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  if (cfg.photo) {
    const img = image && cfg.bg ? image : null, HALO = LY.halo;
    ctx.save();
    ctx.beginPath();
    ctx.arc(HALO.x, HALO.y, HALO.r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(haloFor(img), HALO.x - HALO.r, HALO.y - HALO.r);
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.arc(HALO.x, HALO.y, HALO.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // the "water" is where the queue lands; without the queue it floats
  if (cfg.queue) {
    ctx.fillStyle = '#000';
    for (const s of WATER) ctx.fillRect(s.x + LY.waterDx, s.y + LY.waterDy, s.w, s.h);
  }
}

function drawWindow(repo, s, alpha, ph) {
  const { x, y, w, h } = geom(s);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);

  // the body only shows up once the window reaches the front
  const bodyA = clamp(1 - s, 0, 1);
  const pressed = ph >= cfg.hold * 0.68 && ph < cfg.hold * 0.8;
  if (bodyA > 0) {
    ctx.save();
    ctx.globalAlpha = alpha * bodyA;
    ctx.beginPath();
    ctx.rect(x + 2, y + 17, w - 4, h - 19);
    ctx.clip();
    warnIcon(x + 12, y + 30);

    ctx.fillStyle = '#000';
    const head = repo.name.toUpperCase().replace(/[-.]/g, '_');
    let fs = 32;
    ctx.font = `${fs}px VT323`;
    while (ctx.measureText(head).width > w - 64 && fs > 22) ctx.font = `${(fs -= 2)}px VT323`;
    crispText(fitText(head, w - 64), x + 54, y + 46);

    ctx.font = FONT_BODY;
    const lines = wrap(repo.desc || 'Are you sure you want continue?', w - 64, 3);
    lines.forEach((l, i) => crispText(l, x + 54, y + 70 + i * 17));
    let mx = x + 54;
    const my = y + 126, mEnd = x + w - 10;
    for (const [icon, n] of [[STAR, repo.stars], [FORK, repo.forks]]) {
      sprite(icon, mx, my - 11);
      crispText(String(n), mx + 15, my);
      mx += 15 + Math.ceil(ctx.measureText(String(n)).width) + 12;
    }
    if (repo.lang && mx < mEnd - 16) crispText(fitText(repo.lang, mEnd - mx), mx, my);

    button(x + 28, y + h - 36, 76, 24, 'YES', pressed);
    button(x + w - 104, y + h - 36, 76, 24, 'NO', false);
    ctx.restore();
  }

  const titleA = clamp(TITLED - s, 0, 1);
  if (titleA > 0) {
    ctx.globalAlpha = alpha * titleA;
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, 17);
    ctx.fillStyle = '#fff';
    ctx.font = FONT_TITLE;
    crispText(fitText(repo.name + (s < 0.5 ? '' : '!!!'), w - 14 - TITLE_BUTTONS_W), x + 6, y + 12);
    titleButtons(x + w - TITLE_BUTTONS_W, y);
  }

  // cursor: glides in, clicks YES, and leaves with the window
  if (ph >= 0) {
    const tx = x + 28 + 50, ty = y + h - 36 + 14;
    const k = ease(clamp((ph - cfg.hold * 0.1) / (cfg.hold * 0.5), 0, 1));
    const sx = x + w + 40, sy = y + h + 60;
    cursor(Math.round(sx + (tx - sx) * k) + (pressed ? 1 : 0), Math.round(sy + (ty - sy) * k) + (pressed ? 1 : 0));
  }
  ctx.restore();
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
let clockFmt = null;
function drawClock(now) {
  if (!cfg.clock) return;
  // A GIF freezes the time it was rendered, so label it as such
  ctx.font = FONT_BODY;
  const { x, y } = LY.clock;
  const lw = Math.ceil(ctx.measureText('LAST SYNC').width);
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, lw + 10, 18);
  ctx.fillStyle = '#fff';
  crispText('LAST SYNC', x + 5, y + 14);
  const p = Object.fromEntries(clockFmt.formatToParts(now).map(x => [x.type, x.value]));
  const h24 = +p.hour % 24;
  ctx.fillStyle = '#000';
  ctx.font = FONT_CLOCK;
  crispText(`${h24 < 12 ? 'AM' : 'PM'} ${h24 % 12 || 12}:${p.minute}`, x, y + 58);
  crispText(`${MONTHS[+p.month - 1]}.${p.day} ${p.year}`, x, y + 108);
}

// Everything gray (window fades, gradients) becomes a 1-bit Bayer pattern,
// which is what makes the fade read as a "dissolve".
let bits = new Uint8Array(W * H); // 1 = ink
function dither() {
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const { ink, paper } = colors();
  for (let y = 0, p = 0; y < H; y++) {
    const row = (y & 7) << 3;
    for (let x = 0; x < W; x++, p++) {
      const i = p << 2;
      const lum = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      const on = lum <= BAYER[row | (x & 7)];
      const c = on ? ink : paper;
      bits[p] = on ? 1 : 0;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const cycleMs = () => cfg.hold + cfg.move;

function render(t, now = new Date()) {
  const CYCLE = cycleMs();
  const c = Math.floor(t / CYCLE), ph = t - c * CYCLE;
  const e = ph < cfg.hold ? 0 : ease((ph - cfg.hold) / cfg.move);
  const n = repos.length, N = cfg.windows;
  drawBackground();
  drawName();
  for (let k = cfg.queue ? N : -1; k >= 0; k--) {
    const s = k - e;
    let a = 1;
    if (s > N - 1) a = N - s;                  // enters at the back of the queue
    if (s < 0) a = 1 - clamp(-s * 1.15, 0, 1); // approaches and dissolves
    if (a <= 0) continue;
    drawWindow(repos[(c + k) % n], s, a, k === 0 ? ph : -1);
  }
  drawClock(now);
  dither();
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
function applyRepoFilters() {
  let list = allRepos.filter(r => cfg.forks || !r.fork);
  if (!list.length) list = allRepos;
  if (cfg.sort === 'stars') list = [...list].sort((a, b) => b.stars - a.stars);
  else if (cfg.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  else list = [...list].sort((a, b) => (b.pushed || '').localeCompare(a.pushed || ''));
  repos = cfg.max > 0 ? list.slice(0, cfg.max) : list;
}

function set(patch) {
  const num = (v, lo, hi, d) => (v === '' || v == null || isNaN(+v) ? d : clamp(Math.round(+v), lo, hi));
  const bool = v => v === true || v === 'true' || v === '1';
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    switch (k) {
      case 'windows': cfg.windows = num(v, 4, 48, DEFAULTS.windows); break;
      case 'hold': cfg.hold = num(v, 300, 20000, DEFAULTS.hold); break;
      case 'move': cfg.move = num(v, 200, 10000, DEFAULTS.move); break;
      case 'fps': cfg.fps = num(v, 5, 50, DEFAULTS.fps); break;
      case 'scale': cfg.scale = num(v, 1, 4, DEFAULTS.scale); break;
      case 'max': cfg.max = num(v, 0, 500, DEFAULTS.max); break;
      case 'dot': cfg.dot = num(v, 3, 16, DEFAULTS.dot); break;
      case 'invert': case 'forks': case 'bg': case 'clock':
      case 'photo': case 'queue': case 'name': cfg[k] = bool(v); break;
      case 'layout': cfg.layout = LAYOUTS[v] ? v : DEFAULTS.layout; break;
      case 'nameText': cfg.nameText = String(v).trim().slice(0, 60); break;
      case 'nameStyle': cfg.nameStyle = NAME_STYLES[v] ? v : DEFAULTS.nameStyle; break;
      case 'nameDeco': cfg.nameDeco = NAME_DECOS[v] ? v : DEFAULTS.nameDeco; break;
      case 'tagline': cfg.tagline = v === false || v === 'false' ? false : String(v).trim().slice(0, 120); break;
      case 'sort': cfg.sort = ['pushed', 'stars', 'name'].includes(v) ? v : DEFAULTS.sort; break;
      case 'fx': cfg.fx = EFFECTS[v] ? v : DEFAULTS.fx; break;
      case 'palette': cfg.palette = PALETTES[v] ? v : DEFAULTS.palette; break;
      case 'tz': cfg.tz = v || ''; break;
    }
  }
  try {
    clockFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: cfg.tz || undefined, hourCycle: 'h23',
      hour: '2-digit', minute: '2-digit', year: 'numeric', month: 'numeric', day: '2-digit',
    });
  } catch {
    console.warn(`samsara.exe: unknown timezone "${cfg.tz}", falling back to UTC`);
    cfg.tz = 'UTC';
    return set({});
  }
  layout();
  applyRepoFilters();
}

// ---------------------------------------------------------------------------
// GitHub data
// ---------------------------------------------------------------------------
async function gh(path, token) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch('https://api.github.com' + path, { headers });
  if (r.status === 403 || r.status === 429) throw new Error('GitHub API rate limit reached (60 requests/hour without a token). Try again later.');
  if (r.status === 404) throw new Error(`Not found on GitHub: ${path.replace(/^\/(users|repos)\//, '').replace(/\/repos.*$/, '')}`);
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  return r.json();
}
const toRepo = r => ({
  name: r.name, owner: r.owner.login, desc: r.description || '',
  stars: r.stargazers_count, forks: r.forks_count, lang: r.language || '',
  fork: r.fork, pushed: r.pushed_at || '',
});

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Could not load image: ' + src.slice(0, 80)));
    img.src = src;
  });
}

// query: "user" or "owner/repo, owner/repo". Returns the repo count.
async function load(query, { token = '', image: customImage = '' } = {}) {
  query = (query || '').trim();
  let list, avatar = '';
  if (!query) {
    list = DEMO;
    profileName = 'samsara.exe';
    profileBio = 'endless 1-bit queue';
  } else if (query.includes('/')) {
    const names = query.split(/[\s,]+/).filter(Boolean)
      .map(s => s.replace(/^https?:\/\/github\.com\//, '').replace(/(\.git)?\/?$/, ''));
    const res = await Promise.all(names.map(n => gh('/repos/' + n, token)));
    list = res.map(toRepo);
    avatar = res[0].owner.avatar_url;
    profileName = res[0].owner.login;
    profileBio = '';
  } else {
    // the display name is only decoration: if it fails, fall back to the login
    const profile = gh(`/users/${encodeURIComponent(query)}`, token).catch(() => null);
    let all = [];
    for (let page = 1; page <= 5; page++) {
      const r = await gh(`/users/${encodeURIComponent(query)}/repos?per_page=100&page=${page}&sort=pushed&type=owner`, token);
      all = all.concat(r);
      if (r.length < 100) break;
    }
    if (!all.length) throw new Error(`${query} has no public repos.`);
    list = all.map(toRepo);
    avatar = all[0].owner.avatar_url;
    const prof = await profile;
    profileName = prof?.name || all[0].owner.login;
    profileBio = prof?.bio || '';
  }
  allRepos = list;
  applyRepoFilters();
  image = null;
  const src = customImage || (avatar && avatar + (avatar.includes('?') ? '&' : '?') + 's=400');
  if (src) {
    try { image = await loadImage(src); } catch (err) { if (customImage) throw err; }
  }
  return repos.length;
}

function setImage(img) { image = img; }

// ---------------------------------------------------------------------------
// GIF export: tiny 1-bit encoder (LZW + only the rectangle that changed;
// identical frames just extend the previous frame's delay)
// ---------------------------------------------------------------------------
function lzw(px, out) {
  const MIN = 2, CLEAR = 4, EOI = 5;
  let size = MIN + 1, next = EOI + 1, dict = new Map();
  let cur = 0, nbits = 0;
  const bytes = [];
  const emit = code => {
    cur |= code << nbits; nbits += size;
    while (nbits >= 8) { bytes.push(cur & 255); cur >>>= 8; nbits -= 8; }
  };
  emit(CLEAR);
  let prefix = px[0];
  for (let i = 1; i < px.length; i++) {
    const k = px[i], key = (prefix << 2) | k;
    const v = dict.get(key);
    if (v !== undefined) { prefix = v; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(CLEAR);
      size = MIN + 1; next = EOI + 1; dict = new Map();
    } else {
      if (next >= 1 << size) size++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(EOI);
  if (nbits > 0) bytes.push(cur & 255);
  out.push(MIN);
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
}

class Gif1Bit {
  constructor(w, h) {
    this.w = w; this.h = h; this.parts = []; this.prev = null; this.pending = null;
  }
  // the palette lives only in the header, so every color variant shares the frames.
  // 4 entries: paper, ink, and index 2 used as "transparent = unchanged pixel".
  header({ ink, paper }) {
    const { w, h } = this;
    return new Uint8Array([
      ...'GIF89a'.split('').map(c => c.charCodeAt(0)),
      w & 255, w >> 8, h & 255, h >> 8, 0x81, 0, 0,
      ...paper, ...ink, ...paper, ...paper,
      0x21, 0xff, 11, ...'NETSCAPE2.0'.split('').map(c => c.charCodeAt(0)), 3, 1, 0, 0, 0,
    ]);
  }
  add(px, tMs) {
    const { w, h, prev } = this;
    let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    if (prev) {
      x0 = w; y0 = h; x1 = -1; y1 = -1;
      for (let y = 0, p = 0; y < h; y++) {
        for (let x = 0; x < w; x++, p++) {
          if (px[p] !== prev[p]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            y1 = y;
          }
        }
      }
      if (x1 < 0) return; // identical frame
    }
    this.flush(tMs);
    const fw = x1 - x0 + 1, fh = y1 - y0 + 1, sub = new Uint8Array(fw * fh);
    for (let y = 0; y < fh; y++) sub.set(px.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + fw), y * fw);
    // same rectangle with unchanged pixels marked transparent (index 2): long
    // runs of "unchanged" compress far better than the pixels themselves
    let tsub = null;
    if (prev) {
      tsub = new Uint8Array(fw * fh);
      for (let y = 0, i = 0; y < fh; y++)
        for (let x = 0, p = (y0 + y) * w + x0; x < fw; x++, i++, p++) tsub[i] = px[p] === prev[p] ? 2 : px[p];
    }
    this.pending = { x0, y0, fw, fh, sub, tsub, t: tMs };
    this.prev = px.slice();
  }
  flush(tMs) {
    const f = this.pending;
    if (!f) return;
    const delay = Math.max(2, Math.round(tMs / 10) - Math.round(f.t / 10));
    // encode both ways and keep the smaller one, so this can never grow the file
    let data = [];
    lzw(f.sub, data);
    let transparent = false;
    if (f.tsub) {
      const alt = [];
      lzw(f.tsub, alt);
      if (alt.length < data.length) { data = alt; transparent = true; }
    }
    const out = [
      0x21, 0xf9, 4, transparent ? 0x05 : 0x04, delay & 255, delay >> 8, transparent ? 2 : 0, 0,
      0x2c, f.x0 & 255, f.x0 >> 8, f.y0 & 255, f.y0 >> 8, f.fw & 255, f.fw >> 8, f.fh & 255, f.fh >> 8, 0,
    ];
    const frame = new Uint8Array(out.length + data.length);
    frame.set(out);
    frame.set(data, out.length);
    this.parts.push(frame);
    this.pending = null;
  }
  finish(tMs) {
    this.flush(tMs);
    const tail = new Uint8Array([0x3b]);
    return {
      light: new Blob([this.header(colors(false)), ...this.parts, tail], { type: 'image/gif' }),
      dark: new Blob([this.header(darkColors()), ...this.parts, tail], { type: 'image/gif' }),
      shown: new Blob([this.header(colors()), ...this.parts, tail], { type: 'image/gif' }),
    };
  }
}

const state = { busy: false };

// Renders one full loop (every repo passes through the front once) so the
// GIF repeats seamlessly. Returns { light, dark, frames, repos, ms }.
async function encodeGif({ onProgress, now = new Date() } = {}) {
  state.busy = true;
  try {
    const sc = cfg.scale, gw = W * sc, gh_ = H * sc;
    const gif = new Gif1Bit(gw, gh_);
    // without the queue nothing moves, so a single frame is the whole loop
    const dt = 1000 / cfg.fps, total = cfg.queue ? repos.length * cycleMs() : dt;
    const scaled = sc === 1 ? null : new Uint8Array(gw * gh_);
    let f = 0;
    for (let t = 0; t < total - 0.001; t += dt, f++) {
      render(t, now);
      let px = bits;
      if (scaled) {
        for (let y = 0; y < gh_; y++) {
          const src = ((y / sc) | 0) * W;
          for (let x = 0; x < gw; x++) scaled[y * gw + x] = bits[src + ((x / sc) | 0)];
        }
        px = scaled;
      }
      gif.add(px, t);
      if (f % 8 === 0) {
        onProgress?.(t / total);
        await new Promise(r => setTimeout(r));
      }
    }
    onProgress?.(1);
    return { ...gif.finish(total), frames: f, repos: repos.length, ms: total };
  } finally {
    state.busy = false;
  }
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

// Entry point for the GitHub Action (called through the DevTools protocol).
async function exportForAction(opts) {
  set(opts);
  const query = opts.repos || opts.user;
  if (!query) throw new Error('Set either `user` or `repos`.');
  await load(query, { token: opts.token, image: opts.image });
  let last = -1;
  const out = await encodeGif({
    onProgress: p => {
      const pct = Math.floor(p * 10) * 10;
      if (pct !== last) { last = pct; console.log(`samsara.exe: encoding ${pct}%`); }
    },
  });
  return {
    light: await blobToBase64(out.light),
    dark: await blobToBase64(out.dark),
    info: { frames: out.frames, repos: out.repos, seconds: out.ms / 1000, names: repos.map(r => r.name) },
  };
}

function mount(canvas) {
  cv = canvas;
  cv.width = W; cv.height = H;
  ctx = cv.getContext('2d', { willReadFrequently: true });
}

const fontsReady = () => Promise.all([FONT_TITLE, FONT_BODY, FONT_CLOCK].map(f => document.fonts.load(f)));

set({});

window.Samsara = {
  get W() { return W; }, get H() { return H; }, DEFAULTS, EFFECTS, NAME_STYLES, NAME_DECOS, PALETTES, TITLE_GLYPHS, cfg, state, colors,
  mount, set, load, setImage, loadImage, render, encodeGif, exportForAction, fontsReady,
  cycleMs, repoCount: () => repos.length,
};
})();
