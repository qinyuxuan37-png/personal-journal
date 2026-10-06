import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/photo-album.js', import.meta.url), 'utf8');
function fixture(exported = false) {
  const frames = new Map(), timers = new Map(), observers = [];
  let nextId = 0, now = 0;
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.classes = new Set();
      this.style = { setProperty: (name, value) => { this.style[name] = value; } };
      this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name), toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name) };
      this.clientWidth = 900; this.clientHeight = 420;
    }
    append(...items) { this.children.push(...items); }
    prepend(...items) { this.children.unshift(...items); }
    replaceChildren(...items) { this.children = items; }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    removeEventListener(name, callback) { if (this.listeners[name] === callback) delete this.listeners[name]; }
    setPointerCapture(id) { this.pointer = id; }
    hasPointerCapture(id) { return this.pointer === id; }
    releasePointerCapture() { this.pointer = null; }
    focus() {}
  }
  const strip = new Element('div'), count = new Element('span'), empty = new Element('p'), viewport = new Element('div');
  const root = { querySelector: selector => ({ '.album-strip': strip, '.album-count': count, '.album-empty': empty, '.album-viewport': viewport })[selector] };
  const media = new Element('media'); media.matches = false;
  const window = new Element('window'), document = new Element('document');
  Object.assign(window, {
    matchMedia: () => media,
    requestAnimationFrame: fn => { frames.set(++nextId, fn); return nextId; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: fn => { timers.set(++nextId, fn); return nextId; },
    clearTimeout: id => timers.delete(id),
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.kind = 'resize'; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; this.kind = 'intersection'; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    }
  });
  Object.assign(document, { hidden: false, documentElement: { hasAttribute: () => exported }, createElement: tag => new Element(tag) });
  vm.runInNewContext(source, { window, document });
  const emit = (type, extra = {}) => {
    const event = { button: 0, pointerId: 1, clientX: 200, deltaX: 0, deltaY: 0, deltaMode: 0,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    viewport.listeners[type]?.(event); return event;
  };
  const tick = () => { now += 16; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now)); };
  const settle = () => {
    const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());
    for (let i = 0; i < 250 && frames.size; i++) tick();
    assert.equal(frames.size, 0, 'no animation loop while idle');
  };
  return { strip, count, empty, viewport, media, window, document, frames, timers, observers, emit, tick, settle, pose: window.PhotoAlbum.pose, render: entries => window.PhotoAlbum.render(root, entries) };
}
function descendants(node, tag) {
  return [...(node.tag === tag ? [node] : []), ...node.children.flatMap(child => descendants(child, tag))];
}
const photo = (id, extra = {}) => ({ kind: 'gallery', data: { title: '照片 ' + id, image: id.repeat(32) + '.jpg', ...extra } });

test('empty album is nine transparent arc placeholders, not invented photos or clickable previews', () => {
  const app = fixture(); app.render([]);
  assert.equal(app.strip.children.length, 9);
  assert.equal(app.count.textContent, '0 张');
  assert.equal(app.empty.hidden, false);
  assert.equal(descendants(app.strip, 'img').length, 0);
  assert.equal(descendants(app.strip, 'button').length, 0);
  assert.ok(app.strip.children.every(node => node.attrs['aria-hidden'] === 'true'));
});

test('public album preserves chosen order and uses safe lazy images and literal captions', () => {
  const app = fixture(); app.render([photo('b', { title: '<script>example</script>', date: '2026-10-05' }), photo('a')]);
  assert.equal(app.count.textContent, '2 张');
  assert.equal(app.empty.hidden, true);
  const images = descendants(app.strip, 'img');
  assert.equal(images[0].src, '/media/public/' + 'b'.repeat(32) + '.jpg');
  assert.equal(images[1].src, '/media/public/' + 'a'.repeat(32) + '.jpg');
  assert.equal(images[0].loading, 'lazy');
  assert.equal(images[0].decoding, 'async');
  assert.equal(descendants(app.strip, 'strong')[0].textContent, '<script>example</script>');
  assert.equal(descendants(app.strip, 'time')[0].textContent, '2026.10.05');
  assert.equal(app.strip.children[0].tabIndex, 0);
  assert.deepEqual(app.strip.children[0].listeners, {}, 'no click-to-open interaction yet');
});

