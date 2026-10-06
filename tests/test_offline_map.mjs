import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = (file) => readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
const modelSource = source('offline-map-model.js');
const dataSource = source('offline-map-data.js');
const context = vm.createContext({ window: {} });
vm.runInContext(modelSource, context);
vm.runInContext(dataSource, context);
const model = context.window.OfflineMap;
const catalog = model.catalog(context.window.OfflineGeoData);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('bundled map resolves Shanghai in Chinese and English, preferring canonical city names', () => {
  for (const city of ['上海', '上海市', 'Shanghai', 'ShangHai', 'Shanghai, China', '中国上海']) {
    const result = catalog.resolve({ city });
    assert.equal(result.type, 'found', city);
    assert.equal(result.location.id, '1796236', city);
  }
  assert.equal(catalog.resolve({ city: '浙江杭州' }).location.name, '杭州');
});

test('same-name cities require confirmation; country and saved choice disambiguate', () => {
  const result = catalog.resolve({ city: 'Paris' });
  assert.equal(result.type, 'ambiguous');
  assert.ok(result.matches.length > 1);
  assert.equal(catalog.resolve({ city: 'Paris, France' }).location.code, 'FR');
  assert.equal(catalog.resolve({ city: 'Paris' }, '4717560').location.code, 'US');
  assert.equal(catalog.resolve({ city: 'Paris' }, '1796236').type, 'ambiguous');
});

test('empty and unlisted regions never silently fall back to another city', () => {
  assert.equal(catalog.resolve({}).type, 'empty');
  assert.equal(catalog.resolve({ city: '不存在的测试地区xyz' }).type, 'missing');
  assert.equal(model.normalize(' São Paulo '), 'saopaulo');
});

test('manual coordinates accept zero, override city, and reject partial or invalid values', () => {
  const result = catalog.resolve({ city: '自定义', mapLatitude: '0', mapLongitude: '0' });
  assert.equal(result.manual, true);
  assert.equal(result.location.lat, 0);
  assert.equal(result.location.lon, 0);
  for (const [mapLatitude, mapLongitude] of [['1', ''], ['', '2'], ['NaN', '2'], ['91', '0'], ['0', '181'], ['Infinity', '1']]) {
    assert.equal(catalog.resolve({ city: '上海', mapLatitude, mapLongitude }).type, 'invalid');
  }
  assert.equal(catalog.resolve({ city: '上海', mapLatitude: '', mapLongitude: '' }).manual, undefined);
});

test('projection is finite at the poles and origin is the center', () => {
  const point = model.project(0, 0);
  near(point.x, 500); near(point.y, 500);
  for (const latitude of [-90, 90]) assert.ok(Number.isFinite(model.project(180, latitude).y));
  assert.equal(model.project(-180, 0).x, 0);
  assert.equal(model.project(180, 0).x, 1000);
});

test('viewport locks to region, preserves zoom anchor and constrains dragging', () => {
  const view = new model.Viewport(700, 400);
  view.locate({ lon: 0, lat: 0 });
  assert.equal(view.zoom, 8);
  const before = view.box(), anchor = { x: .25, y: .7 };
  view.zoomBy(1.5, anchor);
  const after = view.box();
  near(before.x + before.w * anchor.x, after.x + after.w * anchor.x);
  near(before.y + before.h * anchor.y, after.y + after.h * anchor.y);
  view.pan(1e8, -1e8);
  assert.ok(view.box().x >= 0 && view.box().y >= 0);
  view.zoomBy(1e9); assert.equal(view.zoom, 20);
  view.zoomBy(1e-9); assert.equal(view.zoom, 1);
  view.resize(200, 1000); near(view.y, 500);
  view.locate(null); assert.equal(view.zoom, 1);
});

