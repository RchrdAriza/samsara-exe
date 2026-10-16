#!/usr/bin/env node
// samsara.exe — renders the GIFs by driving index.html in headless Chrome.
//
// Used by action.yml, but also works locally:
//   node action/render.mjs --user octocat --fx atkinson --timezone America/Bogota
//
// Options come from SAMSARA_* env vars (set by the action) and/or --flags.
// No npm dependencies: a tiny static server + the Chrome DevTools Protocol.

import http from 'node:http';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['user', 'repos', 'fx', 'palette', 'dot', 'image', 'sort', 'forks', 'max_repos', 'timezone',
  'windows', 'hold', 'move', 'fps', 'scale', 'clock', 'layout', 'photo', 'queue', 'name', 'name_text', 'name_style', 'name_deco', 'tagline',
  'output', 'dark_output', 'token'];

function readOptions() {
  const o = {};
  for (const k of KEYS) {
    const v = process.env['SAMSARA_' + k.toUpperCase()];
    if (v !== undefined && v.trim() !== '') o[k] = v.trim();
  }
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([\w-]+)(?:=(.*))?$/);
    if (!m) throw new Error(`Unexpected argument: ${argv[i]}`);
    const key = m[1].replace(/-/g, '_');
    if (!KEYS.includes(key)) throw new Error(`Unknown option --${m[1]}`);
    o[key] = m[2] ?? argv[++i];
  }
  if (!o.token && process.env.GITHUB_TOKEN) o.token = process.env.GITHUB_TOKEN;
  o.output ??= 'samsara.gif';
  o.dark_output ??= 'samsara-dark.gif';
  return o;
}

const log = (...a) => console.log('[samsara.exe]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- local image -> data URL (lets users point `image` at a file in their repo)
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
async function resolveImage(ref) {
  if (!ref) return '';
  if (/^(https?:|data:)/.test(ref)) return ref;
  const file = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd(), ref);
  if (!existsSync(file)) throw new Error(`image not found: ${ref} (did you add actions/checkout before this step?)`);
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`image must be png, jpg, gif or webp: ${ref}`);
  return `data:${type};base64,${(await readFile(file)).toString('base64')}`;
}

// --- static server for index.html, src/ and fonts/
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ttf': 'font/ttf', '.css': 'text/css' };
function serve() {
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !MIME[path.extname(file)]) { res.writeHead(404); return res.end(); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// --- Chrome
function findChrome() {
  const names = [process.env.CHROME_PATH, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
  for (const n of names) {
    if (path.isAbsolute(n)) { if (existsSync(n)) return n; continue; }
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      const p = path.join(dir, n);
      if (existsSync(p) && statSync(p).isFile()) return p;
    }
  }
  throw new Error('Chrome/Chromium not found. Set CHROME_PATH.');
}

async function launchChrome(url) {
  const userDir = await mkdtemp(path.join(os.tmpdir(), 'samsara-chrome-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--hide-scrollbars', '--disable-extensions', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--window-size=480,720', '--remote-debugging-port=0', `--user-data-dir=${userDir}`, url,
  ];
  if (process.env.CI || process.getuid?.() === 0) args.unshift('--no-sandbox');
  const proc = spawn(findChrome(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('Chrome did not start in 30s\n' + buf)), 30000);
    proc.stderr.on('data', d => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.on('exit', code => { clearTimeout(t); reject(new Error(`Chrome exited (${code})\n${buf}`)); });
  });
  const port = new URL(wsUrl).port;
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    page = targets.find(t => t.type === 'page' && t.url.startsWith(url.split('?')[0]));
    if (!page) await sleep(100);
  }
  if (!page) throw new Error('Could not find the page in Chrome');
  return {
    page,
    async close() {
      proc.kill();
      await sleep(200);
      await rm(userDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      console.log(text.startsWith('samsara.exe') ? '[' + text.replace(':', ']') : '[page] ' + text);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      console.error('[page error]', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('DevTools connection failed')); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  return { ready, send, evaluate, close: () => ws.close() };
}

// --- main
const opts = readOptions();
const t0 = Date.now();
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/index.html?headless=1`;
let chrome, client;
try {
  const params = {
    user: opts.user, repos: opts.repos, token: opts.token,
    fx: opts.fx, palette: opts.palette, dot: opts.dot, sort: opts.sort, forks: opts.forks, max: opts.max_repos,
    tz: opts.timezone, windows: opts.windows, hold: opts.hold, move: opts.move, fps: opts.fps, scale: opts.scale, clock: opts.clock,
    layout: opts.layout, photo: opts.photo, queue: opts.queue, name: opts.name, nameText: opts.name_text,
    nameStyle: opts.name_style, nameDeco: opts.name_deco, tagline: opts.tagline,
    image: await resolveImage(opts.image),
  };
  log(`rendering ${params.repos || params.user} · ${params.fx || 'halftone'}`);
  chrome = await launchChrome(url);
  client = cdp(chrome.page.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Runtime.enable');
  for (let i = 0; !(await client.evaluate('!!window.samsaraReady')); i++) {
    if (i > 200) throw new Error('Page did not load');
    await sleep(50);
  }
  const res = await client.evaluate(`window.samsaraReady.then(() => Samsara.exportForAction(${JSON.stringify(params)}))`);

  const write = async (file, b64) => {
    const out = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd(), file);
    await mkdir(path.dirname(out), { recursive: true });
    const buf = Buffer.from(b64, 'base64');
    await writeFile(out, buf);
    log(`wrote ${file} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
  };
  await write(opts.output, res.light);
  if (opts.dark_output && opts.dark_output !== 'false') await write(opts.dark_output, res.dark);
  log(`${res.info.repos} repos, ${res.info.frames} frames, ${res.info.seconds}s loop, done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log(res.info.names.join(' · '));
} catch (err) {
  console.error('[samsara.exe] ' + (err.message || err));
  process.exitCode = 1;
} finally {
  client?.close();
  await chrome?.close();
  server.close();
}
