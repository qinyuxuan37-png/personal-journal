import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../public/motion.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

function fixture({ skipIntro = true, reduced = false, wallpaperReady, preference, seen = false, storageBlocked = false } = {}) {
  const listeners = {};
  const timers = [];
  const frames = new Map();
  let frameId = 0;
  const stored = new Map(preference ? [['personal-space.opening.v1', preference]] : []);
  const session = new Map(seen ? [['personal-space.opening-seen.v1', '1']] : []);
  const storage = (data) => ({ getItem(key) { if (storageBlocked) throw new Error('blocked'); return data.get(key) ?? null; }, setItem(key, value) { if (storageBlocked) throw new Error('blocked'); data.set(key, value); } });
  let focused = null;
  class FakeElement {
    constructor(id = '') {
      this.id = id;
      this.attributes = {};
      this.listeners = {};
      this.style = { setProperty() {} };
      this.classes = new Set();
      this.classList = {
        add: (value) => this.classes.add(value),
        remove: (...values) => values.forEach((value) => this.classes.delete(value)),
        contains: (value) => this.classes.has(value),
        toggle: (value, force) => {
          if (force ?? !this.classes.has(value)) this.classes.add(value);
          else this.classes.delete(value);
        }
      };
      this.scrollTop = 12;
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    focus() { focused = this; }
    querySelectorAll() { return []; }
    querySelector(selector) { return selector === 'h1,h2' ? this.heading : null; }
    closest(selector) { return selector === 'a[href^="#"]' && this.getAttribute('href')?.startsWith('#') ? this : null; }
  }
  const names = ['opening', 'opening-reveal', 'site-shell', 'content', 'panel-announcement', 'about', 'photos', 'page-3', 'page-4', 'music', 'tech', 'projects', 'interests'];
  const elements = Object.fromEntries(names.map((name) => [name, new FakeElement(name)]));
  const homeIds = ['about', 'photos', 'page-3', 'page-4'];
  for (const name of ['about', 'photos', 'page-3', 'page-4', 'music', 'tech', 'projects', 'interests']) elements[name].heading = new FakeElement(`${name}-heading`);
  const links = ['about', 'tech', 'projects', 'interests'].map((name) => {
    const link = new FakeElement(`${name}-link`);
    link.setAttribute('href', `#${name}`);
    return link;
  });
  const document = {
    body: new FakeElement('body'),
    documentElement: new FakeElement('html'),
    getElementById: (id) => elements[id],
    querySelectorAll: (selector) => selector === '.topbar nav a' ? links : selector === '#content > [data-home-page][id]' ? homeIds.map(id => elements[id]) : [],
    querySelector: () => null,
    addEventListener(type, callback) { listeners[type] = callback; },
    dispatchEvent(event) { listeners[event.type]?.(event); }
  };
  const windowListeners = {};
  const window = {
    wallpaperReady,
    localStorage: storage(stored), sessionStorage: storage(session),
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    innerWidth: 1200,
    innerHeight: 800,
    location: { hash: '', search: skipIntro ? '?skipIntro=1' : '' },
    matchMedia: () => ({ matches: reduced }),
    addEventListener(type, callback) { windowListeners[type] = callback; }
  };
  const history = {
    calls: [],
    pushState(_state, _title, hash) { this.calls.push(hash); window.location.hash = hash; },
    replaceState(_state, _title, hash) { window.location.hash = hash; }
  };
  vm.runInNewContext(script, {
    document, window, history, Element: FakeElement, URLSearchParams, Event,
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); }, setTimeout: (callback) => { callback(); return 1; }
  });
  const tick = (time) => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(time)); };
  const addPage = id => { homeIds.push(id); elements[id] = new FakeElement(id); elements[id].heading = new FakeElement(id + '-heading'); elements[id].setAttribute('aria-label', '自定义页'); document.dispatchEvent(new Event('homepages:changed')); };
  return { document, window, history, elements, links, listeners, windowListeners, timers, session, tick, addPage, focused: () => focused };
}

test('new DIY pages join click, hash and history routing without changing the router', () => {
  const app = fixture(); app.addPage('diy-gallery');
  const link = app.links[0]; link.setAttribute('href', '#diy-gallery');
  app.listeners.click({ target: link, preventDefault() {} });
  assert.equal(app.window.location.hash, '#diy-gallery');
  assert.equal(app.elements['diy-gallery'].classList.contains('is-active'), true);
  assert.equal(app.document.body.classList.contains('home-view'), true);
  assert.equal(app.elements['panel-announcement'].textContent, '已打开自定义页');
  app.window.location.hash = '#photos'; app.windowListeners.popstate();
  assert.equal(app.elements['diy-gallery'].inert, true);
  app.window.location.hash = '#diy-gallery'; app.windowListeners.hashchange();
  assert.equal(app.focused(), app.elements['diy-gallery'].heading);
});

