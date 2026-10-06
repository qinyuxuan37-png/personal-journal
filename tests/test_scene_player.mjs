import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/scene-player.js', import.meta.url), 'utf8')
  .replace('await import("/__vendor/webwallgl.mjs")', 'await loadPlayer()');
function harness(mount) {
  const events = {}, docEvents = {}, messages = [], classes = new Set();
  const nodes = Object.fromEntries(['scene-canvas', 'scene-status', 'scene-preview'].map(id => [id, {
    hidden: false, addEventListener() {}
  }]));
  const parent = { postMessage: (data, origin) => messages.push({ data, origin }) };
  const document = {
    documentElement: { dataset: { siteOrigin: 'http://127.0.0.1:8765' } },
    body: { classList: { add: (name) => classes.add(name) } },
    getElementById: id => nodes[id], hidden: false,
    addEventListener: (name, fn) => { docEvents[name] = fn; }
  };
  const context = vm.createContext({ document, parent,
    window: { addEventListener: (name, fn) => { events[name] = fn; } },
    location: { origin: 'http://127.0.0.1:8766' }, devicePixelRatio: 2,
    console: { warn() {} }, loadPlayer: async () => ({ mount, httpSource: base => ({ base }) })
  });
  const done = vm.runInContext(`(async () => { ${source} })()`, context);
  return { done, events, docEvents, messages, classes, nodes, document, parent };
}
test('scene readiness waits for first frame; visibility messages require the parent origin', async () => {
  let resolve, config, paused = 0, resumed = 0, destroyed = 0;
  const h = harness((canvas, options) => { config = options; return new Promise(r => { resolve = r; }); });
  await new Promise(r => setImmediate(r));
  assert.equal(h.messages.length, 0);
  assert.equal(config.audio, null);
  assert.equal(config.media, null);
  assert.equal(config.renderDpr, 1.5);
  resolve({ pause: () => paused++, resume: () => resumed++, destroy: () => destroyed++ });
  await h.done;
  assert.equal(h.messages[0].data.type, 'pond:ready');
  assert.equal(h.messages[0].origin, 'http://127.0.0.1:8765');
  assert.ok(h.classes.has('is-ready'));
  h.events.message({ origin: 'https://untrusted.example', source: h.parent, data: { type: 'pond:visibility', visible: false } });
  assert.equal(paused, 0);
  h.events.message({ origin: 'http://127.0.0.1:8765', source: h.parent, data: { type: 'pond:visibility', visible: false } });
  assert.equal(paused, 1);
  h.events.pagehide();
  assert.equal(destroyed, 1);
});
test('unsupported scenes keep their preview and report failure instead of false readiness', async () => {
  let destroyed = 0;
  const h = harness(async () => { throw Object.assign(new Error('Unsupported'), { instance: { destroy: () => destroyed++ } }); });
  await h.done;
  assert.equal(destroyed, 1);
  assert.equal(h.classes.has('is-ready'), false);
  assert.equal(h.messages[0].data.type, 'pond:error');
  assert.match(h.nodes['scene-status'].textContent, /仅显示预览图/);
});
test('switching away during scene loading destroys the late instance', async () => {
  let resolve, destroyed = 0;
  const h = harness(() => new Promise(r => { resolve = r; }));
  await new Promise(r => setImmediate(r));
  h.events.pagehide();
  resolve({ destroy: () => destroyed++ });
  await h.done;
  assert.equal(destroyed, 1);
  assert.equal(h.messages.length, 0);
});