class Element {
  constructor() {
    this.attributes = {}; this.children = []; this.events = new Map(); this.hidden = false;
    this.classes = new Set(); this.classList = { add: (x) => this.classes.add(x), remove: (x) => this.classes.delete(x) };
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  append(...elements) { this.children.push(...elements); }
  replaceChildren(...elements) { this.children = elements; }
  addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
  emit(name, values = {}) {
    const event = { button: 0, pointerId: 1, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...values };
    for (const callback of this.events.get(name) || []) callback(event);
    return event;
  }
  getBoundingClientRect() { return { width: 700, height: 400, left: 0, top: 0 }; }
  focus() { this.focusCount = (this.focusCount || 0) + 1; }
  setPointerCapture(id) { this.captured = id; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  remove() {}
}
function ui({ exported = false, workers = false } = {}) {
  const elements = new Map(), document = new Element(), scripts = [], store = new Map();
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  document.getElementById = get;
  document.documentElement = { hasAttribute: () => exported };
  document.currentScript = { src: exported ? 'file:///C:/export/public/offline-map.js' : 'http://127.0.0.1:8765/public/offline-map.js' };
  document.createElement = document.createElementNS = () => new Element();
  document.head = { append: (script) => scripts.push(script) };
  document.dispatchEvent = (event) => document.emit(event.type, { detail: event.detail });
  const window = new Element();
  const spawned = [], timeouts = new Map();
  let timerId = 0;
  if (workers) window.Worker = class {
    constructor(url) { this.url = url; spawned.push(this); }
    postMessage(input) { this.input = input; }
    terminate() { this.terminated = true; }
    finish() { this.onmessage({ data: { result: model.lookup(context.window.OfflineGeoData, this.input.profile, this.input.preferred), land: this.input.includeLand ? 'M0,0' : undefined } }); }
  };
  const ctx = vm.createContext({ document, window, URL, setTimeout: fn => { const id = ++timerId; timeouts.set(id, fn); return id; }, clearTimeout: id => timeouts.delete(id), localStorage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) }, fetch: () => { throw new Error('Network not permitted'); }, navigator: { get geolocation() { throw new Error('GPS not permitted'); } } });
  ctx.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  vm.runInContext(modelSource, ctx);
  vm.runInContext(source('offline-map.js'), ctx);
  const refresh = (profile) => { window.publicProfile = profile; document.emit('public:rendered'); };
  const finish = () => { vm.runInContext(dataSource, ctx); scripts.at(-1).onload(); };
  return { get, refresh, finish, scripts, store, window, spawned, timeouts };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('candidate-only lookup preserves city resolution, aliases and manual-coordinate behavior', () => {
  const profiles = ['上海', 'Shanghai, China', '中国上海', '浙江杭州', 'Paris', 'Paris, France', 'São Paulo', '', 'no-such-city'].map(city => ({ city }));
  profiles.push({ city: 'x', mapLatitude: '0', mapLongitude: '0' }, { city: '上海', mapLatitude: '91', mapLongitude: '0' });
  // Sample the full dataset, including aliases and region-qualified names.
  for (let i = 0; i < context.window.OfflineGeoData.cities.length; i += 997) {
    const row = context.window.OfflineGeoData.cities[i];
    for (const city of [row[1], row[7][0], `${row[1]}, ${row[3]}`]) if (city) profiles.push({ city });
  }
  const comparable = result => JSON.stringify({ ...result, matches: [...result.matches].sort((a, b) => a.id.localeCompare(b.id)) });
  for (const profile of profiles) {
    for (const preferred of ['', '4717560']) assert.equal(comparable(model.lookup(context.window.OfflineGeoData, profile, preferred)), comparable(catalog.resolve(profile, preferred)), JSON.stringify(profile));
  }
});

test('worker entry returns only the query result and optional coastline', () => {
  const replies = [], worker = { postMessage: value => replies.push(value) };
  const ctx = vm.createContext({ self: worker, importScripts: (...names) => names.forEach(name => vm.runInContext(source(name), ctx)) });
  // Classic workers expose self as the global object.
  ctx.window = worker;
  vm.runInContext(source('offline-map-worker.js'), ctx);
  worker.onmessage({ data: { profile: { city: '上海' }, includeLand: true } });
  assert.equal(replies[0].result.location.name, '上海');
  assert.equal(typeof replies[0].land, 'string');
  assert.equal(replies[0].cities, undefined);
});

test('live map terminates workers, deduplicates queries and bounds cached results', async () => {
  const site = ui({ workers: true });
  site.refresh({ city: '上海' }); site.refresh({ city: '上海' });
  assert.equal(site.spawned.length, 1); assert.equal(site.scripts.length, 0);
  site.spawned[0].finish(); await settle();
  assert.equal(site.spawned[0].terminated, true); assert.equal(site.timeouts.size, 0);
  assert.equal(site.window.OfflineGeoData, undefined);
  site.refresh({ city: '上海' }); await settle(); assert.equal(site.spawned.length, 1);
  for (let i = 0; i < 9; i++) {
    site.refresh({ city: `test-city-${i}` }); site.spawned.at(-1).finish(); await settle();
    assert.equal(site.spawned.at(-1).input.includeLand, false);
  }
  site.refresh({ city: '上海' }); assert.equal(site.spawned.length, 11);
  site.spawned.at(-1).finish(); await settle();
});

test('replaced, failed, timed-out and hidden-page worker queries are released', async () => {
  const site = ui({ workers: true });
  site.refresh({ city: 'Paris' }); const old = site.spawned[0];
  site.refresh({ city: '上海' }); assert.equal(old.terminated, true);
  site.spawned[1].finish(); old.finish(); await settle();
  assert.match(site.get('map-location').textContent, /上海/);
  site.refresh({ city: 'Tokyo' }); site.spawned.at(-1).onerror(); await settle();
  assert.equal(site.spawned.at(-1).terminated, true);
  assert.equal(site.get('map-retry').hidden, false);
  site.get('map-retry').emit('click');
  [...site.timeouts.values()][0](); await settle();
  assert.equal(site.spawned.at(-1).terminated, true);
  site.get('map-retry').emit('click'); site.window.emit('pagehide'); await settle();
  assert.equal(site.spawned.at(-1).terminated, true); assert.equal(site.timeouts.size, 0);
});

test('map lazy-loads one local asset and only latest public region wins', async () => {
  const site = ui();
  assert.equal(site.scripts.length, 0);
  site.refresh({ city: 'Paris' });
  site.refresh({ city: 'Shanghai' });
  assert.equal(site.scripts.length, 1);
  assert.equal(site.scripts[0].src, 'http://127.0.0.1:8765/public/offline-map-data.js');
  site.finish(); await settle();
  assert.match(site.get('map-location').textContent, /上海/);
  assert.equal(site.get('map-choices').hidden, true);
  assert.equal(site.get('map-mini').children[2].attributes.visibility, 'visible');
  site.refresh({ city: '未收录的测试城市' }); await settle();
  assert.equal(site.get('map-mini').children[2].attributes.visibility, 'hidden');
  assert.match(site.get('map-preview-status').textContent, /未收录/);
});

test('expanded map supports drag, wheel, keyboard, recenter and close focus', async () => {
  const site = ui(); site.refresh({ city: '上海' }); site.finish(); await settle();
  site.get('map-preview').emit('click');
  assert.equal(site.get('map-dialog').open, true);
  const svg = site.get('map-full'), initial = svg.attributes.viewBox;
  svg.emit('pointerdown', { clientX: 300, clientY: 200 });
  svg.emit('pointermove', { clientX: 340, clientY: 200 });
  assert.notEqual(svg.attributes.viewBox, initial);
  assert.ok(svg.classes.has('is-dragging'));
  svg.emit('pointercancel'); assert.ok(!svg.classes.has('is-dragging'));
  assert.equal(svg.emit('wheel', { deltaY: -100, deltaMode: 0, clientX: 350, clientY: 200 }).prevented, true);
  site.get('map-center').emit('click'); assert.equal(svg.attributes.viewBox, initial);
  assert.equal(svg.emit('keydown', { key: '+' }).prevented, true);
  assert.notEqual(svg.attributes.viewBox, initial);
  svg.emit('keydown', { key: 'Home' }); assert.equal(svg.attributes.viewBox, initial);
  assert.equal(site.get('map-dialog').emit('keydown', { key: 'Escape' }).stopped, true);
  site.get('map-close').emit('click'); assert.equal(site.get('map-dialog').open, false);
  assert.equal(site.get('map-preview').focusCount, 1);
});

test('DIY card resize redraws the map viewport without losing its region', async () => {
  const site = ui(); site.refresh({ city: '上海' }); site.finish(); await settle();
  const svg = site.get('map-mini'), before = svg.attributes.viewBox;
  svg.getBoundingClientRect = () => ({ width: 540, height: 355, left: 0, top: 0 });
  site.window.emit('resize');
  assert.notEqual(svg.attributes.viewBox, before);
  const box = svg.attributes.viewBox.split(' ').map(Number);
  near(box[3] / box[2], 355 / 540);
  assert.equal(svg.children[2].attributes.visibility, 'visible');
  assert.match(site.get('map-location').textContent, /上海/);
});

test('ambiguous city selection persists, but is not reused for unrelated regions', async () => {
  const site = ui(); site.refresh({ city: 'Paris' }); site.finish(); await settle();
  const choices = site.get('map-choices'); assert.equal(choices.hidden, false);
  choices.children.find((x) => x.textContent.includes('Texas')).emit('click');
  assert.equal(choices.hidden, true); assert.match(site.get('map-location').textContent, /Texas/);
  site.refresh({ city: 'Paris' }); await settle(); assert.match(site.get('map-location').textContent, /Texas/);
  site.refresh({ city: '上海' }); await settle(); assert.match(site.get('map-location').textContent, /上海/);
});

test('failed local load can retry; offline export uses a relative file asset', async () => {
  const site = ui({ exported: true }); site.refresh({ city: '上海' });
  assert.equal(site.scripts[0].src, 'file:///C:/export/public/offline-map-data.js');
  site.scripts[0].onerror(); await settle();
  assert.equal(site.get('map-retry').hidden, false);
  site.get('map-retry').emit('click'); assert.equal(site.scripts.length, 2);
  site.finish(); await settle(); assert.equal(site.get('map-retry').hidden, true);
  assert.match(site.get('map-location').textContent, /上海/);
});

test('display-only map closes back to its trigger; manual label is accurate', async () => {
  const site = ui(); site.refresh({ city: '手动位置', mapLatitude: '0', mapLongitude: '0' }); site.finish(); await settle();
  assert.match(site.get('map-coordinates').textContent, /手动坐标/);
  site.get('map-preview').emit('click'); site.get('map-close').emit('click');
  assert.equal(site.get('map-preview').focusCount, 1);
});