test('private entries, malformed data and external or traversing URLs are never displayed', () => {
  const app = fixture(); app.render([
    null, {}, { kind: 'photos', data: photo('a').data },
    photo('a', { image: '/media/private/' + 'a'.repeat(32) + '.jpg' }),
    photo('a', { image: 'https://example.com/photo.jpg' }),
    photo('a', { image: '../private/a.jpg' }), photo('b')
  ]);
  assert.equal(app.count.textContent, '1 张');
  assert.equal(descendants(app.strip, 'img').length, 1);
});

test('broken images keep their sheet geometry; updates remove stale images; export uses relative paths', () => {
  const app = fixture(true); app.render([photo('c')]);
  const img = descendants(app.strip, 'img')[0];
  assert.equal(img.src, './media/public/' + 'c'.repeat(32) + '.jpg');
  img.listeners.error();
  assert.equal(img.hidden, true);
  assert.equal(descendants(app.strip, 'span')[0].hidden, false);
  app.render([]);
  assert.equal(descendants(app.strip, 'img').length, 0);
  assert.equal(app.count.textContent, '0 张');
});

test('album styling and integration keep a translucent independent module with isolated gestures', () => {
  const css = readFileSync(new URL('../public/photo-album.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const navigation = readFileSync(new URL('../public/home-pages.js', import.meta.url), 'utf8');
  assert.match(css, /background: rgba\(6,20,23,\.23\)/);
  assert.match(css, /perspective: 1000px/);
  assert.doesNotMatch(css, /nth-child|--sheet-tilt/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(html, /data-space-module="photo-album"/);
  assert.match(navigation, /\[data-page-gesture-lock\]/);
  assert.doesNotMatch(source, /fetch\(|\/api\/private|innerHTML/);
});

const photos = () => Array.from({ length: 9 }, (_, i) => photo(String(i)));
const currentIndex = app => app.strip.children.findIndex(card => card.classes.has('is-current'));

test('approved first mockup uses a frontal center and mirrored receding sides', () => {
  const app = fixture();
  const center = app.pose(0, 900), left = app.pose(-3, 900), right = app.pose(3, 900);
  assert.equal(left.x, -right.x); assert.equal(left.y, right.y); assert.equal(left.z, right.z);
  assert.ok(left.y < center.y, 'ends sit higher than center: a shallow U');
  assert.ok(center.z > left.z && center.scale > left.scale, 'center protrudes');
  assert.ok(app.pose(1, 900).x < 128, 'adjacent sheets overlap rather than spacing apart');
  assert.equal(center.yaw, 0);
  assert.ok(left.yaw > 0 && right.yaw < 0, 'the two sides face inward, not in one common direction');
  assert.equal(left.yaw, -right.yaw);
  assert.equal(center.pitch, 2, 'use the approved first mockup, not the steep overhead variant');
});

test('approved arc progressively recedes without crowding or crossing at common viewport widths', () => {
  const app = fixture();
  for (const width of [320, 600, 900, 1100]) {
    let previous = app.pose(0, width);
    for (let offset = .25; offset <= 4; offset += .25) {
      const next = app.pose(offset, width);
      assert.ok(next.x > previous.x && next.y < previous.y);
      assert.ok(next.z < previous.z && next.scale < previous.scale);
      assert.ok(next.x < width / 2, 'side centers remain inside the module');
      previous = next;
    }
  }
});

test('wheel rotates and settles to the center, preserves zoom and contains page scroll', () => {
  const app = fixture(); app.render(photos());
  assert.equal(currentIndex(app), 0);
  const wheel = app.emit('wheel', { deltaY: 150 });
  assert.equal(wheel.prevented, true); assert.equal(wheel.stopped, true);
  app.settle(); assert.equal(currentIndex(app), 1);
  app.emit('wheel', { deltaX: -150 }); app.settle(); assert.equal(currentIndex(app), 0);
  assert.equal(app.emit('wheel', { ctrlKey: true, deltaY: 150 }).prevented, undefined);
  assert.equal(app.frames.size, 0);
});

test('dragging captures the pointer, rotates continuously and snaps on release or cancellation', () => {
  const app = fixture(); app.render(photos());
  app.emit('pointerdown'); assert.equal(app.viewport.pointer, 1);
  app.emit('pointermove', { clientX: 119 }); assert.equal(currentIndex(app), 1);
  app.emit('pointerup'); app.settle();
  assert.equal(app.viewport.pointer, null); assert.equal(currentIndex(app), 1);
  app.emit('pointerdown'); app.emit('pointermove', { clientX: 140 });
  app.emit('pointercancel'); app.settle();
  assert.equal(app.viewport.classes.has('is-dragging'), false);
  assert.equal(currentIndex(app), 2);
});

test('keyboard cycles an album; reduced motion, hidden documents and rerenders release work', () => {
  const app = fixture(); app.render(photos());
  const key = app.emit('keydown', { key: 'ArrowLeft' }); app.settle();
  assert.equal(key.stopped, true); assert.equal(currentIndex(app), 8);
  app.render(photos()); assert.equal(currentIndex(app), 8, 'refresh preserves the centered photo');
  app.media.matches = true; app.media.listeners.change();
  app.emit('keydown', { key: 'ArrowRight' }); assert.equal(currentIndex(app), 0);
  assert.equal(app.frames.size, 0);
  app.media.matches = false;
  app.emit('wheel', { deltaY: 150 });
  app.document.hidden = true; app.document.listeners.visibilitychange();
  assert.equal(app.frames.size, 0); assert.equal(app.timers.size, 0);
  app.document.hidden = false; app.emit('wheel', { deltaY: 150 });
  app.render([]); assert.equal(app.frames.size, 0); assert.equal(app.timers.size, 0);
});

test('one photo stays centered and small albums do not wrap duplicate images', () => {
  const app = fixture(); app.render([photo('a')]);
  assert.equal(currentIndex(app), 0);
  assert.equal(app.emit('wheel', { deltaY: 150 }).prevented, undefined);
  app.emit('pointerdown'); assert.equal(app.viewport.pointer, undefined);
  app.render([photo('a'), photo('b')]);
  app.emit('keydown', { key: 'ArrowLeft' }); app.settle(); assert.equal(currentIndex(app), 0);
  app.emit('keydown', { key: 'End' }); app.settle(); assert.equal(currentIndex(app), 1);
  assert.equal(app.strip.children.length, 2);
});

test('leaving the page stops rotation; resize changes spacing; replacing data disconnects observers', () => {
  const app = fixture(); app.render(photos());
  const before = app.strip.children[1].style.transform;
  app.viewport.clientWidth = 360;
  app.observers.find(observer => observer.kind === 'resize').callback();
  assert.notEqual(app.strip.children[1].style.transform, before);
  app.emit('wheel', { deltaY: 150 }); app.tick();
  const visibility = app.observers.find(observer => observer.kind === 'intersection');
  visibility.callback([{ isIntersecting: false }]);
  assert.equal(app.frames.size, 0); assert.equal(app.timers.size, 0);
  visibility.callback([{ isIntersecting: true }]);
  app.emit('keydown', { key: 'ArrowRight' }); app.settle();
  const oldObservers = app.observers.slice();
  app.render([]);
  assert.ok(oldObservers.every(observer => observer.disconnected));
  assert.equal(app.frames.size, 0);
});
