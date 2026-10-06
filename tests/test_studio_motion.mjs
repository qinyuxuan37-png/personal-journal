import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../studio/motion.js', import.meta.url), 'utf8');
const turn = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ reduced = false, supported = true } = {}) {
  const animations = [], timers = new Map(), docEvents = {}, windowEvents = {};
  let nextTimer = 0;
  class Element {
    constructor() {
      this.attributes = {}; this.style = {}; this.open = false; this.isConnected = true;
      const classes = new Set();
      this.classList = { add: (value) => classes.add(value), remove: (value) => classes.delete(value), contains: (value) => classes.has(value) };
      if (!supported) this.animate = undefined;
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    focus() { this.focused = true; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    querySelector() { return this.form; }
    getBoundingClientRect() { return { height: this.height || 40 }; }
    animate(frames, options) {
      let resolve, reject;
      const item = { node: this, frames, options, finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
        finish: () => resolve(), cancel() { this.cancelled = true; reject(new Error('cancelled')); } };
      animations.push(item); return item;
    }
  }
  const elements = Object.fromEntries(['view-stage', 'nav-indicator', 'add-button'].map((id) => [id, new Element()]));
  const preference = { matches: reduced, addEventListener(_, callback) { this.change = callback; } };
  const document = { hidden: false, activeElement: new Element(), getElementById: (id) => elements[id], addEventListener(name, callback) { docEvents[name] = callback; } };
  const window = { matchMedia: () => preference, addEventListener(name, callback) { windowEvents[name] = callback; },
    setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; }, clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(source, { window, document });
  return { motion: window.StudioMotion, elements, animations, preference, document, docEvents, windowEvents, timers, Element };
}

test('rapid section changes commit only the last request and always unlock the content', async () => {
  const app = fixture(), commits = [];
  const first = app.motion.swap(() => commits.push('games'));
  const second = app.motion.swap(() => commits.push('diary'));
  assert.equal(app.elements['view-stage'].inert, true);
  app.animations.at(-1).finish();
  await turn();
  assert.deepEqual(commits, ['diary']);
  assert.equal(app.elements['view-stage'].inert, false);
  app.animations.at(-1).finish();
  await Promise.all([first, second]);
  assert.equal(app.motion.switching, false);
  assert.equal(app.elements['view-stage'].attributes['aria-busy'], undefined);
});

test('failed render cannot strand a section behind an inert animation state', async () => {
  const app = fixture();
  const pending = app.motion.swap(() => { throw new Error('render failed'); });
  const rejected = assert.rejects(pending, /render failed/);
  app.animations.at(-1).finish();
  await rejected;
  assert.equal(app.elements['view-stage'].inert, false);
  assert.equal(app.motion.switching, false);
});

test('reduced motion, unavailable animation API, and background tabs never delay a commit', async () => {
  for (const options of [{ reduced: true }, { supported: false }]) {
    const app = fixture(options); let committed = false;
    await app.motion.swap(() => { committed = true; });
    assert.equal(committed, true);
    assert.equal(app.animations.length, 0);
  }
  const app = fixture(); let committed = false;
  const pending = app.motion.swap(() => { committed = true; });
  app.document.hidden = true;
  app.docEvents.visibilitychange();
  await pending;
  assert.equal(committed, true);
  assert.equal(app.elements['view-stage'].inert, false);
});

test('animation watchdog recovers from missing finished signals and media preference changes', async () => {
  const app = fixture();
  const pending = app.motion.swap(() => {});
  [...app.timers.values()][0].callback();
  await turn();
  app.preference.matches = true; app.preference.change();
  await pending;
  assert.equal(app.motion.switching, false);
  assert.equal(app.timers.size, 0);
});

test('entry dialog closes smoothly, restores focus, and reopening defeats stale completion', async () => {
  const app = fixture(), dialog = new app.Element(); dialog.form = new app.Element();
  const arrival = app.motion.openDialog(dialog);
  app.animations.at(-1).finish(); await arrival;
  const close = app.motion.closeDialog(dialog);
  assert.equal(dialog.open, true);
  assert.equal(dialog.form.inert, true);
  const reopen = app.motion.openDialog(dialog);
  assert.equal(dialog.form.inert, false);
  app.animations.at(-1).finish();
  await Promise.all([close, reopen]);
  assert.equal(dialog.open, true);
  const finalClose = app.motion.closeDialog(dialog);
  app.animations.at(-1).finish(); await finalClose;
  assert.equal(dialog.open, false);
  assert.equal(dialog.form.inert, false);
  assert.equal(app.document.activeElement.focused, true);
});

test('expanding text and navigation indicator update without touching wallpaper state', async () => {
  const app = fixture({ reduced: true }), node = new app.Element();
  await app.motion.resize(node, () => { node.height = 140; });
  assert.equal(node.height, 140);
  const button = new app.Element(); button.offsetTop = 160; button.offsetHeight = 44; button.parentElement = new app.Element();
  app.motion.syncNav(button);
  assert.equal(app.elements['nav-indicator'].style.transform, 'translateY(160px)');
  button.offsetTop = 180; app.windowEvents.resize();
  assert.equal(app.elements['nav-indicator'].style.transform, 'translateY(180px)');
});
