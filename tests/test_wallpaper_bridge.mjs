import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
const script = readFileSync(new URL('../public/pond-bridge.js', import.meta.url), 'utf8')
  .replace('__SITE_ORIGIN__', 'http://127.0.0.1:8765').replace('__WALLPAPER_KIND__', 'html');
function fixture() {
  const messages = [], events = {}, timers = [], docEvents = {}, properties = [];
  let now = 0;
  class Canvas { getContext() { return { drawArrays() {}, drawImage() {} }; } }
  const originalGetContext = Canvas.prototype.getContext;
  const document = { hidden: false, addEventListener: (name, fn) => { docEvents[name] = fn; } };
  const parent = { postMessage: (data, origin) => messages.push({ data, origin }) };
  const context = vm.createContext({ HTMLCanvasElement: Canvas, WeakSet, document,
    performance: { now: () => now }, parent,
    window: { parent, wallpaperPropertyListener: { applyGeneralProperties: value => properties.push(value) }, addEventListener: (name, fn) => { events[name] = fn; } },
    fetch: async () => ({ ok: true, json: async () => ({ general: { properties: {} } }) }),
    setTimeout: f => timers.push(f)
  });
  vm.runInContext(script, context);
  return { messages, events, timers, document, docEvents, properties, parent, Canvas, originalGetContext, advance: n => { now += n; }, draw: new Canvas().getContext('webgl2') };
}
test('web bridge does not report HTTP load as rendered; requires drawing activity', async () => {
  const h = fixture(); await h.events.load();
  assert.equal(h.messages.length, 0);
  h.draw.drawArrays(); h.advance(40); h.draw.drawArrays(); h.advance(800);
  h.timers.shift()();
  assert.equal(h.messages[0].data.type, 'pond:ready');
  assert.equal(h.messages[0].data.evidence, 'render');
  assert.equal(h.Canvas.prototype.getContext, h.originalGetContext);
  assert.equal(h.draw.drawArrays.toString(), 'drawArrays() {}');
});
test('web bridge forwards startup exceptions and never follows them with ready', async () => {
  const h = fixture();
  h.events.error({ message: 'WebGL context creation failed' });
  await h.events.load();
  h.draw.drawArrays(); h.advance(40); h.draw.drawArrays(); h.advance(800);
  h.timers.forEach(f => f());
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].data.type, 'pond:error');
  assert.match(h.messages[0].data.reason, /WebGL/);
  assert.equal(h.Canvas.prototype.getContext, h.originalGetContext);
});

test('bridge combines trusted parent visibility with document visibility', async () => {
  const h = fixture(); await h.events.load();
  assert.equal(h.properties.at(-1).isPaused, false);
  h.document.hidden = true; h.docEvents.visibilitychange();
  assert.equal(h.properties.at(-1).isPaused, true);
  h.document.hidden = false;
  h.events.message({ source: h.parent, origin: 'http://127.0.0.1:8765', data: { type: 'pond:visibility', visible: false } });
  h.docEvents.visibilitychange();
  assert.equal(h.properties.at(-1).isPaused, true);
  h.events.message({ source: h.parent, origin: 'http://127.0.0.1:8765', data: { type: 'pond:visibility', visible: true } });
  assert.equal(h.properties.at(-1).isPaused, false);
  h.events.pagehide();
  assert.equal(h.properties.at(-1).isPaused, true);
  assert.equal(h.Canvas.prototype.getContext, h.originalGetContext);
});
