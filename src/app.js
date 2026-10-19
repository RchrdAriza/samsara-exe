/*
 * samsara.exe — configurator page: live preview, controls, GIF download and
 * the workflow / README snippets. With ?headless=1 it only exposes the engine
 * for the GitHub Action; with ?clean=1 it shows just the animation.
 */
(() => {
'use strict';

const S = window.Samsara;
const ACTION = 'RchrdAriza/samsara-exe@v1';
const OUTPUT_BRANCH = 'samsara';
const P = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);

const cv = $('c');
S.mount(cv);

if (P.get('headless') === '1') {
  window.samsaraReady = S.fontsReady();
  return;
}

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
S.set({
  fx: P.get('fx') ?? undefined,
  palette: P.get('palette') ?? undefined,
  dot: P.get('dot') ?? undefined,
  sort: P.get('sort') ?? undefined,
  max: P.get('max') ?? undefined,
  forks: P.get('forks') ?? undefined,
  windows: P.get('windows') ?? undefined,
  hold: P.get('hold') ?? undefined,
  move: P.get('move') ?? undefined,
  fps: P.get('fps') ?? undefined,
  scale: P.get('scale') ?? undefined,
  bg: P.get('bg') === 'none' ? false : undefined,
  clock: P.get('clock') ?? undefined,
  layout: P.get('layout') ?? undefined,
  photo: P.get('photo') ?? undefined,
  queue: P.get('queue') ?? undefined,
  name: P.get('name') ?? undefined,
  nameText: P.get('name_text') ?? undefined,
  nameStyle: P.get('name_style') ?? undefined,
  nameDeco: P.get('name_deco') ?? undefined,
  tagline: P.get('tagline') ?? undefined,
  tz: P.get('tz') || localTz,
  invert: P.has('invert') ? P.get('invert') : matchMedia('(prefers-color-scheme: dark)').matches,
});
const cfg = S.cfg;

if (P.get('clean') === '1') document.body.classList.add('clean');

// ---------------------------------------------------------------------------
// Canvas sizing: integer scale when there's room, otherwise fit
// ---------------------------------------------------------------------------
function fitCanvas() {
  const stage = $('stage');
  const full = document.body.classList.contains('clean') || document.body.classList.contains('max');
  const narrow = matchMedia('(max-width: 900px)').matches && !full;
  const availW = stage.clientWidth - 32;
  const availH = narrow ? innerHeight * 0.8 : stage.clientHeight - 32;
  let s = Math.min(availW / S.W, availH / S.H);
  if (s >= 2) s = Math.floor(s);
  cv.style.width = Math.floor(S.W * s) + 'px';
  cv.style.height = Math.floor(S.H * s) + 'px';
}
addEventListener('resize', fitCanvas);

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const say = msg => ($('status').textContent = msg);
const qEl = $('q'), fxEl = $('fx'), dotEl = $('dot');
for (const [k, label] of Object.entries(S.EFFECTS)) fxEl.add(new Option(label, k));
for (const [k, label] of Object.entries(S.NAME_STYLES)) $('nameStyle').add(new Option(label, k));
for (const [k, label] of Object.entries(S.NAME_DECOS)) $('nameDeco').add(new Option(label, k));
const palEl = $('palette');
for (const [k, p] of Object.entries(S.PALETTES)) palEl.add(new Option(p.name, k));

function syncControls() {
  fxEl.value = cfg.fx;
  dotEl.value = cfg.dot;
  $('dotVal').textContent = cfg.dot;
  $('sort').value = cfg.sort;
  $('max').value = cfg.max;
  $('tz').value = cfg.tz;
  $('forks').checked = cfg.forks;
  $('clock').checked = cfg.clock;
  $('invert').checked = cfg.invert;
  $('layout').value = cfg.layout;
  $('photo').checked = cfg.photo;
  $('queue').checked = cfg.queue;
  $('name').checked = cfg.name;
  $('nameText').value = cfg.nameText;
  $('nameStyle').value = cfg.nameStyle;
  $('nameDeco').value = cfg.nameDeco;
  $('showTagline').checked = cfg.tagline !== false;
  $('tagline').value = cfg.tagline || '';
  // the name only exists in landscape; the repo options only matter with the queue
  const land = cfg.layout === 'landscape';
  document.querySelectorAll('.land').forEach(el => el.classList.toggle('hidden', !land));
  for (const id of ['nameText', 'nameStyle', 'nameDeco', 'showTagline']) $(id).disabled = !cfg.name;
  $('tagline').disabled = !cfg.name || cfg.tagline === false;
  for (const id of ['sort', 'max', 'forks']) $(id).disabled = !cfg.queue;
  palEl.value = cfg.palette;
  // the page wears the same two colors as the animation
  const { ink, paper } = S.colors();
  const css = c => `rgb(${c.join(',')})`;
  document.documentElement.style.setProperty('--ink', css(ink));
  document.documentElement.style.setProperty('--paper', css(paper));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', css(paper));
}

function syncURL() {
  const url = new URL(location.href);
  const put = (k, v, def) => (v === def || v === '' ? url.searchParams.delete(k) : url.searchParams.set(k, v));
  const q = qEl.value.trim();
  url.searchParams.delete('user');
  url.searchParams.delete('repos');
  if (q) url.searchParams.set(q.includes('/') ? 'repos' : 'user', q);
  put('fx', cfg.fx, S.DEFAULTS.fx);
  put('palette', cfg.palette, S.DEFAULTS.palette);
  put('dot', String(cfg.dot), String(S.DEFAULTS.dot));
  put('sort', cfg.sort, S.DEFAULTS.sort);
  put('max', String(cfg.max), String(S.DEFAULTS.max));
  put('forks', cfg.forks ? '1' : '', '');
  put('clock', cfg.clock ? '' : '0', '');
  put('layout', cfg.layout, S.DEFAULTS.layout);
  put('photo', cfg.photo ? '' : '0', '');
  put('queue', cfg.queue ? '' : '0', '');
  put('name', cfg.name ? '' : '0', '');
  put('name_text', cfg.nameText, '');
  put('name_style', cfg.nameStyle, S.DEFAULTS.nameStyle);
  put('name_deco', cfg.nameDeco, S.DEFAULTS.nameDeco);
  put('tagline', cfg.tagline === false ? 'false' : cfg.tagline, '');
  put('tz', cfg.tz, localTz);
  history.replaceState(null, '', url);
}

function update(patch) {
  S.set(patch);
  syncControls();
  syncURL();
  if (!$('install').classList.contains('hidden')) renderSnippets();
}

fxEl.addEventListener('change', () => update({ fx: fxEl.value }));
palEl.addEventListener('change', () => update({ palette: palEl.value }));
dotEl.addEventListener('input', () => update({ dot: dotEl.value }));
$('sort').addEventListener('change', e => { update({ sort: e.target.value }); restart(); });
$('max').addEventListener('change', e => { update({ max: e.target.value }); restart(); });
$('forks').addEventListener('change', e => { update({ forks: e.target.checked }); restart(); });
$('invert').addEventListener('change', e => update({ invert: e.target.checked }));
$('clock').addEventListener('change', e => update({ clock: e.target.checked }));
$('layout').addEventListener('change', e => { update({ layout: e.target.value }); fitCanvas(); });
$('photo').addEventListener('change', e => update({ photo: e.target.checked }));
$('queue').addEventListener('change', e => { update({ queue: e.target.checked }); restart(); });
$('name').addEventListener('change', e => update({ name: e.target.checked }));
$('nameText').addEventListener('change', e => update({ nameText: e.target.value }));
$('nameStyle').addEventListener('change', e => update({ nameStyle: e.target.value }));
$('nameDeco').addEventListener('change', e => update({ nameDeco: e.target.value }));
$('showTagline').addEventListener('change', e => update({ tagline: e.target.checked ? $('tagline').value : false }));
$('tagline').addEventListener('change', e => update({ tagline: e.target.value }));
$('tz').addEventListener('change', e => {
  const v = e.target.value.trim();
  try { new Intl.DateTimeFormat('en', { timeZone: v || undefined }); update({ tz: v }); say(''); }
  catch { say(`Unknown timezone "${v}". Use an IANA name like America/Bogota.`); syncControls(); }
});

addEventListener('keydown', ev => {
  if (ev.target.closest('input, select, textarea') || ev.metaKey || ev.ctrlKey || S.state.busy) return;
  const k = ev.key.toLowerCase();
  const step = (list, cur) => list[(list.indexOf(cur) + (ev.shiftKey ? list.length - 1 : 1)) % list.length];
  if (k === 'e') update({ fx: step(Object.keys(S.EFFECTS), cfg.fx) });
  else if (k === 'p') update({ palette: step(Object.keys(S.PALETTES), cfg.palette) });
  else if (k === '[') update({ dot: cfg.dot - 1 });
  else if (k === ']') update({ dot: cfg.dot + 1 });
  else if (k === 'i') update({ invert: !cfg.invert });
  else return;
  say(`${S.EFFECTS[cfg.fx]} · ${S.PALETTES[cfg.palette].name} · size ${cfg.dot}`);
});

// Title bar boxes on the panel windows, same pixel glyphs as the animation.
// Minimize folds the window; maximize (and close on the main window) shows only
// the preview until Restore / Esc.
const glyphSvg = rows => {
  const rects = rows.flatMap((r, y) => [...r].map((c, x) => (c === '#' ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : ''))).join('');
  return `<svg viewBox="0 0 7 7" aria-hidden="true">${rects}</svg>`;
};
function setMaximized(on) {
  document.body.classList.toggle('max', on);
  fitCanvas();
  if (!on) $('panel').querySelector('.win')?.classList.remove('min');
}
document.querySelectorAll('.tb').forEach(tb => {
  const win = tb.closest('.win');
  const actions = [
    ['Minimize', () => win.classList.toggle('min')],
    ['Maximize preview', () => setMaximized(true)],
    ['Close', () => (tb.dataset.close === 'hide' ? win.classList.add('hidden') : setMaximized(true))],
  ];
  actions.forEach(([label, fn], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = b.ariaLabel = label;
    b.innerHTML = glyphSvg(S.TITLE_GLYPHS[i]);
    b.addEventListener('click', fn);
    tb.append(b);
  });
});
$('restore').addEventListener('click', () => setMaximized(false));
addEventListener('keydown', ev => { if (ev.key === 'Escape' && document.body.classList.contains('max')) setMaximized(false); });

addEventListener('dragover', ev => ev.preventDefault());
addEventListener('drop', async ev => {
  ev.preventDefault();
  const file = ev.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  S.setImage(await S.loadImage(URL.createObjectURL(file)));
  say('Image previewed. To use it in your README, commit it and set the action\'s `image` input.');
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
let start = performance.now();
const restart = () => (start = performance.now());

async function load() {
  const q = qEl.value.trim();
  say(q ? 'Loading…' : '');
  try {
    const n = await S.load(q);
    say(q ? `${n} repos in the loop` : 'Demo mode. Type your GitHub username.');
  } catch (err) {
    say(err.message);
  }
  syncURL();
  restart();
  if (!$('install').classList.contains('hidden')) renderSnippets();
}
$('form').addEventListener('submit', ev => { ev.preventDefault(); load(); });

// ---------------------------------------------------------------------------
// GIF download
// ---------------------------------------------------------------------------
$('gifBtn').addEventListener('click', async () => {
  if (S.state.busy) return;
  const btn = $('gifBtn');
  btn.disabled = true;
  try {
    const out = await S.encodeGif({ onProgress: p => say(`Rendering GIF… ${Math.round(p * 100)}%`) });
    const blob = out.shown;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `samsara-${cfg.palette}${cfg.invert ? '-inverted' : ''}.gif`;
    a.click();
    say(`GIF ready · ${out.repos} repos · ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    say('Could not render: ' + err.message);
  } finally {
    btn.disabled = false;
    restart();
  }
});

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------
function owner() {
  const q = qEl.value.trim();
  if (!q) return 'YOUR_USERNAME';
  return q.includes('/') ? q.split(/[\s,]+/)[0].replace(/^https?:\/\/github\.com\//, '').split('/')[0] : q;
}

const yamlValue = v => (typeof v === 'number' || /^[\w.-]+$/.test(String(v)) ? String(v) : JSON.stringify(String(v)));

function renderSnippets() {
  const q = qEl.value.trim(), user = owner(), D = S.DEFAULTS;
  const withs = [];
  if (q.includes('/')) withs.push(['repos', q.split(/[\s,]+/).filter(Boolean).join(',')]);
  if (cfg.fx !== D.fx) withs.push(['fx', cfg.fx]);
  if (cfg.palette !== D.palette) withs.push(['palette', cfg.palette]);
  if (cfg.dot !== D.dot) withs.push(['dot', cfg.dot]);
  if (cfg.sort !== D.sort) withs.push(['sort', cfg.sort]);
  if (cfg.max !== D.max) withs.push(['max_repos', cfg.max]);
  if (cfg.forks) withs.push(['forks', 'true']);
  if (!cfg.clock) withs.push(['clock', 'false']);
  if (cfg.layout !== D.layout) withs.push(['layout', cfg.layout]);
  if (!cfg.photo) withs.push(['photo', 'false']);
  if (!cfg.queue) withs.push(['queue', 'false']);
  if (cfg.layout === 'landscape' && !cfg.name) withs.push(['name', 'false']);
  if (cfg.layout === 'landscape' && cfg.name) {
    if (cfg.nameText) withs.push(['name_text', cfg.nameText]);
    if (cfg.nameStyle !== D.nameStyle) withs.push(['name_style', cfg.nameStyle]);
    if (cfg.nameDeco !== D.nameDeco) withs.push(['name_deco', cfg.nameDeco]);
    if (cfg.tagline === false) withs.push(['tagline', 'false']);
    else if (cfg.tagline) withs.push(['tagline', cfg.tagline]);
  }
  for (const k of ['windows', 'hold', 'move', 'fps', 'scale']) if (cfg[k] !== D[k]) withs.push([k, cfg[k]]);
  withs.push(['timezone', cfg.tz || 'UTC']);

  $('yaml').textContent = [
    'name: samsara.exe',
    '',
    'on:',
    '  schedule:',
    '    - cron: "0 0 * * *" # once a day',
    '  workflow_dispatch:',
    '',
    'permissions:',
    '  contents: write',
    '',
    'jobs:',
    '  samsara:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    `      - uses: ${ACTION}`,
    '        with:',
    ...withs.map(([k, v]) => `          ${k}: ${yamlValue(v)}`),
  ].join('\n');

  const base = `https://github.com/${user}/${user}/raw/${OUTPUT_BRANCH}`;
  $('md').textContent = [
    '<picture>',
    `  <source media="(prefers-color-scheme: dark)" srcset="${base}/samsara-dark.gif">`,
    `  <img alt="samsara.exe" src="${base}/samsara.gif">`,
    '</picture>',
  ].join('\n');
  $('profileRepo').textContent = `${user}/${user}`;
}

$('getBtn').addEventListener('click', () => {
  $('install').classList.remove('hidden', 'min');
  renderSnippets();
  $('install').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($(btn.dataset.copy).textContent);
    btn.textContent = 'Copied';
  } catch {
    getSelection().selectAllChildren($(btn.dataset.copy));
    btn.textContent = 'Ctrl+C';
  }
  setTimeout(() => (btn.textContent = 'Copy'), 1500);
}));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
function frame() {
  if (!S.state.busy) S.render(performance.now() - start);
  requestAnimationFrame(frame);
}

(async () => {
  syncControls();
  fitCanvas();
  await S.fontsReady();
  qEl.value = P.get('user') || P.get('repos') || '';
  await load();
  requestAnimationFrame(frame);
})();
})();
