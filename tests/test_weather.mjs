import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const read = (name) => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const now = Date.now(), city = { name: '上海', lat: 31.22222, lon: 121.45806 };
const payload = (temperature = 22.5, time = now / 1000) => ({ current_units: { temperature_2m: '°C', relative_humidity_2m: '%', wind_speed_10m: 'm/s' }, current: { time, temperature_2m: temperature, relative_humidity_2m: 0, weather_code: 3, wind_speed_10m: 0 } });
const pure = vm.createContext({ window: {}, URL, URLSearchParams });
vm.runInContext(read('weather-model.js'), pure);
const model = pure.window.LocalWeather;

test('weather request contains only rounded coordinates and specified weather variables', () => {
  const url = new URL(model.url({ ...city, private: 'never send', name: 'private label' }));
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), '31.22');
  assert.equal(url.searchParams.get('longitude'), '121.46');
  assert.equal(url.searchParams.get('wind_speed_unit'), 'ms');
  assert.ok(!url.href.includes('private'));
  assert.equal(model.point(null), null);
  assert.equal(model.point({ lat: NaN, lon: 0 }), null);
});

test('weather parser preserves zero values and does not turn null into invented measurements', () => {
  const data = model.parse(payload(0), now);
  assert.equal(data.temperature, 0); assert.equal(data.humidity, 0); assert.equal(data.wind, 0);
  const partial = payload(); partial.current.temperature_2m = null;
  assert.equal(model.parse(partial, now).temperature, null);
  assert.equal(model.describe(3), '阴'); assert.equal(model.describe(95), '雷阵雨');
  assert.equal(model.describe(100), '天气未知');
});

test('weather parser rejects incorrect units, missing values and stale model timestamps', () => {
  const wrong = payload(); wrong.current_units.wind_speed_10m = 'km/h';
  assert.throws(() => model.parse(wrong, now));
  const empty = payload(); for (const name of ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m']) empty.current[name] = null;
  assert.throws(() => model.parse(empty, now));
  assert.throws(() => model.parse(payload(22, (now - model.usableFor) / 1000), now));
  assert.throws(() => model.parse(payload(22, (now + 3600000) / 1000), now));
});

test('weather cache separates cities, marks older data and expires after two hours', () => {
  const entry = { version: 1, key: '31.22,121.46', received: now, data: model.parse(payload(), now) };
  assert.equal(model.cached(entry, entry.key, now).fresh, true);
  assert.equal(model.cached(entry, entry.key, now + model.freshFor).fresh, false);
  assert.equal(model.cached(entry, '0,0', now), null);
  assert.equal(model.cached(entry, entry.key, now + model.usableFor), null);
  assert.equal(model.cached({ ...entry, data: { ...entry.data, humidity: '0' } }, entry.key, now), null);
  assert.equal(model.cached({ ...entry, received: now + 1 }, entry.key, now), null);
  assert.ok(model.timeLabel(now / 1000, 'invalid-zone').length > 0);
});

class Element {
  constructor() { this.events = new Map(); this.attributes = {}; this.dataset = {}; this.hidden = false; this.textContent = ''; }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(fn); }
  emit(name, event = {}) { for (const callback of this.events.get(name) || []) callback(event); }
}
function setup({ exported = false, defaultEnabled = true, storageBlocked = false, cache = null, preference = undefined } = {}) {
  const document = new Element(), window = new Element(), elements = new Map(), requests = [], timers = [], intervals = [], store = new Map();
  let currentTime = now;
  class Clock extends Date { static now() { return currentTime; } }
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  get('weather-panel').dataset.defaultEnabled = String(defaultEnabled);
  document.getElementById = get; document.documentElement = { hasAttribute: () => exported };
  window.publicMapLocation = city; window.publicProfile = { timezone: 'Asia/Shanghai' };
  window.setTimeout = (callback) => { timers.push(callback); return timers.length - 1; };
  window.clearTimeout = (id) => { timers[id] = null; };
  window.setInterval = (callback) => intervals.push(callback);
  if (cache) store.set('personal-space.weather-cache.v1', JSON.stringify(cache));
  if (preference !== undefined) store.set('personal-space.weather-online.v1', JSON.stringify(preference));
  const context = vm.createContext({ document, window, URL, URLSearchParams, Date: Clock, AbortController,
    navigator: { get geolocation() { throw new Error('GPS forbidden'); } },
    localStorage: { getItem: (key) => { if (storageBlocked) throw new Error('blocked'); return store.get(key) || null; }, setItem: (key, value) => { if (storageBlocked) throw new Error('blocked'); store.set(key, value); } },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); }
  });
  vm.runInContext(read('weather-model.js'), context); vm.runInContext(read('weather.js'), context);
  const answer = (index = requests.length - 1, value = payload()) => requests[index].resolve({ ok: true, json: async () => value });
  return { document, window, get, requests, timers, intervals, store, answer, advance: (ms) => { currentTime += ms; }, locate: (location) => document.emit('map:located', { detail: { location } }) };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('enabled weather shows four metrics, omits credentials and caches repeated map updates', async () => {
  const site = setup(); assert.equal(site.requests.length, 1);
  assert.equal(site.requests[0].options.credentials, 'omit');
  assert.equal(site.requests[0].options.referrerPolicy, 'no-referrer');
  site.answer(); await settle();
  assert.equal(site.get('weather-temperature').textContent, '22.5 °C');
  assert.equal(site.get('weather-condition').textContent, '阴');
  assert.equal(site.get('weather-humidity').textContent, '湿度 0%');
  assert.equal(site.get('weather-wind').textContent, '风速 0.0 m/s');
  assert.equal(site.get('weather-data').hidden, false);
  site.locate(city); site.window.emit('online'); site.intervals[0]();
  assert.equal(site.requests.length, 1);
  assert.ok(site.store.has('personal-space.weather-cache.v1'));
});

