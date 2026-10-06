import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const script = app.slice(app.indexOf('async function initPond()'), app.indexOf('async function init()'));

class Element {
  constructor() {
    this.hidden = false;
    this.listeners = {};
    this.classes = new Set();
    this.classList = {
      contains: (name) => this.classes.has(name),
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name)
    };
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  getBoundingClientRect() { return { top: 0, bottom: 800 }; }
  focus() {}
  showModal() {}
  close() {}
}

async function setup(info = { available: true, url: 'http://127.0.0.1:8766', name: 'wallpaper', custom: false }) {
  const ids = [
    'pond-stage', 'pond-frame', 'pond-status', 'wallpaper-diy', 'wallpaper-dialog',
    'wallpaper-path', 'wallpaper-message', 'wallpaper-current', 'wallpaper-browse',
    'wallpaper-apply', 'wallpaper-default', 'wallpaper-close'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  const loads = [];
  Object.defineProperty(elements['pond-frame'], 'src', {
    get() { return loads.at(-1); },
    set(value) { loads.push(value); }
  });
  elements['pond-frame'].contentWindow = { postMessage() {} };
  const body = new Element();
  body.classes.add('intro-active');
  const windowListeners = {};
  const timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({
    exported: false,
    $: (id) => elements[id],
    document: { body, getElementById: (id) => elements[id], addEventListener() {} },
    window: {
      matchMedia: () => ({ matches: false }),
      addEventListener: (name, callback) => { windowListeners[name] = callback; },
      setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
      clearTimeout: (id) => timers.delete(id)
    },
    fetch: async () => ({ ok: true, json: async () => info }),
    location: { origin: 'http://127.0.0.1:8765' },
    innerHeight: 800,
    URL, Date, AbortController
  });
  vm.runInContext(`${script}\ninitPond();`, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { elements, loads, body, windowListeners, context, timers };
}

test('wallpaper preloads during the opening and navigation does not hide or reload it', async () => {
  const { elements, loads, body, windowListeners, context, timers } = await setup();
  assert.equal(elements['pond-stage'].hidden, false);
  assert.equal(body.classList.contains('has-pond'), true);
  assert.match(elements['pond-frame'].src, /^http:\/\/127\.0\.0\.1:8766\//);
  windowListeners.message({
    origin: 'http://127.0.0.1:8766',
    source: elements['pond-frame'].contentWindow,
    data: { type: 'pond:ready' }
  });
  await context.window.wallpaperReady;
  assert.equal(timers.size, 0, 'ready clears the initial-load timeout');
  assert.equal(body.classList.contains('wallpaper-ready'), true);
  const before = loads.length;
  body.classList.toggle('home-view', false);
  windowListeners.message({
    origin: 'http://127.0.0.1:8766',
    source: elements['pond-frame'].contentWindow,
    data: { type: 'pond:error' }
  });
  assert.equal(elements['pond-stage'].hidden, false);
  assert.equal(body.classList.contains('has-pond'), true);
  assert.equal(loads.length, before);
  const requests = [];
  context.fetch = async (path, options) => {
    requests.push({ path, options });
    return { ok: true, json: async () => ({ available: true, url: 'http://127.0.0.1:8766', name: 'Scene', kind: 'scene', custom: true }) };
  };
  context.window.WallpaperTrial = { run: async ({ prepare }) => { await prepare(); throw new Error('试播失败'); } };
  await assert.rejects(context.window.WallpaperControls.select('200'), /试播失败/);
  assert.equal(JSON.parse(requests[0].options.body).libraryId, '200');
  assert.equal(requests[0].path, '/api/wallpaper/prepare');
  assert.equal(requests.length, 1, 'failed preparation never saves the selected wallpaper');
  assert.equal(loads.length, before, 'old frame is never navigated on failure');
  assert.equal(body.classList.contains('wallpaper-ready'), true);
});

test('missing wallpaper entry ends waiting without loading an invalid iframe or changing selection', async () => {
  const { elements, loads, context, timers } = await setup({
    available: true, url: 'http://127.0.0.1:8766', name: 'missing', custom: true, kind: 'unsupported'
  });
  await context.window.wallpaperReady;
  assert.deepEqual(loads, ['about:blank']);
  assert.equal(timers.size, 0);
  assert.match(elements['pond-status'].textContent, /文件已失效/);
  assert.equal(elements['wallpaper-default'].disabled, false);
});

test('a silent wallpaper times out but can recover on a late trusted ready message', async () => {
  const { elements, loads, body, windowListeners, context, timers } = await setup();
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 60000);
  timer.callback();
  await context.window.wallpaperReady;
  assert.match(elements['pond-status'].textContent, /加载超时/);
  assert.equal(body.classList.contains('wallpaper-ready'), false);
  const before = loads.length;
  windowListeners.message({ origin: 'http://127.0.0.1:8766', source: elements['pond-frame'].contentWindow, data: { type: 'pond:ready' } });
  assert.equal(elements['pond-status'].hidden, true);
  assert.equal(body.classList.contains('wallpaper-ready'), true);
  assert.equal(loads.length, before);
});

test('page exit cancels the initial-load timeout', async () => {
  const { windowListeners, timers } = await setup();
  assert.equal(timers.size, 1);
  windowListeners.pagehide();
  assert.equal(timers.size, 0);
});
