import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const app = readFileSync(new URL('../studio/app.js', import.meta.url), 'utf8');

test('public profile form saves three account targets and custom labels', async () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.files = []; }
    append(...nodes) { this.children.push(...nodes); }
    addEventListener(event, callback) { this.listeners[event] = callback; }
    setAttribute() {}
    removeAttribute() {}
    get elements() {
      const find = (node, name) => node.name === name ? node : node.children.map((child) => find(child, name)).find(Boolean);
      return { namedItem: (name) => find(this, name) };
    }
  }
  const requests = [], notices = [];
  let refreshes = 0;
  const context = {
    document: { createElement: (tag) => new Node(tag) },
    el(tag, className, text) { const node = new Node(tag); node.className = className; node.textContent = text; return node; },
    state: { public: { settings: { profile: { name: '秦', github: 'https://github.com/example' } } } },
    imageUrl: () => '',
    writeOptions: (method, value) => ({ method, value }),
    request: async (path, options) => { requests.push({ path, ...options }); },
    refresh: async () => { refreshes++; }, notice: (message) => notices.push(message)
  };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function field('), app.indexOf('function emptyEntries(')), context);
  const root = new Node('div'); context.renderProfile(root, 'public');
  const form = root.children[0].children[0];
  assert.equal(form.elements.namedItem('social2Name').value, '抖音');
  assert.equal(form.elements.namedItem('social3Name').value, '哔哩哔哩');
  assert.equal(form.elements.namedItem('mapLatitude').type, 'number');
  assert.equal(form.elements.namedItem('mapLongitude').type, 'number');
  form.elements.namedItem('mapLatitude').value = '0';
  form.elements.namedItem('mapLongitude').value = '121.5';
  for (const [name, value] of Object.entries({ social2Name: '博客', social2Url: 'https://example.com/me', social3Name: 'B站', social3Url: 'https://space.bilibili.com/123' })) form.elements.namedItem(name).value = value;
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(requests[0].path, '/api/public/settings');
  assert.equal(requests[0].value.github, 'https://github.com/example');
  assert.equal(requests[0].value.social2Name, '博客');
  assert.equal(requests[0].value.social2Url, 'https://example.com/me');
  assert.equal(requests[0].value.social3Url, 'https://space.bilibili.com/123');
  assert.equal(requests[0].value.mapLatitude, '0');
  assert.equal(requests[0].value.mapLongitude, '121.5');
  assert.equal(refreshes, 1);
  assert.equal(notices[0], '资料已保存');
});
class Element {
  constructor() { this.listeners = {}; this.attributes = {}; this.open = true; this.hidden = false; this.classList = { toggle() {} }; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
}

test('save feedback blocks duplicate submissions and Escape until completion, then restores retry', async () => {
  const elements = Object.fromEntries(['close-dialog', 'cancel-dialog', 'entry-dialog', 'entry-form', 'dialog-notice'].map((id) => [id, new Element()]));
  const button = new Element(); elements['entry-form'].querySelector = () => button;
  let saves = 0, closes = 0, reject;
  const state = { saving: false };
  const context = { state, byId: (id) => elements[id], motion: { closeDialog() { closes++; }, arrive() {} }, notice() {},
    saveEntry: () => { saves++; return new Promise((_, no) => { reject = no; }); } };
  const code = app.slice(app.indexOf('const closeEntry ='), app.indexOf('\ndocument.addEventListener("studio:navigate"'));
  vm.runInNewContext(code, context);
  const event = { currentTarget: elements['entry-form'], preventDefault() {} };
  const pending = elements['entry-form'].listeners.submit(event);
  assert.equal(button.textContent, '保存中…');
  assert.equal(elements['cancel-dialog'].disabled, true);
  await elements['entry-form'].listeners.submit(event);
  elements['entry-dialog'].listeners.cancel({ preventDefault() {} });
  elements['close-dialog'].listeners.click();
  assert.equal(saves, 1);
  assert.equal(closes, 0);
  reject(new Error('网络失败'));
  await pending;
  assert.equal(state.saving, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '保存');
  assert.equal(elements['dialog-notice'].textContent, '网络失败');
  assert.equal(elements['entry-dialog'].open, true);
  elements['cancel-dialog'].listeners.click();
  assert.equal(closes, 1);
});

test('an older toast fade cannot erase a newer save notification', async () => {
  const root = new Element(), timers = [];
  let finishFade;
  const context = { byId: () => root, clearTimeout() {}, setTimeout(callback) { timers.push(callback); },
    motion: { arrive() {}, play: () => new Promise((resolve) => { finishFade = resolve; }) } };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function notice('), app.indexOf('async function request(')), context);
  context.notice('第一条');
  const firstFade = timers[0]();
  context.notice('内容已保存');
  finishFade(); await firstFade;
  assert.equal(root.textContent, '内容已保存');
  const lastFade = timers[1](); finishFade(); await lastFade;
  assert.equal(root.textContent, '');
});

test('navigation waits for the visual swap and does not disturb an open entry form', () => {
  const elements = { 'view-select': new Element(), 'entry-dialog': new Element() };
  elements['entry-dialog'].open = false;
  const navButtons = ['home', 'games', 'diary'].map((view) => { const node = new Element(); node.dataset = { view }; return node; });
  const state = { view: 'home', public: {}, private: {}, saving: false };
  const commits = [], renders = [], scrolls = [];
  const context = { state, navButtons, byId: (id) => elements[id], categories: { games: {}, diary: {} }, viewInfo: { home: [] }, notice() {},
    render: () => renders.push(state.view), window: { scrollTo: (options) => scrolls.push(options) },
    motion: { syncNav() {}, switching: false, swap(commit) { commits.push(commit); return Promise.resolve(); } } };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function updateNavigation('), app.indexOf('function render()')), context);
  context.setView('games');
  assert.equal(state.view, 'home');
  assert.equal(navButtons[1].attributes['aria-current'], 'page');
  commits[0]();
  assert.deepEqual(renders, ['games']);
  assert.equal(scrolls[0].behavior, 'instant');
  elements['entry-dialog'].open = true;
  context.setView('diary');
  assert.equal(commits.length, 1);
  assert.equal(state.view, 'games');
});

test('a confirmed save closes the form even if refreshing the list fails', async () => {
  const dialog = new Element(), messages = [];
  const form = { elements: { namedItem: () => ({ value: ' 新记录 ' }) } };
  let writes = 0;
  const context = {
    state: { editing: { kind: 'notes', entry: null } },
    categories: { notes: { scope: 'private', fields: [['title', '标题', 'text']] } },
    byId: (id) => id === 'entry-form' ? form : dialog,
    writeOptions: (method, value) => ({ method, value }),
    request: async (_, options) => { assert.equal(options.value.data.title, '新记录'); writes++; },
    refresh: async () => { throw new Error('refresh unavailable'); },
    motion: { closeDialog: async () => { dialog.open = false; } },
    notice: (message) => messages.push(message)
  };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('async function saveEntry('), app.indexOf('function renderBackup(')), context);
  await context.saveEntry({ preventDefault() {} });
  assert.equal(writes, 1);
  assert.equal(dialog.open, false);
  assert.match(messages[0], /内容已保存/);
  assert.match(messages[0], /列表暂未刷新/);
});
