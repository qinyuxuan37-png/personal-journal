import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../public/home-pages.js', import.meta.url), 'utf8');
test('wallpaper receives empty-page space while only visible foreground surfaces accept pointers', () => {
  const css = readFileSync(new URL('../public/home-pages.css', import.meta.url), 'utf8');
  const base = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const album = readFileSync(new URL('../public/photo-album.css', import.meta.url), 'utf8');
  assert.match(css, /\.single-screen #content,\s*\.single-screen #content > \[data-home-page\],\s*\.single-screen \.site-shell > \.topbar \{ pointer-events: none; \}/);
  assert.match(css, /\.blank-page \{[^}]*pointer-events: none;/);
  assert.match(css, /:is\(\.hero-copy,\.hero-side,\[data-space-module\]\),[\s\S]*?pointer-events: auto;/);
  assert.match(css, /\.topbar :is\(a,button,input,select\) \{ pointer-events: auto;/);
  assert.match(css, /\.home-pagination a \{\s*pointer-events: auto;/);
  assert.match(css, /\.single-screen \.pond-frame \{ pointer-events: auto;/);
  assert.doesNotMatch(css, /pointer:coarse/);
  assert.doesNotMatch(base, /@media\(pointer:coarse\)\{\.pond-frame\{pointer-events:none\}/);
  assert.doesNotMatch(base, /\.single-screen\.has-pond \.hero\{pointer-events:auto\}/);
  assert.match(album, /\.album-page\.is-active \{[^}]*pointer-events: none;/);
  assert.match(album, /\.photo-album \{[^}]*pointer-events: auto;/);
});
test('pagination is four neutral accessible dots, without labels or a pill background', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const nav = html.match(/<nav id="home-pagination"[\s\S]*?<\/nav>/)[0];
  assert.equal((nav.match(/<a /g) || []).length, 4);
  assert.match(nav, /aria-label="切换到第一页"><\/a>/);
  assert.match(nav, /aria-label="切换到第二页"><\/a>/);
  assert.match(nav, /aria-label="切换到第三页"><\/a>/);
  assert.match(nav, /aria-label="切换到第四页"><\/a>/);
  assert.doesNotMatch(nav, /主页|照片|←|→|<span/);
  const css = readFileSync(new URL('../public/home-pages.css', import.meta.url), 'utf8');
  assert.match(css, /a::before/);
  assert.match(css, /a\[aria-current="page"\]::before/);
  assert.doesNotMatch(css, /\.home-pagination a(?::hover|:active|:focus-visible)?::after/);
});
function fixture({ reduced = false } = {}) {
  const animations = [], events = {}, windowEvents = {}, timers = new Map(), frames = new Map();
  let timer = 0, frameId = 0, now = 0, modal = false;
  let pageIds = ['about', 'photos', 'page-3', 'page-4'];
  class Element {
    constructor(id) {
      this.id = id; this.events = {}; this.attrs = {}; this.classes = new Set(); this.clientWidth = 1200; this.scrollLeft = 0;
      this.children = []; this.offsetWidth = 32;
      this.properties = {};
      this.style = { setProperty: (key, value) => { this.properties[key] = value; } };
      this.classList = { add: (...names) => names.forEach(n => this.classes.add(n)), remove: (...names) => names.forEach(n => this.classes.delete(n)), contains: n => this.classes.has(n) };
    }
    addEventListener(type, fn) { this.events[type] = fn; }
    closest() { return this.blocked ? this : null; }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    removeAttribute(k) { delete this.attrs[k]; }
    replaceChildren(...items) { this.children = items; }
    get offsetLeft() { return Math.max(0, el['home-pagination'].children.indexOf(this)) * 32; }
    click() { navigate(this.attrs.href.slice(1)); }
    animate(frames, options) {
      let resolve, reject;
      const animation = { frames, options, finished: new Promise((yes, no) => { resolve = yes; reject = no; }), finish: () => resolve(), cancel: () => { animation.cancelled = true; reject(); } };
      animations.push(animation); return animation;
    }
  }
  const ids = ['content', 'home-pagination', 'about', 'photos', 'page-3', 'page-4', 'home-page-link', 'photos-page-link', 'page-3-link', 'page-4-link', 'body', 'pond-frame'];
  const el = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  el['home-page-link'].attrs.href = '#about'; el['photos-page-link'].attrs.href = '#photos';
  el['page-3-link'].attrs.href = '#page-3'; el['page-4-link'].attrs.href = '#page-4';
  el['home-pagination'].children = [el['home-page-link'], el['photos-page-link'], el['page-3-link'], el['page-4-link']];
  el['home-pagination'].querySelectorAll = () => el['home-pagination'].children;
  el.content.querySelectorAll = () => pageIds.map(id => el[id]);
  const media = { matches: reduced, addEventListener: (_, fn) => { media.change = fn; } };
  const document = { body: el.body, hidden: false, getElementById: id => el[id], createElement: () => new Element(''), querySelector: () => modal ? {} : null, addEventListener: (type, fn) => { events[type] = fn; }, dispatchEvent: event => events[event.type]?.(event) };
  const window = { matchMedia: () => media, addEventListener: (type, fn) => { windowEvents[type] = fn; }, setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id), requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id) };
  vm.runInNewContext(source, { document, window, performance: { now: () => now }, Event });
  let active = 'about';
  function navigate(next) {
    window.HomePages.reset();
    for (const id of pageIds) { el[id].classList.remove('is-active'); el[id].inert = id !== next; }
    el[next]?.classList.add('is-active'); window.HomePages.change(active, next); active = next;
  }
  el['home-page-link'].click = () => navigate('about'); el['photos-page-link'].click = () => navigate('photos');
  el['page-3-link'].click = () => navigate('page-3'); el['page-4-link'].click = () => navigate('page-4');
  const emit = (type, extra = {}) => {
    const event = { target: el.about, button: 0, pointerId: 1, clientX: 200, clientY: 100, deltaX: 0, deltaY: 0, deltaMode: 0, preventDefault() { this.prevented = true; }, ...extra };
    (el.content.events[type] || events[type])(event); return event;
  };
  navigate('about');
  const tick = time => { now = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)); };
  const setPages = ids => { pageIds = ids; ids.forEach(id => { el[id] ||= new Element(id); }); window.HomePages.refresh(); window.HomePages.change(null, active); };
  return { el, window, document, media, animations, timers, frames, windowEvents, emit, navigate, tick, setPages, active: () => active, modal: value => { modal = value; }, time: value => { now = value; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('only foreground pages animate; fast reversals cancel old transitions cleanly', async () => {
  const h = fixture(); h.navigate('photos');
  assert.equal(h.animations.length, 2);
  assert.match(h.animations[1].frames[0].transform, /110%/);
  assert.equal(h.el.about.inert, true); assert.equal(h.el.photos.inert, false);
  h.navigate('about');
  assert.equal(h.animations[0].cancelled, true);
  h.animations.slice(2).forEach(a => a.finish()); await settle();
  assert.equal(h.el.photos.classes.has('is-active'), false);
  assert.equal(h.el.about.classes.has('is-active'), true);
  assert.equal(h.el.about.classes.has('page-sliding'), false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.el['pond-frame'].classes.size, 0);
});
test('horizontal swipe flips pages; vertical movement and controls do not', () => {
  const h = fixture({ reduced: true });
  h.emit('pointerdown'); h.emit('pointerup', { clientX: 110, clientY: 104 });
  assert.equal(h.active(), 'photos');
  h.emit('pointerdown'); h.emit('pointerup', { clientX: 280, clientY: 230 });
  assert.equal(h.active(), 'photos');
  h.emit('pointerdown'); h.emit('pointercancel'); h.emit('pointerup', { clientX: 300 });
  assert.equal(h.active(), 'photos');
  h.el.photos.blocked = true;
  h.emit('pointerdown', { target: h.el.photos }); h.emit('pointerup', { clientX: 300 });
  assert.equal(h.active(), 'photos');
  h.emit('keydown', { key: 'ArrowLeft' }); assert.equal(h.active(), 'about');
});
test('touchpad uses horizontal movement only and ignores wheel momentum', () => {
  const h = fixture({ reduced: true });
  assert.equal(h.emit('wheel', { deltaY: 200 }).prevented, undefined);
  assert.equal(h.active(), 'about');
  h.emit('wheel', { deltaX: 80 }); assert.equal(h.active(), 'photos');
  h.emit('wheel', { deltaX: -80 }); assert.equal(h.active(), 'photos');
  h.time(1000); h.emit('wheel', { deltaY: -90, shiftKey: true }); assert.equal(h.active(), 'about');
});
test('foreground controls cannot finish or inherit a card swipe', () => {
  const h = fixture({ reduced: true });
  h.el.photos.blocked = true;
  h.emit('pointerdown');
  h.emit('pointerup', { target: h.el.photos, clientX: 100 });
  assert.equal(h.active(), 'about');
  h.emit('pointerdown');
  h.emit('pointerdown', { target: h.el.photos });
  h.emit('pointerup', { clientX: 100 });
  assert.equal(h.active(), 'about');
  assert.equal(h.emit('wheel', { target: h.el.photos, deltaX: 100 }).prevented, undefined);
  h.emit('pointerdown'); h.emit('pointerup', { clientX: 100 });
  assert.equal(h.active(), 'photos');
});
test('dialogs, opening, layout editing and reduced motion are respected', () => {
  const h = fixture({ reduced: true });
  h.modal(true); h.emit('keydown', { key: 'ArrowRight' }); assert.equal(h.active(), 'about');
  h.modal(false);
  for (const name of ['intro-active', 'layout-editing', 'studio-open']) {
    h.el.body.classList.add(name); h.emit('keydown', { key: 'ArrowRight' }); assert.equal(h.active(), 'about'); h.el.body.classList.remove(name);
  }
  h.navigate('photos'); assert.equal(h.animations.length, 0);
  assert.equal(h.el['photos-page-link'].attrs['aria-current'], 'page');
});
test('watchdog and media change clear temporary animation layers', () => {
  const h = fixture(); h.navigate('photos');
  [...h.timers.values()][0](); assert.equal(h.el.about.classes.has('is-active'), false);
  h.navigate('about'); h.media.matches = true; h.media.change();
  assert.equal(h.el.photos.classes.has('is-active'), false);
  assert.equal(h.el.about.classes.has('page-sliding'), false);
});

test('four pages navigate in order, stop at edges and keep only one selected dot', () => {
  const h = fixture({ reduced: true });
  for (const expected of ['photos', 'page-3', 'page-4', 'page-4']) {
    h.emit('keydown', { key: 'ArrowRight' }); assert.equal(h.active(), expected);
  }
  const dots = h.el['home-pagination'].querySelectorAll();
  assert.equal(dots.filter(link => link.attrs['aria-current'] === 'page').length, 1);
  assert.equal(h.el['page-4-link'].attrs['aria-current'], 'page');
  for (const expected of ['page-3', 'photos', 'about', 'about']) {
    h.emit('keydown', { key: 'ArrowLeft' }); assert.equal(h.active(), expected);
  }
});

test('non-adjacent jumps use the correct slide direction and survive rapid reversal', async () => {
  const h = fixture(); h.navigate('page-4');
  assert.equal(h.animations[1].frames[0].transform, 'translateX(110%)');
  h.navigate('photos');
  assert.equal(h.animations[3].frames[0].transform, 'translateX(-110%)');
  h.navigate('page-3');
  h.animations.slice(-2).forEach(animation => animation.finish()); await settle();
  for (const id of ['about', 'photos', 'page-3', 'page-4']) {
    assert.equal(h.el[id].classes.has('is-active'), id === 'page-3');
    assert.equal(h.el[id].classes.has('page-sliding'), false);
  }
});

test('moving dot tracks every destination and never resets during interrupted transitions', async () => {
  const h = fixture(), nav = h.el['home-pagination'];
  assert.equal(nav.properties['--dot-x'], '16px');
  assert.equal(nav.classes.has('has-dot-indicator'), true);
  h.navigate('page-4'); h.tick(130);
  const interrupted = nav.properties['--dot-x'];
  assert.ok(parseFloat(interrupted) > 16 && parseFloat(interrupted) < 112);
  h.navigate('photos');
  assert.equal(nav.properties['--dot-x'], interrupted, 'retarget starts at the painted position');
  h.tick(260);
  assert.equal(nav.properties['--tail-direction'], '-1', 'tail follows actual travel, not the previous selected index');
  h.tick(650);
  assert.equal(nav.properties['--dot-x'], '48px');
  assert.equal(nav.properties['--tail-opacity'], '0');
  assert.equal(h.frames.size, 0);
  h.animations.slice(-2).forEach(animation => animation.finish()); await settle();
  h.navigate('tech'); assert.equal(h.frames.size, 0);
  h.navigate('page-4'); assert.equal(nav.properties['--dot-x'], '112px');
  h.navigate('photos'); h.tick(700);
  h.media.matches = true; h.media.change();
  assert.equal(nav.properties['--dot-x'], '48px');
  assert.equal(h.frames.size, 0);
});

test('every dot pair has the same progress, bounded tail and panel duration', () => {
  const ids = ['about', 'photos', 'page-3', 'page-4'];
  for (let from = 0; from < ids.length; from++) {
    for (let to = 0; to < ids.length; to++) {
      if (from === to) continue;
      const h = fixture(), nav = h.el['home-pagination'];
      h.document.hidden = true; h.navigate(ids[from]); h.document.hidden = false;
      h.navigate(ids[to]); h.tick(260);
      const expected = 16 + from * 32 + (to - from) * 32 * .875;
      assert.equal(parseFloat(nav.properties['--dot-x']), expected);
      assert.equal(nav.properties['--tail-width'], '14px');
      assert.equal(nav.properties['--tail-opacity'], '0.32');
      assert.equal(nav.properties['--tail-direction'], String(Math.sign(to - from)));
      assert.equal(h.animations.at(-1).options.duration, 520);
      h.tick(520);
      assert.equal(nav.properties['--dot-x'], `${16 + to * 32}px`);
      assert.equal(nav.properties['--tail-width'], '0px');
      assert.equal(h.frames.size, 0);
    }
  }
});

test('resize, page exit, hidden documents and reduced motion do not leave a trail', () => {
  const h = fixture(), nav = h.el['home-pagination'];
  h.navigate('photos'); h.tick(100); h.windowEvents.resize();
  assert.equal(nav.properties['--dot-x'], '48px');
  assert.equal(h.frames.size, 0);
  h.navigate('page-4'); h.tick(200); h.windowEvents.pagehide();
  assert.equal(nav.properties['--tail-opacity'], '0');
  assert.equal(h.frames.size, 0);
  h.navigate('photos'); h.document.hidden = true; h.emit('visibilitychange');
  assert.equal(h.frames.size, 0);
  h.document.hidden = false; h.media.matches = true;
  h.navigate('about');
  assert.equal(nav.properties['--dot-x'], '16px');
  assert.equal(h.frames.size, 0);
});

test('page registry supports additions, reordering and removals without fixed indices', () => {
  const h = fixture({ reduced: true }), nav = h.el['home-pagination'];
  const ids = ['about', 'photos', 'page-3', 'page-4', 'diy-gallery', 'my-notes'];
  h.setPages(ids);
  assert.deepEqual(Array.from(h.window.HomePages.ids), ids);
  assert.equal(nav.children.length, 6);
  assert.equal(nav.children[5].attrs['aria-label'], '切换到第 6 页');
  for (let i = 0; i < 5; i++) h.emit('keydown', { key: 'ArrowRight' });
  assert.equal(h.active(), 'my-notes');
  assert.equal(nav.properties['--dot-x'], '176px');
  assert.equal(nav.children.filter(link => link.attrs['aria-current'] === 'page').length, 1);
  h.setPages(['about', 'my-notes', 'diy-gallery', 'photos']);
  assert.equal(nav.children.length, 4);
  assert.equal(nav.properties['--dot-x'], '48px');
  h.emit('keydown', { key: 'ArrowRight' }); assert.equal(h.active(), 'diy-gallery');
  h.window.HomePages.ids.push('not-a-real-page');
  assert.equal(h.window.HomePages.ids.length, 4, 'external code cannot mutate the registry');
});

test('dot motion is refresh-rate independent and many pages keep the selected dot visible', () => {
  const sample = hz => {
    const h = fixture(); h.navigate('page-4');
    for (let time = 0; time < 200; time += 1000 / hz) h.tick(time);
    h.tick(200);
    return h.el['home-pagination'].properties;
  };
  assert.equal(sample(60)['--dot-x'], sample(144)['--dot-x']);
  assert.equal(sample(60)['--tail-width'], sample(144)['--tail-width']);
  const h = fixture({ reduced: true }), nav = h.el['home-pagination'];
  nav.clientWidth = 128;
  const ids = ['about', ...Array.from({ length: 11 }, (_, i) => 'custom-' + i)];
  h.setPages(ids); h.navigate('custom-10');
  assert.equal(nav.children.length, 12);
  assert.equal(nav.scrollLeft, 256);
  assert.equal(nav.properties['--dot-x'], '368px');
  h.navigate('about'); assert.equal(nav.scrollLeft, 0);
});
