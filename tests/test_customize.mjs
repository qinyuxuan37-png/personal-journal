import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../public/customize.js', import.meta.url), 'utf8');
test('DIY actions share scoped glass controls without promoting reset to a primary action', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/theme.css', import.meta.url), 'utf8');
  for (const id of ['wallpaper-library-refresh', 'wallpaper-default', 'layout-start', 'opening-preview', 'wallpaper-browse', 'wallpaper-apply']) {
    assert.match(html, new RegExp(`<button id="${id}" class="[^"]*\\bdiy-action\\b[^"]*" type="button"`));
  }
  assert.match(html, /id="wallpaper-default" class="diy-action"/);
  assert.match(html, /<label for="opening-frequency">/);
  assert.match(html, /<select id="opening-frequency">/);
  assert.match(css, /\.wallpaper-dialog button\.diy-action \{[^}]*font-size: 14px;[^}]*font-weight: 500;/);
  assert.match(css, /\.diy-panel select \{[^}]*color-scheme: dark;[^}]*font-size: 14px;/);
  assert.match(css, /\.wallpaper-dialog button\.diy-action:disabled \{[^}]*cursor: default;/);
  assert.match(css, /\.wallpaper-dialog button\.diy-action:focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.wallpaper-dialog button\.diy-action/);
  assert.doesNotMatch(css, /\.wallpaper-dialog-actions button:last-child/);
});

function fixture(animated = false) {
  const names = ['wallpaper-dialog', 'wallpaper-diy', 'wallpaper-close', 'opening-frequency', 'opening-preference-status', 'opening-preview',
    ...['background', 'layout', 'opening'].flatMap((name) => ['diy-' + name, 'diy-tab-' + name])];
  const classes = new Set(), events = [], preferences = [];
  class Element {
    constructor() { this.listeners = {}; this.attributes = {}; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    setAttribute(name, value) { this.attributes[name] = value; }
    focus() { this.focused = true; }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const elements = Object.fromEntries(names.map((id) => [id, new Element()]));
  const animations = [], timers = [], preference = { matches: false, addEventListener() {} };
  if (animated) {
    for (const element of Object.values(elements)) {
      element.style = {};
      element.animate = (frames) => {
        let finish;
        const animation = { frames, canceled: false, finished: new Promise(r => { finish = r; }), cancel() { this.canceled = true; }, finish: () => finish() };
        animations.push(animation); return animation;
      };
    }
    elements['wallpaper-dialog'].getBoundingClientRect = () => ({ height: elements['diy-background'].hidden ? 440 : 680 });
  }
  const context = {
    Event,
    document: {
      documentElement: { hasAttribute: () => false }, body: { classList: { contains: (name) => classes.has(name) } },
      getElementById: (id) => elements[id], dispatchEvent: (event) => { events.push(event.type); }
    },
    window: { matchMedia: () => preference, setTimeout: f => { timers.push(f); }, OpeningControls: { getPreference: () => 'session', setPreference: (value) => { preferences.push(value); return true; } } }
  };
  vm.runInNewContext(script, context);
  return { elements, classes, events, preferences, context, animations, timers, preference };
}

test('one DIY dialog has accessible tabs, remembers selection and closes before replay', () => {
  const { elements: el, events, preferences } = fixture();
  el['wallpaper-diy'].listeners.click();
  assert.equal(el['wallpaper-dialog'].open, true);
  assert.equal(el['opening-frequency'].value, 'session');
  el['diy-tab-background'].listeners.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(el['diy-layout'].hidden, false);
  assert.equal(el['diy-background'].hidden, true);
  assert.equal(el['diy-tab-layout'].attributes['aria-selected'], 'true');
  el['diy-tab-layout'].listeners.keydown({ key: 'End', preventDefault() {} });
  assert.equal(el['diy-opening'].hidden, false);
  el['opening-frequency'].listeners.change({ target: { value: 'never' } });
  assert.deepEqual(preferences, ['never']);
  el['opening-preview'].listeners.click();
  assert.equal(el['wallpaper-dialog'].open, false);
  assert.deepEqual(events, ['intro:preview']);
  el['wallpaper-diy'].listeners.click();
  assert.equal(el['diy-opening'].hidden, false);
});

test('DIY animates size and content; rapid changes and closing invalidate old completions', async () => {
  const h = fixture(true), el = h.elements;
  el['wallpaper-diy'].listeners.click();
  el['diy-tab-layout'].listeners.click();
  assert.equal(h.animations.length, 2);
  assert.equal(h.animations[0].frames[0].height, '680px');
  assert.equal(h.animations[0].frames[1].height, '440px');
  el['diy-tab-background'].listeners.click();
  assert.equal(h.animations[0].canceled, true);
  assert.equal(el['diy-background'].hidden, false);
  h.animations[0].finish(); await Promise.resolve();
  assert.equal(el['wallpaper-dialog'].style.height, '680px');
  el['wallpaper-dialog'].listeners.close();
  h.timers.forEach(f => f());
  assert.equal(el['wallpaper-dialog'].style.height, '');
});

test('DIY reduced motion switches immediately without height animations', () => {
  const h = fixture(true), el = h.elements;
  h.preference.matches = true;
  el['wallpaper-diy'].listeners.click();
  el['diy-tab-layout'].listeners.click();
  assert.equal(h.animations.length, 0);
  assert.equal(el['wallpaper-dialog'].style.height, '440px');
});

test('closing DIY does not steal focus from layout editing or replay; storage failure is visible', () => {
  const { elements: el, classes, context } = fixture();
  for (const name of ['layout-editing', 'intro-active']) {
    classes.add(name);
    el['wallpaper-dialog'].listeners.close();
    assert.equal(el['wallpaper-diy'].focused, undefined);
    classes.delete(name);
  }
  el['wallpaper-dialog'].listeners.close();
  assert.equal(el['wallpaper-diy'].focused, true);
  context.window.OpeningControls.setPreference = () => false;
  el['opening-frequency'].listeners.change({ target: { value: 'never' } });
  assert.match(el['opening-preference-status'].textContent, /无法保存/);
});
