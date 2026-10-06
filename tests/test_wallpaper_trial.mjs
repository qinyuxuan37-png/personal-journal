import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
const code = readFileSync(new URL('../public/wallpaper-trial.js', import.meta.url), 'utf8');
const tick = () => new Promise(r => setImmediate(r));
function fixture() {
  const events = {}, timers = new Map(), frames = [];
  let saves = 0, promotions = 0, failSave = false;
  const window = { addEventListener: (n,f) => { events[n] = f; }, removeEventListener: n => { delete events[n]; } };
  vm.runInNewContext(code, { window, URL, location: { origin: 'http://127.0.0.1:8765' },
    setTimeout: f => { const id = timers.size + 1; timers.set(id,f); return id; }, clearTimeout: id => timers.delete(id),
    document: { createElement: () => ({ style: {}, contentWindow: {}, setAttribute() {}, remove() { this.removed = true; } }) }
  });
  const controller = new AbortController();
  const options = {
    signal: controller.signal, stage: { append: f => frames.push(f) },
    prepare: async () => ({ url: 'http://127.0.0.1:9999', kind: 'html', name: 'test' }),
    commit: async () => { saves++; if(failSave) throw new Error('保存失败'); return { custom: true }; },
    promote: () => { promotions++; }
  };
  return { window, events, timers, frames, options, controller, counts: () => [saves, promotions], failSave: () => { failSave = true; },
    message: (type, source = frames[0]?.contentWindow, origin = 'http://127.0.0.1:9999') => events.message?.({ source, origin, data: { type, reason: 'GPU failed' } }) };
}
test('trial waits for verified frame from the correct origin before saving and promoting', async () => {
  const h = fixture(); const pending = h.window.WallpaperTrial.run(h.options); await tick();
  assert.deepEqual(h.counts(), [0,0]);
  h.message('pond:ready', {}, 'http://127.0.0.1:9999'); await tick();
  assert.deepEqual(h.counts(), [0,0]);
  h.message('pond:ready'); await pending;
  assert.deepEqual(h.counts(), [1,1]);
  assert.equal(h.frames[0].removed, undefined);
  assert.equal(h.timers.size, 0);
});
for (const failure of ['error', 'timeout', 'abort', 'save']) test(`trial ${failure} keeps old frame and removes candidate`, async () => {
  const h = fixture(); if(failure === 'save') h.failSave();
  const pending = h.window.WallpaperTrial.run(h.options);
  const rejection = assert.rejects(pending);
  await tick();
  if (failure === 'error') h.message('pond:error');
  if (failure === 'timeout') [...h.timers.values()][0]();
  if (failure === 'abort') h.controller.abort();
  if (failure === 'save') h.message('pond:ready');
  await rejection;
  assert.deepEqual(h.counts(), [failure === 'save' ? 1 : 0, 0]);
  assert.equal(h.frames[0].removed, true);
  assert.equal(h.timers.size, 0);
});
