import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../public/wallpaper-library.js', import.meta.url), 'utf8');
class Element {
  constructor(tag = '') { this.tag = tag; this.dataset = {}; this.children = []; this.events = {}; this.attrs = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(fragment) { this.children = fragment.children; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, fn) { this.events[name] = fn; }
  querySelectorAll() { return this.children.filter(n => n.tag === 'button'); }
  querySelector(selector) { return this.children.find(n => selector.includes(`"${n.dataset.wallpaperId}"`)); }
  focus() { this.focused = true; }
  closest() { return this; }
}
function harness() {
  const nodes = {};
  const ids = ['wallpaper-library', 'wallpaper-library-refresh', 'wallpaper-library-status',
    'wallpaper-library-count', 'wallpaper-diy', 'diy-tab-background'];
  ids.forEach(id => { nodes[id] = new Element(); });
  let fail = false, selection = [], calls = 0;
  const context = vm.createContext({
    document: {
      getElementById: id => nodes[id], createElement: tag => new Element(tag),
      createDocumentFragment: () => new Element()
    },
    window: { WallpaperControls: { select: async id => {
      if (fail) throw new Error('文件夹已删除');
      selection.push(id);
    } } },
    fetch: async () => {
      calls++;
      return { ok: true, json: async () => ({ configured: true, items: [
        { id: '1', title: '<script>literal title</script>', kind: 'html', selected: true, supported: true, preview: '/preview' },
        { id: '2', title: 'Scene', kind: 'scene', selected: false, supported: true },
        { id: '3', title: 'Application', kind: 'unsupported', selected: false, supported: false },
      ] }) };
    }
  });
  vm.runInContext(code, context);
  return { nodes, selection, calls: () => calls, fail: () => { fail = true; } };
}
test('gallery loads on demand, renders literal titles and highlights the applied wallpaper', async () => {
  const h = harness();
  assert.equal(h.calls(), 0);
  await h.nodes['wallpaper-diy'].events.click();
  const list = h.nodes['wallpaper-library'];
  assert.equal(list.children.length, 4);
  assert.match(list.children[0].textContent, /订阅状态未确认/);
  assert.equal(list.querySelectorAll()[0].children[1].children[0].textContent, '<script>literal title</script>');
  assert.equal(list.querySelectorAll()[2].disabled, true);
  await list.events.click({ target: list.querySelectorAll()[1] });
  assert.deepEqual(h.selection, ['2']);
  assert.equal(list.querySelectorAll()[0].attrs['aria-pressed'], 'false');
  assert.equal(list.querySelectorAll()[1].attrs['aria-pressed'], 'true');
  assert.equal(list.querySelectorAll()[1].focused, true);
  assert.equal(list.attrs['aria-busy'], 'false');
});
test('failed selection preserves the current highlight and allows retry', async () => {
  const h = harness();
  await h.nodes['wallpaper-diy'].events.click();
  h.fail();
  const list = h.nodes['wallpaper-library'];
  await list.events.click({ target: list.querySelectorAll()[1] });
  assert.equal(list.querySelectorAll()[0].attrs['aria-pressed'], 'true');
  assert.equal(list.querySelectorAll()[1].attrs['aria-pressed'], 'false');
  assert.equal(list.querySelectorAll()[1].disabled, false);
  assert.equal(h.nodes['wallpaper-library-status'].textContent, '文件夹已删除');
});