test('dedicated technology and project exhibits open through click and history, and Escape returns home', () => {
  const app = fixture();
  assert.equal(app.document.body.classList.contains('single-screen'), true);
  assert.equal(app.document.body.classList.contains('home-view'), true);
  assert.equal(app.elements.about.classList.contains('is-active'), true);
  assert.equal(app.elements.tech.inert, true);
  for (const [index, id] of ['tech', 'projects'].entries()) {
    let prevented = false;
    app.listeners.click({ target: app.links[index + 1], preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(app.window.location.hash, '#' + id);
    assert.equal(app.elements[id].inert, false);
    assert.equal(app.focused(), app.elements[id].heading);
    assert.equal(app.document.body.classList.contains('home-view'), false);
    assert.equal(app.elements.about.inert, true);
    app.listeners.keydown({ key: 'Escape', preventDefault() {} });
    assert.equal(app.window.location.hash, '#about');
    app.window.location.hash = '#' + id;
    app.windowListeners.popstate();
    assert.equal(app.window.location.hash, '#' + id);
    assert.equal(app.elements[id].classList.contains('is-active'), true);
    assert.equal(app.elements[id].inert, false);
  }
  app.window.location.hash = '#photos'; app.windowListeners.hashchange();
  app.window.location.hash = '#tech'; app.windowListeners.hashchange();
  assert.equal(app.window.location.hash, '#tech');
  assert.equal(app.elements.photos.classList.contains('is-active'), false);
  assert.equal(app.document.body.classList.contains('home-view'), false);
});

test('new exhibit markup replaces retired panels while retaining stable home targets and counts', () => {
  for (const id of ['tech', 'projects']) {
    assert.equal((markup.match(new RegExp(`href="#${id}" data-display-target="${id}"`, 'g')) || []).length, 1);
    assert.match(markup, new RegExp(`<section id="${id}" class="section work-page"`));
    assert.doesNotMatch(markup, new RegExp(`<section id="${id}"[^>]*data-display-deferred`));
    assert.match(markup, new RegExp(`id="profile-${id}-count"`));
  }
  const css = readFileSync(new URL('../public/theme.css', import.meta.url), 'utf8');
  assert.match(css, /\[data-display-deferred\] \{ display: none !important; \}/);
});

test('topbar never contains the retired category navigation on any page', () => {
  const topbar = markup.slice(markup.indexOf('<header class="topbar'), markup.indexOf('</header>'));
  assert.doesNotMatch(topbar, /<nav|主页导航|01 技术|02 项目|03 兴趣/);
  assert.match(topbar, /编辑空间/);
  assert.match(topbar, /id="wallpaper-diy"/);
  assert.doesNotMatch(script, /querySelectorAll\("\.topbar nav a"\)/);
  assert.match(markup, /id="home-pagination"/);
});

test('opening has no visible instructions or buttons and no center rule', () => {
  const opening = markup.slice(markup.indexOf('<div id="opening"'), markup.indexOf('<div id="opening-reveal"'));
  assert.doesNotMatch(opening, /opening-skip|opening-enter|opening-hint"|一个关于作品、热爱与日常的个人空间/);
  assert.match(opening, /class="opening-greeting">HELLO, I'M/);
  assert.match(styles, /\.opening-base\{background:#fff;background-image:none\}/);
});

test('dedicated music route blurs only while active and keeps other exhibits inert', () => {
  const app = fixture();
  const states = []; app.window.MusicWall = { setActive: value => states.push(value) };
  app.links[0].setAttribute('href', '#music');
  app.listeners.click({ target: app.links[0], preventDefault() {} });
  assert.equal(app.elements.music.inert, false);
  assert.equal(app.document.body.classes.has('music-view'), true);
  assert.equal(app.document.body.classes.has('home-view'), false);
  assert.equal(app.focused(), app.elements.music.heading);
  assert.equal(states.at(-1), true);
  app.listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(app.document.body.classes.has('music-view'), false);
  assert.equal(app.elements.music.inert, true);
  assert.equal(states.at(-1), false);
  assert.equal(app.window.location.hash, '#interests');
  assert.equal(app.elements.interests.inert, false);
  app.listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(app.window.location.hash, '#about');
  app.window.location.hash = '#music'; app.windowListeners.popstate();
  assert.equal(app.document.body.classes.has('music-view'), true);
  app.window.location.hash = '#photos'; app.windowListeners.hashchange();
  assert.equal(app.document.body.classes.has('music-view'), false);
  assert.equal(app.elements.tech.inert, true);
});

test('music entry belongs inside interests, never as an extra home-profile row', () => {
  const about = markup.slice(markup.indexOf('<section id="about"'), markup.indexOf('<section id="photos"'));
  assert.doesNotMatch(about, /href="#music"|profile-music-entry/);
  assert.match(about, /href="#interests" data-display-target="interests"/);
  const interests = markup.slice(markup.indexOf('<section id="interests"'), markup.indexOf('</main>'));
  assert.match(interests, /class="interest-destination collection-music-entry" href="#music"/);
  assert.match(interests, /<div data-display-deferred hidden inert>/);
  const app = fixture(); app.listeners.click({ target: app.links[3], preventDefault() {} });
  assert.equal(app.elements.interests.inert, false);
  assert.equal(app.document.body.classes.has('music-view'), false);
});

test('photo album page is a home screen and supports hash navigation and Escape', () => {
  const app = fixture();
  app.window.location.hash = '#photos'; app.windowListeners.hashchange();
  assert.equal(app.elements.photos.classList.contains('is-active'), true);
  assert.equal(app.elements.about.inert, true);
  assert.equal(app.document.body.classList.contains('home-view'), true);
  assert.equal(app.focused(), app.elements.photos.heading);
  app.listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(app.window.location.hash, '#about');
  assert.equal(app.elements.photos.inert, true);
  const photoMarkup = markup.match(/<section id="photos"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(photoMarkup, /<img|<iframe|<input|<button/);
  assert.match(photoMarkup, /data-space-module="photo-album"/);
  assert.match(photoMarkup, /data-page-gesture-lock/);
});

test('new blank pages support direct hashes, history and Escape without changing sections', () => {
  const app = fixture();
  for (const id of ['page-3', 'page-4']) {
    app.window.location.hash = '#' + id; app.windowListeners.popstate();
    assert.equal(app.elements[id].classList.contains('is-active'), true);
    assert.equal(app.document.body.classList.contains('home-view'), true);
    assert.equal(app.focused(), app.elements[id].heading);
    app.listeners.keydown({ key: 'Escape', preventDefault() {} });
    assert.equal(app.window.location.hash, '#about');
    assert.equal(app.elements[id].inert, true);
    const section = markup.match(new RegExp(`<section id="${id}"[\\s\\S]*?<\\/section>`))[0];
    assert.doesNotMatch(section, /<img|<iframe|<input|<button/);
  }
});

test('clicking the opening anywhere enters once and focuses the homepage', () => {
  const app = fixture({ skipIntro: false, reduced: true });
  assert.equal(app.elements['site-shell'].inert, true);
  app.elements.opening.listeners.click();
  assert.equal(app.elements['site-shell'].inert, false);
  assert.equal(app.document.body.classList.contains('site-ready'), true);
  assert.equal(app.focused(), app.elements.about.heading);
  app.elements.opening.listeners.click();
  assert.equal(app.elements['site-shell'].inert, false);
});

test('dragging explores the opening, while Enter can still enter', () => {
  const app = fixture({ skipIntro: false, reduced: true });
  app.elements.opening.listeners.pointerdown({ clientX: 100, clientY: 100 });
  app.elements.opening.listeners.pointermove({ clientX: 130, clientY: 100 });
  app.windowListeners.pointerup();
  app.elements.opening.listeners.click();
  assert.equal(app.elements['site-shell'].inert, true);
  app.elements.opening.listeners.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(app.elements['site-shell'].inert, false);
});

test('animated entry waits for the prepared wallpaper and keeps the page inert through the crossfade', async () => {
  let ready;
  const wallpaperReady = new Promise((resolve) => { ready = resolve; });
  const app = fixture({ skipIntro: false, wallpaperReady });
  app.elements.opening.listeners.click();
  app.elements.opening.listeners.click();
  assert.equal(app.timers.length, 2);
  app.timers.find((timer) => timer.delay === 120).callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.elements.opening.classList.contains('is-exiting'), false);
  assert.equal(app.elements.opening.classList.contains('is-expanding'), false, 'slow loading does not leave a full black screen');
  ready();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.elements.opening.classList.contains('is-expanding'), true);
  app.timers.find((timer) => timer.delay === 100).callback();
  assert.equal(app.elements.opening.classList.contains('is-exiting'), true);
  assert.equal(app.elements['site-shell'].inert, true);
  app.timers.find((timer) => timer.delay === 220).callback();
  assert.equal(app.document.body.classList.contains('intro-revealing'), true);
  app.timers.find((timer) => timer.delay === 1000).callback();
  assert.equal(app.elements.opening.hidden, true);
  assert.equal(app.elements['site-shell'].inert, false);
});

test('a wallpaper that never becomes ready cannot trap the user in the opening', async () => {
  const app = fixture({ skipIntro: false, wallpaperReady: new Promise(() => {}) });
  app.elements.opening.listeners.click();
  app.timers.find((timer) => timer.delay === 120).callback();
  app.timers.find((timer) => timer.delay === 1800).callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.elements.opening.classList.contains('is-expanding'), true);
  app.timers.find((timer) => timer.delay === 1000).callback();
  assert.equal(app.elements['site-shell'].inert, false);
});

test('opening frequency is local, completed playback is remembered, and replay resets the exit state', () => {
  const skipped = fixture({ skipIntro: false, preference: 'session', seen: true });
  assert.equal(skipped.elements.opening.hidden, true);
  const never = fixture({ skipIntro: false, preference: 'never', reduced: true });
  assert.equal(never.elements.opening.hidden, true);
  never.listeners['intro:preview']();
  assert.equal(never.elements.opening.hidden, false);
  never.elements.opening.listeners.click();
  assert.equal(never.session.get('personal-space.opening-seen.v1'), '1');
  never.elements.opening.classList.add('is-exiting');
  never.listeners['intro:preview']();
  assert.equal(never.elements.opening.classList.contains('is-exiting'), false);
  assert.equal(never.elements['site-shell'].inert, true);
  assert.equal(never.window.OpeningControls.setPreference('bogus'), false);
  assert.equal(never.window.OpeningControls.setPreference('always'), true);
  assert.equal(never.window.OpeningControls.getPreference(), 'always');
  const blocked = fixture({ skipIntro: false, storageBlocked: true, reduced: true });
  blocked.elements.opening.listeners.click();
  assert.equal(blocked.elements['site-shell'].inert, false);
  assert.equal(blocked.window.OpeningControls.setPreference('never'), false);
});

test('pointer following is refresh-rate independent; cancelled gestures do not enter', () => {
  const follow = (hz) => {
    const app = fixture({ skipIntro: false });
    app.elements.opening.listeners.pointermove({ clientX: 1000, clientY: 500 });
    app.tick(0);
    for (let time = 1000 / hz; time < 200; time += 1000 / hz) app.tick(time);
    app.tick(200);
    return Number(app.elements['opening-reveal'].style.clipPath.match(/at ([\d.]+)px/)[1]);
  };
  assert.ok(Math.abs(follow(60) - follow(144)) < .2);
  const app = fixture({ skipIntro: false, reduced: true });
  app.elements.opening.listeners.pointerdown({ clientX: 10, clientY: 10, button: 0 });
  app.windowListeners.pointercancel();
  app.elements.opening.listeners.click();
  assert.equal(app.elements['site-shell'].inert, true);
  app.elements.opening.listeners.pointerdown({ clientX: 10, clientY: 10, button: 0 });
  app.elements.opening.listeners.click();
  assert.equal(app.elements['site-shell'].inert, false);
});

test('replaying after an interrupted tracking frame still follows the pointer', async () => {
  const app = fixture({ skipIntro: false });
  app.elements.opening.listeners.pointermove({ clientX: 1000, clientY: 600 });
  app.elements.opening.listeners.click();
  app.timers.find((timer) => timer.delay === 120).callback();
  await new Promise((resolve) => setImmediate(resolve));
  app.timers.find((timer) => timer.delay === 100).callback();
  app.timers.find((timer) => timer.delay === 220).callback();
  app.timers.find((timer) => timer.delay === 1000).callback();
  app.listeners['intro:preview']();
  const before = app.elements['opening-reveal'].style.clipPath;
  app.elements.opening.listeners.pointermove({ clientX: 1000, clientY: 600 });
  app.tick(0);
  assert.notEqual(app.elements['opening-reveal'].style.clipPath, before);
});
