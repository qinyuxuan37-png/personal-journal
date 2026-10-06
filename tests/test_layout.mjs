import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = (name) => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const scope = { window: {} };
vm.runInNewContext(source('layout-model.js'), scope);
const model = scope.window.SpaceLayout;

test('grid constrains bounds and minimum size, rejects overlaps and malformed data', () => {
  const layout = model.defaults();
  assert.equal(model.valid(layout), true);
  assert.equal(model.change(layout, 'profile', 0, -99).items.profile.y, 0);
  assert.equal(model.change(layout, 'profile', -99, -99, true).items.profile.w, 9);
  assert.equal(model.change(layout, 'clock', -18, 3), null);
  assert.equal(model.change(layout, 'clock', 0, Infinity), null);
  for (const invalid of [null, {}, { version: 3, items: layout.items }]) assert.equal(model.valid(invalid), false);
  const broken = model.defaults(); broken.items.profile.x = true;
  assert.equal(model.valid(broken), false);
  assert.equal(layout.items.profile.y, 3, 'changes do not mutate the previous state');
});

test('old five-module layouts keep the profile and clock without invisible collision zones', () => {
  const old = { version: 1, items: {
    profile: { x: 0, y: 3, w: 13, h: 9 }, clock: { x: 18, y: 0, w: 6, h: 5 },
    tech: { x: 0, y: 13, w: 8, h: 3 }, projects: { x: 8, y: 13, w: 8, h: 3 }, interests: { x: 16, y: 13, w: 8, h: 3 }
  } };
  const migrated = model.normalize(old);
  assert.equal(migrated.version, 2);
  assert.deepEqual(Object.keys(migrated.items), ['profile', 'clock']);
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.items.profile)), old.items.profile);
  assert.equal(model.change(old, 'profile', 0, 4).items.profile.y, 7);
  assert.equal(old.version, 1);
  const app = fixture(old); app.click('start');
  assert.equal(app.canvas.children.filter((child) => !child.isItem).length, 2);
  app.key('profile', 'ArrowDown');
  assert.equal(app.handle('profile').styles['--layout-y'], '25%');
});

test('history supports reset, undo/redo, branches, and independent snapshots', () => {
  const history = new model.History();
  const moved = model.change(null, 'profile', 1, 0);
  history.push(moved); moved.items.profile.x = 9;
  assert.equal(history.current().items.profile.x, 1);
  history.push(null);
  assert.equal(history.undo().items.profile.x, 1);
  assert.equal(history.redo(), null);
  history.undo(); history.undo();
  history.push(model.change(null, 'profile', 0, -1));
  assert.equal(history.canRedo, false);
});

function fixture(initial = null) {
  const docEvents = {}, winEvents = {}, requests = [];
  const media = { matches: true, listeners: [], addEventListener(_, fn) { this.listeners.push(fn); } };
  class Element {
    constructor() {
      this.dataset = {}; this.children = []; this.listeners = {}; this.styles = {};
      this.style = { setProperty: (key, value) => { this.styles[key] = value; } };
      const names = new Set();
      this.classList = {
        add: (...keys) => keys.forEach((key) => names.add(key)), remove: (...keys) => keys.forEach((key) => names.delete(key)),
        contains: (key) => names.has(key), toggle: (key, on) => on ? names.add(key) : names.delete(key)
      };
    }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    setAttribute() {}
    append(...children) { children.forEach((child) => { child.parent = this; this.children.push(child); }); }
    remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
    focus() { this.focused = true; }
    close() { this.open = false; }
    click() { if (!this.disabled) return this.listeners.click?.(); }
    querySelector() { return this.children[0]; }
    querySelectorAll(selector) { return this.children.filter((child) => child.dataset.layout && (selector !== '.layout-item' || child.isItem)); }
    getBoundingClientRect() { return { width: 1200, height: 800 }; }
    setPointerCapture(id) { this.capture = id; }
    hasPointerCapture(id) { return this.capture === id; }
    releasePointerCapture() { this.capture = null; this.listeners.lostpointercapture?.(); }
  }
  const canvas = new Element();
  model.ids.forEach((id) => { const item = new Element(); item.isItem = true; item.dataset.layout = id; canvas.append(item); });
  const elements = Object.fromEntries(['start', 'toolbar', 'status', 'undo', 'redo', 'reset', 'cancel', 'save'].map((id) => ['layout-' + id, new Element()]));
  elements.about = canvas;
  elements['wallpaper-dialog'] = new Element();
  elements['wallpaper-dialog'].open = true;
  elements['wallpaper-diy'] = new Element();
  const context = {
    document: { body: new Element(), documentElement: { hasAttribute: () => false }, getElementById: (id) => elements[id],
      createElement: () => new Element(), addEventListener: (name, fn) => { docEvents[name] = fn; } },
    window: { SpaceLayout: model, publicLayout: initial, matchMedia: () => media, addEventListener: (name, fn) => { winEvents[name] = fn; } },
    clearTimeout() {}, setTimeout() {}, AbortController,
    fetch: async (url, options) => { requests.push({ url, ...options }); return context.response; }
  };
  vm.createContext(context);
  vm.runInContext(source('layout.js'), context);
  vm.runInContext(source('layout-editor.js'), context);
  const press = (key, extra = {}) => ({ key, preventDefault() {}, stopImmediatePropagation() {}, ...extra });
  const handle = (id) => canvas.children.find((child) => child.dataset.layout === id && !child.isItem);
  const key = (id, name, extra = {}) => handle(id).children[0].listeners.keydown(press(name, extra));
  const click = (id) => elements['layout-' + id].click();
  const viewport = (matches) => { media.matches = matches; media.listeners.forEach((fn) => fn()); };
  return { context, canvas, elements, requests, click, handle, key, viewport, winEvents, press };
}

