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
  const narrow = matchMedia('(max-width: 900px)').matches && !document.body.classList.contains('clean');
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

function syncControls() {
  fxEl.value = cfg.fx;
  dotEl.value = cfg.dot;
  $('dotVal').textContent = cfg.dot;
  $('sort').value = cfg.sort;
  $('max').value = cfg.max;
  $('tz').value = cfg.tz;
  $('forks').checked = cfg.forks;
  $('invert').checked = cfg.invert;
  document.body.classList.toggle('inv', cfg.invert);
}

function syncURL() {
  const url = new URL(location.href);
  const put = (k, v, def) => (v === def || v === '' ? url.searchParams.delete(k) : url.searchParams.set(k, v));
  const q = qEl.value.trim();
  url.searchParams.delete('user');
  url.searchParams.delete('repos');
  if (q) url.searchParams.set(q.includes('/') ? 'repos' : 'user', q);
  put('fx', cfg.fx, S.DEFAULTS.fx);
  put('dot', String(cfg.dot), String(S.DEFAULTS.dot));
  put('sort', cfg.sort, S.DEFAULTS.sort);
  put('max', String(cfg.max), String(S.DEFAULTS.max));
  put('forks', cfg.forks ? '1' : '', '');
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
dotEl.addEventListener('input', () => update({ dot: dotEl.value }));
$('sort').addEventListener('change', e => { update({ sort: e.target.value }); restart(); });
$('max').addEventListener('change', e => { update({ max: e.target.value }); restart(); });
$('forks').addEventListener('change', e => { update({ forks: e.target.checked }); restart(); });
$('invert').addEventListener('change', e => update({ invert: e.target.checked }));
$('tz').addEventListener('change', e => {
  const v = e.target.value.trim();
  try { new Intl.DateTimeFormat('en', { timeZone: v || undefined }); update({ tz: v }); say(''); }
  catch { say(`Unknown timezone "${v}". Use an IANA name like America/Bogota.`); syncControls(); }
});

addEventListener('keydown', ev => {
  if (ev.target.closest('input, select, textarea') || ev.metaKey || ev.ctrlKey || S.state.busy) return;
  const k = ev.key.toLowerCase(), keys = Object.keys(S.EFFECTS);
  if (k === 'e') update({ fx: keys[(keys.indexOf(cfg.fx) + (ev.shiftKey ? keys.length - 1 : 1)) % keys.length] });
  else if (k === '[') update({ dot: cfg.dot - 1 });
  else if (k === ']') update({ dot: cfg.dot + 1 });
  else if (k === 'i') update({ invert: !cfg.invert });
  else return;
  say(S.EFFECTS[cfg.fx] + ' · size ' + cfg.dot);
});

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
    const blob = cfg.invert ? out.dark : out.light;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = cfg.invert ? 'samsara-dark.gif' : 'samsara.gif';
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
  if (cfg.dot !== D.dot) withs.push(['dot', cfg.dot]);
  if (cfg.sort !== D.sort) withs.push(['sort', cfg.sort]);
  if (cfg.max !== D.max) withs.push(['max_repos', cfg.max]);
  if (cfg.forks) withs.push(['forks', 'true']);
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
  $('install').classList.remove('hidden');
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
