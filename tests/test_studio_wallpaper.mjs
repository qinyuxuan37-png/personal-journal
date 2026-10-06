import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../studio/wallpaper.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../studio/style.css', import.meta.url), 'utf8');

test('empty and editing surfaces use translucent dark glass, not white panels', () => {
  assert.match(styles, /\.wallpaper-mode \.empty-records\{background:rgba\(5,22,25,\.64\)\}/);
  assert.match(styles, /\.wallpaper-mode dialog\{background:rgba\(5,22,25,\.92\)/);
  assert.match(styles, /\.wallpaper-mode \.dialog-actions\{background:transparent/);
});

test('studio shows the current wallpaper without reloading it on focus', async () => {
  const loads = [];
  const stage = { hidden: true };
  const frame = {
    title: '',
    set src(value) { loads.push(value); },
    get src() { return loads.at(-1); }
  };
  const listeners = {};
  const context = vm.createContext({
    document: {
      documentElement: { classList: { contains: () => false } },
      hidden: false,
      getElementById: (id) => id === 'studio-wallpaper' ? stage : frame,
      addEventListener: (event, handler) => { listeners[event] = handler; }
    },
    window: { addEventListener: (event, handler) => { listeners[event] = handler; } },
    location: { origin: 'http://127.0.0.1:8765' },
    fetch: async () => ({
      ok: true,
      json: async () => ({ available: true, url: 'http://127.0.0.1:8766', name: 'koi', custom: false, kind: 'koi' })
    }),
    URL
  });

  vm.runInContext(script, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stage.hidden, false);
  assert.equal(frame.src, 'http://127.0.0.1:8766/');
  listeners.focus();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads.length, 1);
});

test('embedded studio reuses its parent wallpaper without loading another canvas', () => {
  vm.runInNewContext(script, {
    document: { documentElement: { classList: { contains: (name) => name === 'studio-embedded' } } }
  });
});