test('export and disabled preference do not connect until explicitly enabled', async () => {
  for (const options of [{ exported: true }, { preference: false }, { defaultEnabled: false }]) {
    const site = setup(options); assert.equal(site.requests.length, 0);
    site.get('weather-toggle').emit('click'); assert.equal(site.requests.length, 1);
    site.answer(); await settle(); assert.equal(site.get('weather-data').hidden, false);
    site.get('weather-toggle').emit('click'); assert.equal(site.get('weather-data').hidden, true);
    assert.equal(site.get('weather-toggle').attributes['aria-pressed'], 'false');
  }
});

test('changing city or disabling weather aborts old results and cannot show another city weather', async () => {
  const site = setup(); site.locate({ lat: 35.68, lon: 139.69 });
  assert.equal(site.requests[0].options.signal.aborted, true);
  assert.equal(site.requests.length, 2);
  site.answer(0, payload(10)); await settle(); assert.equal(site.get('weather-data').hidden, true);
  site.answer(1, payload(30)); await settle(); assert.equal(site.get('weather-temperature').textContent, '30.0 °C');
  site.advance(model.freshFor); site.intervals[0](); assert.equal(site.requests.length, 3);
  site.get('weather-toggle').emit('click'); assert.equal(site.requests[2].options.signal.aborted, true);
  site.answer(2, payload(35)); await settle(); assert.equal(site.get('weather-data').hidden, true);
});

test('unresolved region never makes a weather request or keeps a stale city display', async () => {
  const site = setup(); site.answer(); await settle();
  site.locate(null); assert.equal(site.get('weather-data').hidden, true);
  assert.match(site.get('weather-status').textContent, /确认地图地区/);
  assert.equal(site.requests.length, 1);
});

test('network failure marks old cached data, throttles errors and retries when back online', async () => {
  const entry = { version: 1, key: '31.22,121.46', received: now - model.freshFor, data: model.parse(payload(), now) };
  const site = setup({ cache: entry });
  site.requests[0].reject(new Error('offline')); await settle();
  assert.match(site.get('weather-status').textContent, /旧数据/);
  site.locate(city); assert.equal(site.requests.length, 1);
  site.window.emit('online'); assert.equal(site.requests.length, 2);
  site.answer(); await settle(); assert.equal(site.get('weather-status').textContent, '');
  site.advance(model.usableFor); site.intervals[0](); site.requests.at(-1).reject(new Error('offline')); await settle();
  assert.equal(site.get('weather-data').hidden, true); assert.match(site.get('weather-status').textContent, /暂不可用/);
});

test('storage failure retains in-memory cache and background tabs skip polling', async () => {
  const site = setup({ storageBlocked: true }); site.answer(); await settle();
  site.locate(city); assert.equal(site.requests.length, 1);
  site.advance(model.freshFor); site.document.hidden = true; site.intervals[0](); assert.equal(site.requests.length, 1);
  site.document.hidden = false; site.document.emit('visibilitychange'); assert.equal(site.requests.length, 2);
  site.answer(); await settle(); assert.equal(site.get('weather-data').hidden, false);
});

test('request timeout aborts; invalid data is not cached or displayed', async () => {
  const site = setup(); site.timers[0](); assert.equal(site.requests[0].options.signal.aborted, true);
  site.requests[0].reject(new Error('timeout')); await settle();
  assert.equal(site.get('weather-data').hidden, true);
  site.window.emit('online'); site.answer(1, {}); await settle();
  assert.equal(site.get('weather-data').hidden, true);
  assert.ok(!site.store.has('personal-space.weather-cache.v1'));
});
