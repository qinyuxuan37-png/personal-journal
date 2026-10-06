import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../public/editor.js', import.meta.url), 'utf8');

function fixture({ reduced = false } = {}) {
  const origin = 'http://127.0.0.1:8765';
  const loads = [], messages = [], events = [], classes = new Set();
  const documentListeners = {}, windowListeners = {};
  const timers = new Map();
  let timerId = 0;
  const classList = (values) => ({
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name)
  });
  const motion = { matches: reduced, addEventListener(name, fn) { this[name] = fn; } };
  class Element {
    constructor() { this.listeners = {}; this.hidden = true; this.open = false; this.classList = classList(new Set()); this.focusCount = 0; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
    focus() { this.focused = true; ++this.focusCount; }
    getAttribute(name) { return name === 'src' ? this.src : null; }
  }
  const elements = Object.fromEntries(['studio-dialog', 'studio-frame', 'studio-loading', 'studio-close'].map((id) => [id, new Element()]));
  const frame = elements['studio-frame'];
  frame.contentWindow = { postMessage: (data, target) => messages.push({ data, target }) };
  Object.defineProperty(frame, 'src', { get: () => loads.at(-1), set: (src) => loads.push(src) });
  vm.runInNewContext(script, {
    URL, Event, location: { origin },
    document: {
      documentElement: { hasAttribute: () => false },
      body: { classList: classList(classes) },
      getElementById: (id) => elements[id],
      addEventListener: (name, fn) => { documentListeners[name] = fn; },
      dispatchEvent: (event) => events.push(event.type)
    },
    window: {
      addEventListener: (name, fn) => { windowListeners[name] = fn; },
      matchMedia: () => motion,
      setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
      clearTimeout(id) { timers.delete(id); }
    }
  });
  function click(path = '/studio?view=projects', options = {}) {
    const link = new Element(); link.href = origin + path; link.closest = () => link;
    let prevented = false;
    documentListeners.click({ target: link, button: 0, preventDefault() { prevented = true; }, ...options });
    return { link, prevented };
  }
  function message(type, override = {}) {
    windowListeners.message({ origin, source: frame.contentWindow, data: { type }, ...override });
  }
  function finishTimers() {
    for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
  }
  return { elements, frame, classes, loads, messages, events, click, message, timers, motion, finishTimers };
}

test('editor opens on the requested collection, preserves the iframe between visits and restores focus', () => {
  const app = fixture();
  const { link, prevented } = app.click();
  assert.equal(prevented, true);
  assert.equal(app.elements['studio-dialog'].open, true);
  assert.match(app.frame.src, /view=projects&embedded=1/);
  app.message('studio:ready');
  assert.equal(app.frame.hidden, false);
  assert.equal(app.elements['studio-loading'].hidden, true);
  assert.equal(app.messages.find((message) => message.data.type === 'studio:navigate').data.view, 'projects');
  app.elements['studio-close'].listeners.click();
  assert.equal(app.elements['studio-dialog'].open, true, 'exit keeps the dialog mounted until the transition completes');
  assert.equal(app.classes.has('studio-leaving'), true);
  app.finishTimers();
  assert.equal(app.classes.has('studio-open'), false);
  assert.equal(link.focused, true);
  app.click('/studio?view=tech');
  assert.equal(app.loads.length, 1);
  assert.equal(app.messages.filter((message) => message.data.type === 'studio:navigate').at(-1).data.view, 'tech');
  app.message('studio:close');
  app.finishTimers();
  assert.equal(app.elements['studio-dialog'].open, false);
});

test('only the same-origin editor can request a public refresh or close the overlay', () => {
  const app = fixture(); app.click();
  app.message('studio:public-changed', { origin: 'http://127.0.0.1:8766' });
  app.message('studio:close', { source: {} });
  assert.equal(app.events.length, 0);
  assert.equal(app.elements['studio-dialog'].open, true);
  app.message('studio:public-changed');
  assert.deepEqual(app.events, ['public:refresh']);
});

test('modified clicks retain the standalone editor navigation', () => {
  const app = fixture();
  assert.equal(app.click('/studio', { ctrlKey: true }).prevented, false);
  assert.equal(app.loads.length, 0);
});

test('Escape shares the exit transition and repeated close requests do not restart it', () => {
  const app = fixture(); app.click();
  let prevented = false;
  app.elements['studio-dialog'].listeners.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(app.elements['studio-dialog'].open, true);
  assert.equal(app.timers.size, 1);
  app.message('studio:close');
  app.elements['studio-close'].listeners.click();
  assert.equal(app.timers.size, 1);
  app.finishTimers();
  assert.equal(app.elements['studio-dialog'].open, false);
  assert.equal(app.classes.has('studio-leaving'), false);
});

test('reopening cancels the exit and obsolete callbacks cannot close the new visit', () => {
  const app = fixture(); app.click(); app.message('studio:ready');
  app.message('studio:close');
  const oldCallback = [...app.timers.values()][0];
  const { link } = app.click('/studio?view=games');
  assert.equal(app.timers.size, 0);
  oldCallback();
  app.elements['studio-dialog'].listeners.close();
  assert.equal(app.elements['studio-dialog'].open, true);
  assert.equal(app.classes.has('studio-open'), true);
  assert.equal(app.classes.has('studio-leaving'), false);
  assert.equal(link.focused, undefined, 'obsolete close must not return focus outside the modal');
  assert.equal(app.loads.length, 1, 'the same iframe survives rapid close and reopen');
  assert.equal(app.messages.filter((message) => message.data.type === 'studio:navigate').at(-1).data.view, 'games');
});

test('late and duplicate ready messages never steal focus from a closing or closed editor', () => {
  const app = fixture(); const { link } = app.click();
  app.message('studio:close');
  app.message('studio:ready');
  assert.equal(app.frame.focusCount, 0);
  assert.equal(app.frame.hidden, false, 'the loaded frame is retained for the next visit');
  app.finishTimers();
  app.message('studio:ready');
  assert.equal(app.frame.focusCount, 0);
  assert.equal(link.focusCount, 1);
  app.click('/studio?view=notes');
  assert.equal(app.frame.focusCount, 1);
  app.message('studio:ready');
  assert.equal(app.frame.focusCount, 1, 'a repeated readiness notification is not a new focus request');
});

test('reduced motion closes immediately, including when the preference changes during exit', () => {
  const app = fixture({ reduced: true }); app.click();
  app.message('studio:close');
  assert.equal(app.elements['studio-dialog'].open, false);
  assert.equal(app.timers.size, 0);

  const changing = fixture(); changing.click(); changing.message('studio:close');
  changing.motion.matches = true;
  changing.motion.change();
  assert.equal(changing.elements['studio-dialog'].open, false);
  assert.equal(changing.timers.size, 0);
});
