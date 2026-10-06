// Run with node --expose-gc scripts/benchmark-map.mjs. Node heap, not browser/GPU RAM.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
if (!global.gc) throw new Error('Run with --expose-gc');
const heap = () => { global.gc(); return process.memoryUsage().heapUsed; };
const mib = bytes => Number((bytes / 1024 / 1024).toFixed(2));
const context = vm.createContext({ window: {} });
const initial = heap();
for (const name of ['offline-map-model.js', 'offline-map-data.js']) {
  vm.runInContext(readFileSync(new URL('../public/' + name, import.meta.url), 'utf8'), context);
}
const model = context.window.OfflineMap, data = context.window.OfflineGeoData;
const loaded = heap();
let start = performance.now();
let index = model.catalog(data);
const indexMs = performance.now() - start, indexed = heap();
const expected = index.resolve({ city: '上海' }).location.id;
index = null;
const beforeQuery = heap();
start = performance.now();
const result = model.lookup(data, { city: '上海' });
const queryMs = performance.now() - start, queried = heap();
if (result.location.id !== expected) throw new Error('Resolution mismatch');
console.log(JSON.stringify({ environment: 'Node heap, isolated measurement; not browser memory',
  cities: data.cities.length, datasetMiB: mib(loaded - initial),
  oldIndexRetainedMiB: mib(indexed - loaded), oldIndexBuildMs: Math.round(indexMs),
  newQueryRetainedMiB: mib(queried - beforeQuery), newQueryMs: Math.round(queryMs),
  note: 'Live browser releases the dataset too by terminating its query worker; file:// fallback retains raw data.'
}, null, 2));