test('save failure retains editable draft; retry saves, cancel and reset undo preserve original', async () => {
  const app = fixture(); app.click('start'); app.key('profile', 'ArrowRight');
  assert.equal(app.elements['wallpaper-dialog'].open, false, 'starting layout closes the unified DIY dialog');
  assert.equal(app.elements['layout-save'].disabled, false);
  app.context.response = { ok: false, json: async () => ({ error: '测试失败' }) };
  await app.click('save');
  assert.equal(app.context.document.body.classList.contains('layout-editing'), true);
  assert.equal(app.elements['layout-save'].disabled, false);
  assert.equal(app.context.window.publicLayout, null);
  const next = JSON.parse(app.requests[0].body);
  assert.equal(next.items.profile.x, 1);
  app.context.response = { ok: true, json: async () => ({ layout: next }) };
  await app.click('save');
  assert.equal(app.context.document.body.classList.contains('layout-editing'), false);
  assert.equal(app.canvas.children.length, model.ids.length);
  assert.equal(app.elements['wallpaper-diy'].focused, true, 'finishing restores focus to the visible unified entry');
  assert.equal(app.context.window.publicLayout.items.profile.x, 1);
  app.click('start'); app.click('reset'); app.click('undo');
  assert.equal(app.elements['layout-save'].disabled, true);
  app.key('profile', 'ArrowLeft'); app.click('cancel');
  assert.equal(app.context.window.publicLayout.items.profile.x, 1);
  app.click('start'); app.click('reset');
  app.context.response = { ok: true, json: async () => ({ layout: null }) };
  await app.click('save');
  assert.equal(app.requests.at(-1).method, 'DELETE');
  assert.equal(app.canvas.classList.contains('has-layout'), false);
});

test('pointer cancel restores snapshot; a complete gesture is one undo step', () => {
  const app = fixture(); app.click('start');
  const move = app.handle('profile').children[0];
  const event = { button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault() {} };
  move.listeners.pointerdown(event);
  move.listeners.pointermove({ ...event, clientX: 50 });
  move.listeners.pointercancel(event);
  assert.equal(app.elements['layout-save'].disabled, true);
  move.listeners.pointerdown(event);
  move.listeners.pointermove({ ...event, clientX: 50 });
  move.listeners.pointermove({ ...event, clientX: 100 });
  move.listeners.pointerup(event);
  app.click('undo');
  assert.equal(app.elements['layout-save'].disabled, true);
  assert.equal(app.elements['layout-redo'].disabled, false);
});

test('small viewport falls back without losing the draft; unsaved changes warn on reload', () => {
  const app = fixture(); app.click('start'); app.key('profile', 'ArrowRight');
  let warned = false;
  app.winEvents.beforeunload({ preventDefault() { warned = true; } });
  assert.equal(warned, true);
  app.viewport(false);
  assert.equal(app.canvas.classList.contains('has-layout'), false);
  assert.equal(app.handle('profile').hidden, true);
  app.viewport(true);
  assert.equal(app.canvas.classList.contains('has-layout'), true);
  assert.equal(app.elements['layout-save'].disabled, false);
  app.click('cancel');
  warned = false;
  app.winEvents.beforeunload({ preventDefault() { warned = true; } });
  assert.equal(warned, false);
});
