import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
const script = readFileSync(new URL('../public/music-wall.js', import.meta.url), 'utf8');
function fixture(exported = false, keepEntrance = false, samplePixels = null) {
  const animations = [], sampling = [], frames = new Map(); let frameId = 0, focused, now = 0;
  class Node {
    constructor(tag) {
      this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.clientWidth = 1100; this.clientHeight = 620;
      this.style = { setProperty: (k, v) => { this.style[k] = v; } }; this.classes = new Set();
      this.classList = { toggle: (k, v) => v ? this.classes.add(k) : this.classes.delete(k) };
    }
    append(...items) { for (const item of items) item.parent = this; this.children.push(...items); }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    closest(selector) {
      for (let node = this; node; node = node.parent) {
        if (selector.startsWith('.') ? node.classes.has(selector.slice(1)) || (node.className || '').split(/\s+/).includes(selector.slice(1)) : node.tag === selector) return node;
      }
      return null;
    }
    addEventListener(k, v) { this.events[k] = v; }
    focus() { focused = this; }
    getBoundingClientRect() {
      const parent = this.parent?.getBoundingClientRect() || { left: 0, top: 0, scale: 1 };
      const transform = this.visualTransform || this.style.transform || '';
      const translated = /translate\((-?[\d.]+(?:e[+-]?\d+)?)px, (-?[\d.]+(?:e[+-]?\d+)?)px\)/i.exec(transform);
      const scale = parent.scale * Number(/scale\(([\d.]+)\)/.exec(transform)?.[1] || 1);
      const left = parent.left + ((parseFloat(this.style.left) || 0) + Number(translated?.[1] || 0)) * parent.scale;
      const top = parent.top + ((parseFloat(this.style.top) || 0) + Number(translated?.[2] || 0)) * parent.scale;
      const width = (this.visualSize?.width ?? (parseFloat(this.style.width) || this.clientWidth)) * scale;
      const height = (this.visualSize?.height ?? (parseFloat(this.style.height) || this.clientHeight)) * scale;
      return { left, top, width, height, bottom: top + height, scale };
    }
    animate(frames, options) {
      let resolve, reject;
      const node = this;
      const clear = animation => {
        if (node.currentAnimation === animation) { node.visualTransform = ''; node.visualSize = null; node.currentAnimation = null; }
      };
      const animation = {
        node, frames, options, canceled: false, finished: new Promise((a, b) => { resolve = a; reject = b; }),
        cancel() { this.canceled = true; clear(this); reject(); },
        finish() { this.complete = true; clear(this); resolve(); },
        sample(progress) {
          const endIndex = frames.findIndex(frame => frame.offset >= progress), end = frames[Math.max(1, endIndex)], start = frames[Math.max(0, endIndex - 1)];
          const t = (progress - start.offset) / (end.offset - start.offset);
          const values = frame => [...frame.transform.matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)].map(match => Number(match[0]));
          const a = values(start), b = values(end), v = a.map((n, i) => n + (b[i] - n) * t);
          node.visualTransform = 'translate(' + v[0] + 'px, ' + v[1] + 'px)';
          node.visualSize = Object.fromEntries(['width', 'height'].map(k => [k, parseFloat(start[k]) + (parseFloat(end[k]) - parseFloat(start[k])) * t]));
        }
      };
      node.currentAnimation = animation; animation.sample(0);
      animations.push(animation); return animation;
    }
  }
  const root = new Node('div'), status = new Node('p'), page = new Node('section');
  const document = new Node('document'); document.hidden = false;
  document.timeline = { get currentTime() { return now; } };
  document.documentElement = { hasAttribute: () => exported };
  document.getElementById = id => ({ 'music-wall': root, 'music-wall-status': status, music: page })[id];
  document.createElement = tag => {
    const node = new Node(tag);
    if (tag === 'canvas' && samplePixels !== null) {
      let image;
      node.getContext = (type, options) => ({
        drawImage(img, ...bounds) { image = img; sampling.push({ canvas: node, image: img, bounds, type, options }); },
        getImageData(...bounds) {
          assert.deepEqual(bounds, [0, 0, 16, 16]);
          if (samplePixels instanceof Error) throw samplePixels;
          return { data: typeof samplePixels === 'function' ? samplePixels(image) : samplePixels };
        }
      });
    }
    return node;
  };
  const media = new Node('media'); media.matches = false;
  const window = new Node('window'); window.matchMedia = () => media; window.performance = { now: () => now };
  window.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
  window.cancelAnimationFrame = id => frames.delete(id);
  let observer;
  window.ResizeObserver = class { constructor(fn) { observer = fn; } observe() {} };
  vm.runInNewContext(script, { document, window, URL });
  // Geometry/camera tests start after the one-shot entrance. Dedicated entrance
  // tests opt into its real intermediate bounds, rather than mixing two clocks.
  const finishEntrance = () => {
    if (keepEntrance) return;
    for (let i = animations.length - 1; i >= 0; i--) if (animations[i].frames[0].opacity !== undefined) {
      animations[i].finish(); animations.splice(i, 1);
    }
  };
  return { ...window.MusicWall,
    render(items) { window.MusicWall.render(items); finishEntrance(); },
    setActive(value) { window.MusicWall.setActive(value); finishEntrance(); },
    root, status, page, document, window, media, frames, animations, sampling, resize: () => observer(), focused: () => focused,
    step(time) { now = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)); } };
}
const song = (i, data = {}) => ({ id: String(i), kind: 'music', data: { title: '曲目 ' + i, artist: '音乐人', image: 'a'.repeat(32) + '.jpg', url: 'https://example.com/song', ...data } });
const find = (node, tag) => [...(node.tag === tag ? [node] : []), ...node.children.flatMap(c => find(c, tag))];
const geometry = h => find(h.root, 'article').map(n => ['left', 'top', 'width', 'height'].map(k => n.style[k]));
const cameraOf = h => [...h.root.children[0].style.transform.matchAll(/-?\d+(?:\.\d+)?/g)].slice(0, 2).map(m => -Number(m[0]) / h.viewScale || 0);
const different = (a, b) => ['x', 'y', 'w', 'h'].some(k => Math.abs(a[k] - b[k]) > .01);
const mixBoxes = (from, to, t) => from.map((b, i) => Object.fromEntries(['x', 'y', 'w', 'h'].map(k => [k, b[k] + (to[i][k] - b[k]) * t])));
const pixels = (rgb, count = 256, alpha = 255) => Array.from({ length: count }, () => [...rgb, alpha]).flat();
const ambienceOf = h => h.root.children.find(n => n.className === 'music-ambience');
const glowOf = h => ['r', 'g', 'b'].map(c => Number(ambienceOf(h).style['--music-glow-' + c] ?? ({ r: 110, g: 158, b: 145 })[c]));
const loaded = image => { image.complete = true; image.naturalWidth = 600; image.events.load(); };
function assertDisjoint(boxes, context) {
  boxes.forEach((b, i) => boxes.slice(i + 1).forEach((c, j) => {
    assert.ok(b.w > 0 && b.h > 0 && c.w > 0 && c.h > 0, 'no collapsed covers');
    const overlapW = Math.min(b.x + b.w, c.x + c.w) - Math.max(b.x, c.x);
    const overlapH = Math.min(b.y + b.h, c.y + c.h) - Math.max(b.y, c.y);
    assert.ok(overlapW < .01 || overlapH < .01, context + ': ' + i + '/' + (i + j + 1));
  }));
}
function assertShapes(plan) {
  const pitch = plan.unit + plan.gap;
  plan.boxes.forEach((b, i) => {
    if (i === plan.focus) { assert.equal(b.w, plan.big); assert.equal(b.h, plan.big); }
    else {
      assert.ok(b.w * b.h < plan.big ** 2, 'focus is always the largest area');
      if (Math.abs(b.w - b.h) < .01) assert.ok(Math.abs(b.w - plan.unit) < .01, 'small squares use exactly one unit');
    }
    for (const side of [b.w, b.h]) {
      const cells = (side + plan.gap) / pitch;
      assert.ok(cells >= 1 - .00001 && cells <= 3 + .00001, 'no narrow fractional fragments');
      const tiers = [1, 1.5, 2, 3];
      assert.ok(tiers.some(tier => Math.abs(cells - tier) < .00001), 'finite size tiers, never arbitrary random cuts');
    }
    if (i !== plan.focus) {
      const short = Math.min(b.w, b.h);
      assert.ok(Math.abs(short - plan.unit) < .01 || Math.abs(short - (pitch * 2 - plan.gap)) < .01, 'only one reference 3x2 landscape may have a two-unit short side');
    }
  });
}
test('lattice end states have one common focus, bounded size tiers and uniform gutters', () => {
  const h = fixture();
  for (const [width, height] of [[280, 420], [390, 620], [560, 620], [1100, 620], [1678, 936], [2560, 1440]]) {
    const capacity = h.capacity(width, height);
    for (const count of [1, 2, 4, 16, capacity, capacity + 15]) {
      const initial = h.layout(count, 0, width, height);
      for (const focus of [...new Set([0, 1, 3, 8, count - 1].filter(i => i < count))]) {
        const plan = h.layout(count, focus, width, height);
        assert.equal(plan.boxes.length, count); assert.equal(plan.focus, focus);
        assert.ok(Math.abs(plan.gap * h.viewScale - 4) < .01, 'reference-sized screen gutter');
        assert.ok(plan.big * h.viewScale <= Math.min(width, height) + .01, 'focus remains visible on portrait and ultrawide screens');
        assert.ok(plan.width > width && plan.height > height, 'world is bigger than viewport');
        assert.deepEqual(plan.boxes[focus], initial.focusSlot, 'all covers move into the same focus slot');
        assert.deepEqual(plan.base, initial.boxes);
        assertShapes(plan); assertDisjoint(plan.boxes, 'settled lattice');
        plan.boxes.forEach((b, i) => {
          assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= plan.width + .01 && b.y + b.h <= plan.height + .01);
          plan.boxes.slice(i + 1).forEach(c => {
            const dx = Math.max(b.x - c.x - c.w, c.x - b.x - b.w), dy = Math.max(b.y - c.y - c.h, c.y - b.y - b.h);
            assert.ok(dx >= plan.gap - .01 || dy >= plan.gap - .01, 'uniform gutter');
          });
        });
      }
    }
  }
  const reference = h.layout(h.capacity(1678, 936), 0, 1678, 936);
  assert.ok(reference.big * h.viewScale / 1678 < .34 && reference.big * h.viewScale / 936 > .5, 'reference-sized viewport keeps balanced focus proportions');
  const desktop = h.layout(h.capacity(1100, 620), 0, 1100, 620);
  assert.ok(desktop.big < 390, 'not the old screen-filling giant square');
});
test('entering the music route pops each visible cover around its center, from left to right with one mild rebound', async () => {
  const h = fixture(false, true); h.render([]); assert.equal(h.animations.length, 0); h.setActive(true);
  const nodes = find(h.root, 'article'), intro = h.animations.slice(), before = geometry(h), canvas = h.root.children[0].style.transform;
  assert.equal(intro.length, 23, 'animate the visible reference window, not all offscreen covers');
  assert.equal(nodes.filter(n => n.classes.has('is-entering')).length, 23);
  assert.ok(nodes.slice(23).every(n => !n.classes.has('is-entering')));
  assert.ok(intro.find(a => a.node === nodes[1]).options.delay < intro.find(a => a.node === nodes[0]).options.delay);
  assert.ok(intro.find(a => a.node === nodes[0]).options.delay < intro.find(a => a.node === nodes[16]).options.delay);
  for (const a of intro) {
    const w = parseFloat(a.node.style.width), ht = parseFloat(a.node.style.height);
    assert.equal(a.options.duration, 440); assert.ok(a.options.delay >= 0 && a.options.delay <= 280);
    assert.equal(a.options.fill, 'backwards', 'delayed covers cannot flash at full size before they enter');
    assert.equal(a.startTime, 0);
    assert.deepEqual(Array.from(a.frames, f => f.offset), [0, .68, .86, 1]);
    assert.equal(a.frames[0].opacity, 0); assert.equal(a.frames.at(-1).opacity, 1);
    assert.ok(parseFloat(a.frames[0].width) < w && parseFloat(a.frames[1].width) > w && parseFloat(a.frames[2].width) < w);
    for (const f of a.frames) {
      const [x, y] = [...f.transform.matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)].map(m => Number(m[0]));
      assert.ok(Math.abs(x + parseFloat(f.width) / 2 - w / 2) < .001 && Math.abs(y + parseFloat(f.height) / 2 - ht / 2) < .001, 'each tile keeps its own center');
      assert.doesNotMatch(f.transform, /scale/); assert.ok(parseFloat(f.width) > 0 && parseFloat(f.height) > 0);
    }
    a.finish();
  }
  await Promise.resolve();
  assert.deepEqual(geometry(h), before); assert.equal(h.root.children[0].style.transform, canvas);
  assert.ok(nodes.every(n => !n.classes.has('is-entering'))); assert.equal(h.frames.size, 0);
});
test('repeat activation and ordinary refresh do not replay the entrance; a fresh visit does', async () => {
  const h = fixture(false, true); h.render([]); h.setActive(true);
  const count = h.animations.length;
  h.setActive(true); assert.equal(h.animations.length, count); assert.ok(h.animations.every(a => !a.canceled), 'duplicate route notifications cannot cut the pop short');
  h.animations.forEach(a => a.finish()); await Promise.resolve();
  h.setActive(true); assert.equal(h.animations.length, count);
  h.render([]); assert.equal(h.animations.length, count);
  h.setActive(false); h.setActive(true); assert.equal(h.animations.length, count * 2);
  h.setActive(false); await Promise.resolve();
  assert.ok(h.animations.every(a => a.complete || a.canceled));
  assert.ok(find(h.root, 'article').every(n => !n.classes.has('is-entering')));
});
test('clicking during the entry rebound retargets from every current visual bound without jumping or replaying opacity', async () => {
  const h = fixture(false, true); h.render([]); h.setActive(true);
  const nodes = find(h.root, 'article'), intro = h.animations.slice(); intro.forEach(a => a.sample(.5));
  const before = nodes.map(n => n.getBoundingClientRect()); find(h.root, 'button')[12].events.click();
  const start = nodes.map(n => n.getBoundingClientRect()), exchange = h.animations.slice(intro.length);
  before.forEach((b, i) => ['left', 'top', 'width', 'height'].forEach(k => assert.ok(Math.abs(b[k] - start[i][k]) < .01, 'entry click must not jump: ' + i + '/' + k)));
  assert.ok(intro.every(a => a.canceled)); assert.ok(exchange.length > 0);
  exchange.forEach(a => { assert.equal(a.options.duration, 680); assert.equal(a.frames[0].opacity, undefined); a.finish(); });
  await Promise.resolve();
  assert.ok(nodes.every(n => !n.classes.has('is-entering') && !n.classes.has('is-moving')));
  assert.equal(find(h.root, 'button')[12].attrs['aria-pressed'], 'true');
});
test('entry respects hidden pages, resize, reduced motion and unavailable animations, including data arriving after the route opens', async () => {
  const delayed = fixture(false, true); delayed.setActive(true); assert.equal(delayed.animations.length, 0);
  delayed.render([]); assert.equal(delayed.animations.length, 23, 'wait for real tile geometry before entering');
  delayed.root.clientWidth = 1678; delayed.root.clientHeight = 936; delayed.resize(); delayed.step(16);
  assert.equal(delayed.animations.length, 23); assert.ok(delayed.animations.every(a => a.canceled));
  const hidden = fixture(false, true); hidden.render([]); hidden.setActive(true); hidden.document.hidden = true; hidden.document.events.visibilitychange();
  assert.ok(hidden.animations.every(a => a.canceled)); hidden.document.hidden = false; hidden.document.events.visibilitychange();
  assert.equal(hidden.animations.length, 23, 'tab restoration never replays a surprise entrance');
  const reduced = fixture(false, true); reduced.media.matches = true; reduced.render([]); reduced.setActive(true); assert.equal(reduced.animations.length, 0);
  const unavailable = fixture(false, true); unavailable.render([]); find(unavailable.root, 'article').forEach(n => { n.animate = undefined; }); unavailable.setActive(true);
  assert.equal(unavailable.animations.length, 0); assert.ok(find(unavailable.root, 'article').every(n => !n.classes.has('is-entering')));
  await Promise.resolve(); assert.equal(hidden.frames.size, 0); assert.equal(delayed.frames.size, 0);
});
test('own-cover images load the whole visible window eagerly but keep offscreen images lazy and accept no external/private image source', () => {
  const h = fixture(false, true), items = Array.from({ length: 61 }, (_, i) => song(i)); h.render(items); h.setActive(true);
  const images = find(h.root, 'img'); assert.equal(images.length, 61);
  assert.ok(images.slice(0, 23).every(img => img.loading === 'eager' && img.decoding === 'async'));
  assert.ok(images.slice(23).every(img => img.loading === 'lazy'));
  assert.ok(images.every(img => img.src === '/media/public/' + 'a'.repeat(32) + '.jpg'));
  h.render([song(1, { image: 'https://example.com/cover.jpg' }), song(2, { image: '../private/cover.png' })]);
  assert.equal(find(h.root, 'img').length, 0);
});
test('a synthetic playlist displays every song once, including shared album artwork, with no listening links', () => {
  const manifest = { tracks: Array.from({ length: 13 }, (_, i) => ({ trackId: i + 1, albumId: i === 10 ? 9 : i + 1, title: 'Test song ' + i, artist: 'Test artist', album: 'Test album' })) };
  assert.equal(manifest.tracks.length, 13); assert.equal(new Set(manifest.tracks.map(t => t.trackId)).size, 13);
  assert.equal(new Set(manifest.tracks.map(t => t.albumId)).size, 12);
  const items = manifest.tracks.map(t => ({ id: String(t.trackId), kind: 'music', data: {
    title: t.title, artist: t.artist, album: t.album, image: String(t.albumId).padStart(32, '0') + '.jpg', url: ''
  } }));
  const h = fixture(); h.render(items); h.setActive(true);
  assert.equal(find(h.root, 'article').length, 13); assert.equal(find(h.root, 'img').length, 13);
  const titles = find(h.root, 'strong').map(n => n.textContent);
  assert.deepEqual(titles, manifest.tracks.map(t => t.title));
  const images = find(h.root, 'img'); assert.equal(images[8].src, images[10].src);
  assert.equal(titles[8], 'Test song 8'); assert.equal(titles[10], 'Test song 10');
  find(h.root, 'button')[12].events.click();
  assert.equal(find(h.root, 'button')[12].attrs['aria-pressed'], 'true');
  assert.ok(find(h.root, 'a').every(link => link.hidden && !link.getAttribute('href')));
});
test('one reference-sized 9x5 window is centered inside the larger zoomed panorama', () => {
  const h = fixture(); h.render([]); h.setActive(true);
  assert.equal(h.viewScale, 1.12);
  const count = h.capacity(1100, 620), plan = h.layout(count, 0, 1100, 620);
  assert.ok(Math.abs(plan.big * h.viewScale - (Math.max(1100 / 9, 620 / 5) * 3 - 4)) < .01, 'focus uses the reference frame ratio, not viewport-dependent packing');
  assert.equal(plan.templateCount, 23);
  assert.ok(Math.abs(plan.templateFrame.w / plan.templateFrame.h - 9 / 5) < .001);
  const selected = find(h.root, 'article')[0].getBoundingClientRect();
  assert.ok(Math.abs(selected.left + selected.width / 2 - 550) < .01);
  assert.ok(Math.abs(selected.top + selected.height / 2 - 310) < .01);
  assert.equal(selected.width, plan.big * h.viewScale);
  assert.ok(1100 * 620 / h.viewScale ** 2 < 1100 * 620, 'less world area fits in the same screen');
  assert.ok(find(h.root, 'article')[1].getBoundingClientRect().width > plan.unit, 'non-focus covers are actually brought closer');
  const [x, y] = cameraOf(h);
  assert.ok(x > 0 && y > 0 && x + 1100 / h.viewScale < plan.width && y + 620 / h.viewScale < plan.height);
});
test('zoomed drag and wheel preserve screen-space tracking in both axes', () => {
  const h = fixture(); h.render([]); h.setActive(true);
  const node = find(h.root, 'article')[0], before = node.getBoundingClientRect();
  h.root.events.pointerdown({ button: 0, pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 300, target: h.root });
  h.root.events.pointermove({ pointerId: 1, pointerType: 'touch', clientX: 350, clientY: 340 });
  const dragged = node.getBoundingClientRect();
  assert.ok(Math.abs(dragged.left - before.left - 50) < .01);
  assert.ok(Math.abs(dragged.top - before.top - 40) < .01);
  h.root.events.pointerup({ type: 'pointerup', pointerId: 1, clientX: 350, clientY: 340 });
  assert.equal(h.frames.size, 0);
  h.root.events.wheel({ deltaX: 0, deltaY: 30, deltaMode: 0, preventDefault() {} });
  const scrolled = node.getBoundingClientRect();
  assert.ok(Math.abs(scrolled.top - dragged.top + 30) < .01);
  h.root.events.wheel({ deltaX: 0, deltaY: 20, deltaMode: 0, shiftKey: true, preventDefault() {} });
  assert.ok(Math.abs(node.getBoundingClientRect().left - scrolled.left + 20) < .01);
});
test('position follow reacts to tiny central movement, reaches a finite target and stops instead of drifting', () => {
  const h = fixture(); h.render([]); h.setActive(true);
  h.root.events.pointerenter({ pointerType: 'mouse', clientX: 550, clientY: 310 });
  const initial = cameraOf(h);
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 554, clientY: 310 });
  assert.deepEqual(cameraOf(h), initial, 'short smoothing, never an instantaneous jump');
  h.step(0); assert.ok((cameraOf(h)[0] - initial[0]) * h.viewScale > .35, 'first frame responds inside the former dead zone');
  for (let t = 16; t <= 1000; t += 16) h.step(t);
  const settled = cameraOf(h);
  assert.ok(settled[0] > initial[0]); assert.equal(settled[1], initial[1]); assert.equal(h.frames.size, 0);
  h.step(10000); assert.deepEqual(cameraOf(h), settled, 'holding the pointer does not keep scrolling');
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 550, clientY: 310 });
  for (let t = 10016; t <= 11000; t += 16) h.step(t);
  assert.deepEqual(cameraOf(h), initial, 'returning to the same pointer position returns the same camera target');
  assert.equal(h.frames.size, 0);
  const cameraCode = script.slice(script.indexOf('function paintCamera'), script.indexOf("root.addEventListener('pointerenter'"));
  assert.doesNotMatch(cameraCode, /pausedUntil|cameraMove|camera\.v[xy]|const edge =/);
});
test('follow amplitude is reduced by 30% with a softer first frame, without adding a dead zone or delay', () => {
  const h = fixture(); h.render([]); h.setActive(true);
  h.root.events.pointerenter({ pointerType: 'mouse', clientX: 550, clientY: 310 });
  const initial = cameraOf(h)[0], maximum = parseFloat(h.root.children[0].style.width) - 1100 / h.viewScale;
  const fullTravel = (maximum - initial) * (850 / 1100 * 2 - 1);
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 850, clientY: 310 }); h.step(0);
  const oldFirstFrame = fullTravel * (1 - Math.exp(-16 / 50)), firstFrame = cameraOf(h)[0] - initial;
  assert.ok(firstFrame > oldFirstFrame * .4 && firstFrame < oldFirstFrame * .7, 'responds immediately but no longer snaps as strongly');
  for (let t = 16; t <= 1000; t += 16) h.step(t);
  assert.ok(Math.abs(cameraOf(h)[0] - initial - fullTravel * .7) < .001, 'lower sensitivity changes travel, not merely delayed pursuit');
  assert.equal(h.frames.size, 0);
});
test('position response is time-based at 30/60/120fps; reversing a target never teleports the camera', () => {
  const at = fps => {
    const interval = 1000 / fps;
    const h = fixture(); h.render([]); h.setActive(true);
    h.root.events.pointerenter({ pointerType: 'mouse', clientX: 550, clientY: 310 });
    h.root.events.pointermove({ pointerType: 'mouse', clientX: 900, clientY: 470 });
    h.step(0);
    for (let step = 1; step <= fps / 5; step++) h.step(step * interval);
    const position = cameraOf(h), canvas = h.root.children[0], before = canvas.style.transform;
    h.root.events.pointermove({ pointerType: 'mouse', clientX: 200, clientY: 150 });
    assert.equal(canvas.style.transform, before);
    h.step(200 + interval);
    assert.ok(cameraOf(h)[0] < position[0] && cameraOf(h)[1] < position[1]);
    return position;
  };
  const fast = at(120), normal = at(60), slow = at(30);
  fast.forEach((n, i) => { assert.ok(Math.abs(n - normal[i]) < .001); assert.ok(Math.abs(n - slow[i]) < .001); });
});
test('drag and wheel establish a new follow origin, avoiding jumps or a return to the old camera', () => {
  const h = fixture(); h.render([]); h.setActive(true);
  h.root.events.pointerenter({ pointerType: 'mouse', clientX: 550, clientY: 310 });
  h.root.events.pointerdown({ button: 0, pointerId: 1, pointerType: 'mouse', clientX: 550, clientY: 310, target: h.root });
  h.root.events.pointermove({ pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 280 });
  h.root.events.pointerup({ type: 'pointerup', pointerId: 1, clientX: 500, clientY: 280 });
  const dragged = cameraOf(h);
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 500, clientY: 280 });
  assert.deepEqual(cameraOf(h), dragged); assert.equal(h.frames.size, 0);
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 510, clientY: 290 });
  h.step(0); assert.ok(cameraOf(h)[0] > dragged[0] && cameraOf(h)[1] > dragged[1]);
  h.root.events.wheel({ deltaX: 30, deltaY: 20, deltaMode: 0, clientX: 510, clientY: 290, preventDefault() {} });
  const wheeled = cameraOf(h); assert.equal(h.frames.size, 0);
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 510, clientY: 290 });
  assert.deepEqual(cameraOf(h), wheeled); assert.equal(h.frames.size, 0);
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 515, clientY: 295 });
  h.step(16); assert.ok(cameraOf(h)[0] > wheeled[0] && cameraOf(h)[1] > wheeled[1]);
});
test('dense preview cells tile the whole world exactly, across every selection variant and screen size', () => {
  const h = fixture();
  for (const [width, height] of [[390, 620], [1100, 620], [1130, 882], [1678, 936], [2560, 1440]]) {
    const count = h.capacity(width, height);
    for (const focus of [0, 1, 2, 3, 13, count - 1]) {
      const plan = h.layout(count, focus, width, height);
      assertDisjoint(plan.cells, 'complete cells');
      const area = plan.cells.reduce((sum, r) => sum + r.w * r.h, 0);
      assert.ok(Math.abs(area - plan.width * plan.height) < .001, 'no abandoned holes anywhere, not merely at focus');
      assertShapes(plan);
    }
  }
});
test('the 23-cover landscape window matches the supplied frame, with populated space on every side', () => {
  const h = fixture();
  const expected = [
    [3, 1, 3, 3], [0, 0, 2, 1], [2, 0, 2, 1], [4, 0, 1, 1], [5, 0, 1, 1], [6, 0, 3, 2],
    [0, 1, 1, 1.5], [0, 2.5, 1, 1.5], [1, 1, 2, 1], [1, 2, 1, 1], [2, 2, 1, 1], [1, 3, 1, 1], [2, 3, 1, 1],
    [6, 2, 1, 1], [6, 3, 1, 1], [7, 2, 1, 2], [8, 2, 1, 2],
    [0, 4, 1.5, 1], [1.5, 4, 3, 1], [4.5, 4, 1.5, 1], [6, 4, 1, 1], [7, 4, 1, 1], [8, 4, 1, 1]
  ];
  for (const [width, height] of [[390, 620], [1100, 620], [1678, 936], [2560, 1440]]) {
    const count = h.capacity(width, height), plan = h.layout(count, 0, width, height), isSmall = b => Math.abs(b.w - plan.unit) < .01 && Math.abs(b.h - plan.unit) < .01;
    assert.equal(count, 61, '23 is the visible template count, never the whole canvas');
    assert.equal(plan.boxes.slice(1, 23).filter(isSmall).length, 11);
    const pitch = plan.unit + plan.gap, frame = plan.templateFrame;
    expected.forEach(([x, y, w, ht], i) => {
      const b = plan.cells[i];
      assert.ok(Math.abs((b.x - frame.x) / pitch - x) < .001);
      assert.ok(Math.abs((b.y - frame.y) / pitch - y) < .001);
      assert.ok(Math.abs(b.w / pitch - w) < .001 && Math.abs(b.h / pitch - ht) < .001, 'every individual reference slot retains its measured geometry');
    });
    assert.ok(Math.abs(plan.cells.slice(0, 23).reduce((sum, b) => sum + b.w * b.h, 0) - frame.w * frame.h) < .001);
    const exterior = plan.cells.slice(23);
    assert.ok(exterior.some(b => b.x < frame.x) && exterior.some(b => b.x >= frame.x + frame.w));
    assert.ok(exterior.some(b => b.y < frame.y) && exterior.some(b => b.y >= frame.y + frame.h), 'all four edges lead to populated offscreen space');
    const after = h.layout(count, count - 1, width, height, plan);
    plan.order.forEach((cover, slot) => {
      if (slot >= 23 && cover !== count - 1) assert.deepEqual(after.boxes[cover], plan.boxes[cover], 'exterior does not move just to reset the screenshot');
    });
    assertShapes(after); assertDisjoint(after.cells, 'square-enriched exterior');
    assert.ok(Math.abs(after.cells.reduce((sum, b) => sum + b.w * b.h, 0) - after.width * after.height) < .001, 'still fills the whole world');
  }
});
test('the first landscape view shows 23 covers, and all four directions reveal additional offscreen covers', () => {
  const visible = h => find(h.root, 'article').map((node, i) => ({ b: node.getBoundingClientRect(), i }))
    .filter(({ b }) => b.left < 1100 && b.left + b.width > 0 && b.top < 620 && b.top + b.height > 0).map(({ i }) => i);
  for (const [dx, dy] of [[-400, 0], [400, 0], [0, -250], [0, 250]]) {
    const h = fixture(); h.render([]); h.setActive(true);
    assert.deepEqual(visible(h), Array.from({ length: 23 }, (_, i) => i), 'match the reference view without shrinking the full world onto one screen');
    const before = cameraOf(h);
    h.root.events.wheel({ deltaX: dx, deltaY: dy, deltaMode: 0, preventDefault() {} });
    assert.notDeepEqual(cameraOf(h), before);
    assert.ok(visible(h).some(i => i >= 23), 'pan into populated space, not an empty background');
    assert.equal(find(h.root, 'article').length, 61, 'panning never creates fake songs or duplicate preview nodes');
  }
});
test('directional local patches change whole adjacent rectangles while leaving the wide landmark in place', () => {
  const h = fixture(), count = h.capacity(1100, 620), initial = h.layout(count, 0, 1100, 620), pitch = initial.unit + initial.gap;
  const fromLeft = h.layout(count, 10, 1100, 620, initial), fromRight = h.layout(count, 13, 1100, 620, initial);
  assert.ok(Math.abs(fromLeft.slots[8].h / pitch - 2) < .001 && Math.abs(fromLeft.slots[8].w / pitch - 1) < .001);
  assert.ok(Math.abs(fromRight.slots[15].w / pitch - 2) < .001 && Math.abs(fromRight.slots[15].h / pitch - 1) < .001);
  assert.deepEqual(fromLeft.slots[5], initial.slots[5]); assert.deepEqual(fromRight.slots[5], initial.slots[5]);
  assert.deepEqual(fromLeft.focusSlot, initial.focusSlot); assert.deepEqual(fromRight.focusSlot, initial.focusSlot);
  assertDisjoint(fromLeft.cells, 'left-driven patch'); assertDisjoint(fromRight.cells, 'right-driven patch');
});
test('sparse real collections keep a unique small departure cover without inventing records', () => {
  const h = fixture();
  for (let count = 2; count < 23; count++) {
    let plan = h.layout(count, 0, 1100, 620);
    for (let step = 1; step <= 30; step++) {
      const next = step * 7 % count, previous = plan.focus;
      plan = h.layout(count, next, 1100, 620, plan);
      assert.equal(plan.boxes.length, count); assert.equal(new Set(plan.order).size, count);
      assertShapes(plan); assertDisjoint(plan.cells, 'sparse collection');
      if (next !== previous) assert.ok(Math.abs(plan.boxes[previous].w - plan.unit) < .01 && Math.abs(plan.boxes[previous].h - plan.unit) < .01);
    }
  }
});
test('cuts follow the clicked position; only local neighbors and the selected exterior cover move', () => {
  const h = fixture(), count = h.capacity(1100, 620);
  const initial = h.layout(count, 0, 1100, 620), exits = new Set();
  for (let a = 0; a < count; a++) for (let b = 0; b < count; b++) {
    const from = h.layout(count, a, 1100, 620, initial), to = h.layout(count, b, 1100, 620, from);
    const changed = from.boxes.map((r, i) => different(r, to.boxes[i]) ? i : -1).filter(i => i >= 0);
    assert.ok(changed.length <= 12, 'never repack the whole wall');
    from.order.forEach((cover, slot) => {
      if (slot >= 23 && cover !== b) assert.deepEqual(from.boxes[cover], to.boxes[cover], 'exterior ownership is not reset');
    });
    assert.deepEqual(from.boxes[a], to.boxes[b], 'focus position never follows random seeds');
    assert.equal(new Set(to.order).size, count, 'one slot per identity, no duplicates');
    if (a !== b) {
      assert.ok(Math.abs(to.boxes[a].w - to.unit) < .01 && Math.abs(to.boxes[a].h - to.unit) < .01, 'old focus is a fixed small square');
      exits.add(to.seams.exit);
    }
  }
  assert.deepEqual([...exits].sort(), ['east', 'north', 'south', 'west']);
  assert.doesNotMatch(script, /Math\.random|Math\.sin|current % 4|\[cells\[0\], cells\[current\]\]/);
});
test('spatial ownership persists; the first cover is not a mandatory exchange relay', () => {
  const h = fixture(), count = h.capacity(1100, 620);
  let plan = h.layout(count, 0, 1100, 620), stayed = 0;
  plan = h.layout(count, 5, 1100, 620, plan);
  for (let step = 0; step < 24; step++) {
    const next = (step * 17 + 11) % count || 1, before = plan.boxes[0];
    plan = h.layout(count, next, 1100, 620, plan);
    if (!different(before, plan.boxes[0])) stayed++;
  }
  assert.ok(stayed >= 8, 'cover 01 does not move for each later selection');
  const repeat = h.layout(count, plan.focus, 1100, 620, plan);
  assert.equal(repeat, plan, 'repeat click neither reallocates nor changes cuts');
});
test('long selection sequences preserve regular sizes and the exact tessellation without a history cache', () => {
  const h = fixture(), count = h.capacity(1100, 620);
  const original = h.layout(count, 8, 1100, 620);
  let plan = original;
  for (let step = 0; step < 100; step++) {
    plan = h.layout(count, step * 17 % count, 1100, 620, plan);
    assertShapes(plan); assertDisjoint(plan.boxes, 'long selection sequence');
    assert.deepEqual([plan.width, plan.height], [original.width, original.height]);
    assert.ok(Math.abs(plan.cells.reduce((sum, r) => sum + r.w * r.h, 0) - plan.width * plan.height) < .001);
    assert.equal(new Set(plan.order).size, count);
    assert.equal(plan.order[0], plan.focus);
  }
  plan = h.layout(count, 8, 1100, 620, plan);
  assert.deepEqual(plan.focusSlot, original.focusSlot, 'revisiting reuses the focus, not a cached global reshuffle');
  assert.equal(plan.boxes.length, count);
  assert.equal(plan.visual, undefined, 'in-flight measurements are not retained as history');
  assert.equal(h.layout(0, 0, 1100).boxes.length, 0);
  assert.equal(h.capacity(0, 620), 0);
});
test('exchanges keep all covers visible, with two continuous positive-size keyframes', () => {
  const h = fixture(), count = h.capacity(1100, 620);
  for (let old = 0; old < 16; old++) for (let next = 0; next < 16; next++) {
    const from = h.layout(count, old, 1100, 620), to = h.layout(count, next, 1100, 620, from);
    const stages = h.transition(from.boxes, to.boxes);
    assert.deepEqual(Array.from(stages, s => s.offset), [0, 1]);
    // Brief layered exchange overlap is in the reference; only settled states
    // must be disjoint. Do not "fix" it by hiding/retracting all neighboring art.
    for (const t of [0, .1, .25, .5, .75, .9, 1]) {
      mixBoxes(from.boxes, to.boxes, t).forEach(b => {
        assert.ok(b.w > 0 && b.h > 0);
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= from.width + .01 && b.y + b.h <= from.height + .01);
      });
      if (old !== next) assertDisjoint([mixBoxes(from.boxes, to.boxes, t)[old], mixBoxes(from.boxes, to.boxes, t)[next]], 'incoming and outgoing never cover each other');
    }
  }
  h.render([]); h.setActive(true); find(h.root, 'button')[3].events.click();
  assert.ok(h.animations.length > 0 && h.animations.length <= 12);
  h.animations.forEach(a => {
    assert.equal(a.options.duration, 680);
    assert.equal(a.startTime, 0, 'all covers use one animation clock');
    assert.equal(a.frames.length, 2);
    a.frames.forEach(f => {
      assert.ok(parseFloat(f.width) > 0 && parseFloat(f.height) > 0);
      assert.doesNotMatch(f.transform, /scale/); assert.equal(f.opacity, undefined);
    });
  });
});
test('adjacent selections share one moving gutter in all four directions throughout the exchange', () => {
  const h = fixture(), count = h.capacity(1100, 620), initial = h.layout(count, 0, 1100, 620), directions = new Set();
  for (const next of [2, 3, 4, 5, 8, 10, 12, 13, 14, 18, 19]) {
    const plan = h.layout(count, next, 1100, 620, initial), side = plan.seams.exit;
    directions.add(side);
    for (let step = 0; step <= 100; step++) {
      const boxes = mixBoxes(initial.boxes, plan.boxes, step / 100), incoming = boxes[next], outgoing = boxes[0];
      const gap = side === 'east' ? outgoing.x - incoming.x - incoming.w : side === 'west' ? incoming.x - outgoing.x - outgoing.w
        : side === 'south' ? outgoing.y - incoming.y - incoming.h : incoming.y - outgoing.y - outgoing.h;
      assert.ok(Math.abs(gap - plan.gap) < .001, 'both covers push/pull along exactly one seam, not independent crossing paths');
    }
  }
  assert.equal(directions.size, 4);
});
test('rapid clicks preserve every interrupted visual bound and settle in the common focus slot', async () => {
  const h = fixture(); h.render([]); h.setActive(true);
  const nodes = find(h.root, 'article'), buttons = find(h.root, 'button');
  buttons[3].events.click(); h.animations.forEach(a => a.sample(.4));
  const before = nodes.map(n => n.getBoundingClientRect()), oldCount = h.animations.length;
  buttons[8].events.click();
  const starting = nodes.map(n => n.getBoundingClientRect());
  before.forEach((b, i) => ['left', 'top', 'width', 'height'].forEach(k => assert.ok(Math.abs(b[k] - starting[i][k]) < .01, 'no interruption jump: ' + i + '/' + k + ' ' + b[k] + ' -> ' + starting[i][k])));
  const current = h.animations.slice(oldCount);
  assert.ok(h.animations.slice(0, oldCount).every(a => a.canceled));
  await Promise.resolve();
  assert.ok(nodes[8].classes.has('is-moving'), 'canceled promise cannot clear the new motion layer');
  current.forEach(a => a.finish()); await Promise.resolve();
  const result = nodes[8].getBoundingClientRect(), [cx, cy] = cameraOf(h), model = h.layout(nodes.length, 8, 1100, 620);
  assert.ok(Math.abs(result.left / h.viewScale + cx - model.focusSlot.x) < .01);
  assert.ok(Math.abs(result.top / h.viewScale + cy - model.focusSlot.y) < .01);
  assert.equal(result.width, model.big * h.viewScale); assert.equal(result.height, model.big * h.viewScale);
  assert.ok(nodes.every(n => !n.classes.has('is-moving') && !n.classes.has('is-departing')));
});
test('repeat click is a no-op; the old focus shrinks to a fixed square and revisits only reflow the neighborhood', async () => {
  const h = fixture(); h.render(Array.from({ length: 16 }, (_, i) => song(i))); h.setActive(true);
  const buttons = find(h.root, 'button'), nodes = find(h.root, 'article'), canvas = h.root.children[0];
  const camera = canvas.style.transform;
  buttons[2].events.click(); const state = geometry(h), count = h.animations.length;
  buttons[2].events.click();
  assert.deepEqual(geometry(h), state); assert.equal(h.animations.length, count);
  assert.equal(canvas.style.transform, camera);
  h.animations.forEach(a => a.finish()); await Promise.resolve();
  buttons[8].events.click();
  assert.equal(buttons.filter(b => b.attrs['aria-pressed'] === 'true').length, 1);
  assert.equal(buttons[8].attrs['aria-pressed'], 'true');
  const unit = h.layout(16, 8, 1100, 620).unit;
  assert.equal(parseFloat(nodes[2].style.height), unit);
  assert.equal(parseFloat(nodes[2].style.width), unit);
  h.animations.forEach(a => a.finish()); await Promise.resolve();
  buttons[2].events.click();
  assert.equal(buttons[2].attrs['aria-pressed'], 'true');
  assert.equal(nodes[2].style.width, state[2][2]); assert.equal(nodes[2].style.height, state[2][3]);
  assert.equal(canvas.style.transform, camera);
  h.setActive(false); assert.ok(h.animations.every(a => a.canceled || a.complete)); assert.equal(h.frames.size, 0);
  await Promise.resolve();
});
test('unavailable animation API commits the layout without leaving temporary motion layers', () => {
  const h = fixture(); h.render([]); h.setActive(true);
  const nodes = find(h.root, 'article'); nodes.forEach(n => { n.animate = undefined; });
  find(h.root, 'button')[3].events.click();
  assert.equal(h.animations.length, 0);
  assert.ok(nodes.every(n => !n.classes.has('is-moving') && !n.classes.has('is-departing')));
  assert.equal(find(h.root, 'button')[3].attrs['aria-pressed'], 'true');
  assert.equal(parseFloat(nodes[3].style.width), h.layout(nodes.length, 3, 1100, 620).big);
});
test('leaving, visibility changes and identical refresh do not change the selected geometry', () => {
  const h = fixture(); h.render([]); h.setActive(true); find(h.root, 'button')[8].events.click();
  const before = geometry(h);
  h.setActive(false); h.setActive(true); assert.deepEqual(geometry(h), before);
  h.document.hidden = true; h.document.events.visibilitychange();
  h.document.hidden = false; h.document.events.visibilitychange(); assert.deepEqual(geometry(h), before);
  h.render([]); assert.deepEqual(geometry(h), before);
});
test('reordered public data preserves every spatial owner by identity, not its array index', async () => {
  const h = fixture(), items = Array.from({ length: 24 }, (_, i) => song(i)); h.render(items); h.setActive(true);
  const buttons = find(h.root, 'button');
  buttons[5].events.click(); h.animations.forEach(a => a.finish()); await Promise.resolve();
  buttons[16].events.click(); h.animations.forEach(a => a.finish()); await Promise.resolve();
  const original = geometry(h), reordered = items.slice().reverse();
  h.render(reordered);
  const next = geometry(h);
  reordered.forEach((entry, i) => assert.deepEqual(next[i], original[Number(entry.id)]));
  assert.equal(find(h.root, 'button')[7].attrs['aria-pressed'], 'true');
  const count = h.animations.length; find(h.root, 'button')[7].events.click();
  assert.equal(h.animations.length, count);
  h.render([song(16)]);
  assert.equal(find(h.root, 'article').length, 1);
  assert.equal(find(h.root, 'button')[0].attrs['aria-pressed'], 'true');
  assert.equal(parseFloat(find(h.root, 'article')[0].style.width), h.layout(1, 0, 1100, 620).big);
});
test('blank previews fill the viewport-dependent world without adding real songs or playback', async () => {
  const h = fixture(), items = []; h.render(items); h.setActive(true);
  const count = h.capacity(1100, 620);
  assert.equal(find(h.root, 'article').length, count); assert.equal(find(h.root, 'button').length, count);
  assert.equal(find(h.root, 'img').length, 0); assert.equal(h.animations.length, 0);
  assert.equal(find(h.root, 'strong').length, 0); assert.equal(find(h.root, 'a').length, 0);
  assert.equal(find(h.root, 'button')[0].attrs['aria-pressed'], 'true');
  const buttons = find(h.root, 'button'); buttons[5].events.click();
  assert.equal(buttons[5].attrs['aria-pressed'], 'true'); assert.ok(h.animations.length > 0 && h.animations.length < count);
  assert.equal(h.status.textContent, '已选中第 6 个空白封面'); assert.deepEqual(items, []);
  h.render(items); assert.equal(find(h.root, 'button')[5].attrs['aria-pressed'], 'true');
  h.render([song(1)]); assert.equal(find(h.root, 'article').length, 1); assert.equal(h.root.classes.has('is-preview'), false);
  assert.equal(find(h.root, 'strong')[0].textContent, '曲目 1');
  assert.equal(find(h.root, 'button')[0].attrs['aria-pressed'], 'true'); assert.equal(h.status.textContent, '');
  assert.ok(h.animations.every(a => a.canceled)); await Promise.resolve();
  assert.doesNotMatch(script, /fetch\(|innerHTML|\/api\/private|\/studio|new Audio/);
});
test('resize rebuilds only ephemeral preview capacity; real collections never gain artificial entries', () => {
  const h = fixture(); h.render([]); h.setActive(true); find(h.root, 'button')[3].events.click();
  h.root.clientWidth = 2560; h.root.clientHeight = 1440; h.resize(); h.step(16);
  assert.equal(find(h.root, 'article').length, h.capacity(2560, 1440));
  assert.equal(find(h.root, 'button')[3].attrs['aria-pressed'], 'true');
  h.render([song(1), song(2)]); h.root.clientWidth = 390; h.root.clientHeight = 620; h.resize(); h.step(32);
  assert.equal(find(h.root, 'article').length, 2); assert.equal(h.root.classes.has('is-preview'), false);
  h.setActive(false); h.root.clientWidth = 1100; h.render([]); h.setActive(true);
  assert.equal(find(h.root, 'article').length, h.capacity(1100, 620));
});
test('only music renders, text is literal and unsafe links and images are rejected', () => {
  const h = fixture(true);
  h.render([song(1, { title: '<script>literal</script>' }), song(2, { url: 'javascript:bad()', image: '../private.png' }), { kind: 'photos', data: { title: 'PRIVATE' } }]); h.setActive(true);
  assert.equal(find(h.root, 'article').length, 2);
  assert.equal(find(h.root, 'img')[0].src, './media/public/' + 'a'.repeat(32) + '.jpg');
  assert.equal(find(h.root, 'strong')[0].textContent, '<script>literal</script>');
  find(h.root, 'button')[1].events.click();
  assert.equal(find(find(h.root, 'article')[1], 'a')[0].hidden, true);
  const img = find(h.root, 'img')[0]; img.events.error(); assert.equal(img.hidden, true);
});
test('keyboard, reduced motion and reordered refresh preserve selected identity', async () => {
  const h = fixture(), items = Array.from({ length: 4 }, (_, i) => song(i)); h.render(items); h.setActive(true);
  h.media.matches = true; let stopped = false;
  find(h.root, 'button')[0].events.keydown({ key: 'End', preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true); assert.equal(h.animations.length, 0); assert.equal(h.focused(), find(h.root, 'button')[3]);
  h.render(items.slice().reverse()); assert.equal(find(h.root, 'button')[0].attrs['aria-pressed'], 'true');
  h.root.clientWidth = 390; h.resize(); assert.equal(h.frames.size, 1);
  h.setActive(false); assert.equal(h.frames.size, 0);
  h.setActive(true); assert.ok(parseFloat(h.root.children[0].style.width) > 390);
  h.media.matches = false; find(h.root, 'button')[1].events.click();
  h.document.hidden = true; h.document.events.visibilitychange();
  assert.ok(h.animations.every(a => a.canceled)); await Promise.resolve();
});
test('click has no long follow pause: moving the pointer after a real tap responds on the next frame', () => {
  const h = fixture(); h.render([]); h.setActive(true);
  const canvas = h.root.children[0], dimensions = [canvas.style.width, canvas.style.height], button = find(h.root, 'button')[3];
  h.root.events.pointerenter({ pointerType: 'mouse', clientX: 550, clientY: 310 });
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 800, clientY: 310 }); h.step(0);
  h.root.events.pointerdown({ button: 0, pointerId: 1, pointerType: 'mouse', clientX: 800, clientY: 310, target: button });
  h.root.events.pointerup({ type: 'pointerup', pointerId: 1, clientX: 800, clientY: 310 });
  button.events.click(); const position = cameraOf(h);
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 808, clientY: 310 });
  assert.deepEqual(cameraOf(h), position);
  h.step(16); assert.ok(cameraOf(h)[0] > position[0], 'no 720ms waiting after selection');
  const first = cameraOf(h)[0]; h.root.events.pointermove({ pointerType: 'mouse', clientX: 820, clientY: 310 });
  h.step(32); assert.ok(cameraOf(h)[0] > first);
  assert.equal(button.attrs['aria-pressed'], 'true');
  assert.deepEqual([canvas.style.width, canvas.style.height], dimensions);
  h.setActive(false); assert.equal(h.frames.size, 0);
});
test('follow destinations remain bounded, and exit/re-entry, touch, reduced-motion and hidden pages stop work', () => {
  const h = fixture(); h.render([]); h.setActive(true);
  const canvas = h.root.children[0], initial = cameraOf(h);
  h.root.events.pointerenter({ pointerType: 'mouse', clientX: 550, clientY: 310 });
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 1100, clientY: 620 });
  for (let t = 0; t <= 1000; t += 16) h.step(t);
  const maximum = [parseFloat(canvas.style.width) - 1100 / h.viewScale, parseFloat(canvas.style.height) - 620 / h.viewScale];
  cameraOf(h).forEach((n, i) => assert.ok(Math.abs(n - initial[i] - (maximum[i] - initial[i]) * .7) < .001));
  assert.equal(h.frames.size, 0);
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 0, clientY: 0 });
  for (let t = 1008; t <= 2000; t += 16) h.step(t);
  cameraOf(h).forEach((n, i) => assert.ok(Math.abs(n - initial[i] * .3) < .001)); assert.equal(h.frames.size, 0);
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 500, clientY: 300 }); h.step(2016);
  assert.equal(h.frames.size, 1); h.root.events.pointerleave(); assert.equal(h.frames.size, 0);
  const left = cameraOf(h);
  h.root.events.pointerenter({ pointerType: 'mouse', clientX: 900, clientY: 500 });
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 900, clientY: 500 });
  assert.deepEqual(cameraOf(h), left); assert.equal(h.frames.size, 0, 're-entry does not jump');
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 920, clientY: 510 }); assert.equal(h.frames.size, 1);
  h.document.hidden = true; h.document.events.visibilitychange(); assert.equal(h.frames.size, 0);
  h.document.hidden = false; h.document.events.visibilitychange();
  h.root.events.pointerenter({ pointerType: 'touch', clientX: 550, clientY: 310 });
  h.root.events.pointermove({ pointerType: 'touch', clientX: 600, clientY: 320 }); assert.equal(h.frames.size, 0, 'touch hover does not drive camera');
  h.media.matches = true; h.media.events.change();
  h.root.events.pointerenter({ pointerType: 'mouse', clientX: 550, clientY: 310 });
  h.root.events.pointermove({ pointerType: 'mouse', clientX: 1000, clientY: 590 }); assert.equal(h.frames.size, 0);
  assert.ok(initial[0] > 0);
});
test('drag/wheel explore the larger world; modifiers and click suppression retain their boundaries', () => {
  const h = fixture(); h.render([]); h.setActive(true); const initial = cameraOf(h);
  h.root.events.pointerdown({ button: 0, pointerId: 1, clientX: 300, clientY: 300, target: h.root });
  h.root.events.pointermove({ pointerId: 1, clientX: 250, clientY: 260 });
  h.root.events.pointerup({ pointerId: 1 });
  let stopped = false; h.root.events.click({ preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true); assert.notDeepEqual(cameraOf(h), initial);
  h.root.events.wheel({ deltaX: 0, deltaY: 1e6, deltaMode: 0, preventDefault() {} });
  assert.equal(cameraOf(h)[1], parseFloat(h.root.children[0].style.height) - h.root.clientHeight / h.viewScale);
  const bottom = cameraOf(h);
  h.root.events.wheel({ deltaX: 0, deltaY: -30, deltaMode: 1, shiftKey: true, preventDefault() {} });
  assert.equal(cameraOf(h)[1], bottom[1]); assert.ok(cameraOf(h)[0] < bottom[0]);
  const shifted = cameraOf(h);
  h.root.events.wheel({ deltaX: 1000, deltaY: 1000, ctrlKey: true, preventDefault() { assert.fail('do not prevent browser zoom'); } });
  assert.deepEqual(cameraOf(h), shifted);
  h.setActive(false); assert.equal(h.frames.size, 0);
});
test('offscreen focus is revealed smoothly, while wheel/blur/reduced-motion cancel or skip the camera animation', () => {
  const h = fixture(); h.render([]); h.setActive(true);
  h.root.events.wheel({ deltaX: 1e6, deltaY: 1e6, deltaMode: 0, preventDefault() {} });
  const before = cameraOf(h); find(h.root, 'button')[3].events.click();
  assert.deepEqual(cameraOf(h), before, 'no instant camera jump');
  assert.equal(h.frames.size, 1); h.step(340);
  assert.notDeepEqual(cameraOf(h), before, 'camera smoothly reveals shared focus');
  h.root.events.wheel({ deltaX: 0, deltaY: 10, deltaMode: 0, preventDefault() {} });
  assert.equal(h.frames.size, 0); const stopped = cameraOf(h); h.step(680); assert.deepEqual(cameraOf(h), stopped);
  find(h.root, 'button')[5].events.click(); h.window.events.blur(); assert.equal(h.frames.size, 0);
  h.media.matches = true; h.media.events.change();
  h.root.events.wheel({ deltaX: 1e6, deltaY: 1e6, deltaMode: 0, preventDefault() {} });
  find(h.root, 'button')[8].events.click(); assert.equal(h.frames.size, 0);
  const [x, y] = cameraOf(h), b = h.layout(h.capacity(1100, 620), 8, 1100, 620).focusSlot;
  assert.ok(b.x >= x && b.y >= y && b.x + b.w <= x + 1100 / h.viewScale && b.y + b.h <= y + 620 / h.viewScale);
  h.window.events.pagehide(); assert.equal(h.frames.size, 0);
});
test('cover palette ignores neutral borders, pools similar colors and returns bounded finite channels', () => {
  const h = fixture(), neutral = [110, 158, 145];
  assert.deepEqual(Array.from(h.palette([...pixels([255, 255, 255]), ...pixels([0, 0, 0]), ...pixels([180, 45, 65], 20), ...pixels([182, 47, 67], 20), ...pixels([40, 90, 210], 3)])), [181, 46, 66]);
  assert.deepEqual(Array.from(h.palette(pixels([45, 85, 30]))), [90, 170, 60], 'quiet dark artwork is lifted without a white flash');
  assert.deepEqual(Array.from(h.palette(pixels([255, 80, 50]))), [235, 80, 50]);
  assert.deepEqual(Array.from(h.palette([...pixels([20, 220, 100], 20, 100), 300, 1, 2, 255, NaN, 40, 100, 255, ...pixels([128, 128, 128], 20)])), neutral);
  assert.deepEqual(Array.from(h.palette([...pixels([20, 200, 100], 1024), ...pixels([230, 50, 40], 2048)])), [20, 200, 100], 'sampling work has a fixed maximum');
  const fallback = h.palette(null); fallback[0] = 0;
  assert.deepEqual(Array.from(h.palette([])), neutral, 'callers cannot mutate the fallback');
});

test('selected covers alone supply a cached 16x16 atmosphere; shared album covers sample only once', () => {
  const h = fixture(false, false, pixels([180, 45, 65])); h.render([song(0), song(1)]);
  const images = find(h.root, 'img'); images.forEach(loaded);
  assert.equal(h.sampling.length, 0, 'inactive routes do not decode extra pixels');
  h.setActive(true); assert.deepEqual(glowOf(h), [180, 45, 65]); assert.equal(ambienceOf(h).hidden, false);
  assert.equal(h.sampling.length, 1); assert.equal(h.sampling[0].image, images[0]);
  assert.deepEqual(Array.from(h.sampling[0].bounds), [0, 0, 16, 16]);
  assert.equal(h.sampling[0].canvas.width, 16); assert.equal(h.sampling[0].canvas.height, 16);
  assert.equal(h.sampling[0].type, '2d'); assert.equal(h.sampling[0].options.willReadFrequently, true);
  assert.equal(find(h.root, 'canvas').length, 0, 'sampling buffer is off-DOM, not a wallpaper copy');
  const same = h.root.children[0].style.transform;
  find(h.root, 'button')[1].events.click(); assert.equal(h.sampling.length, 1); assert.equal(h.root.children[0].style.transform, same);
  find(h.root, 'button')[1].events.click(); assert.equal(h.sampling.length, 1);
  h.render([song(1), song(0)]); find(h.root, 'img').forEach(loaded); assert.equal(h.sampling.length, 1);
  h.setActive(false); assert.equal(ambienceOf(h).hidden, true); assert.equal(h.frames.size, 0);
});

test('late old-cover loads cannot replace the current atmosphere, while failed or missing covers fall back quietly', () => {
  const h = fixture(false, false, image => pixels(image.src.includes('b'.repeat(32)) ? [40, 190, 70] : image.src.includes('c'.repeat(32)) ? [45, 85, 210] : [180, 45, 65]));
  h.render([song(0), song(1, { image: 'b'.repeat(32) + '.jpg' }), song(2, { image: 'c'.repeat(32) + '.jpg' }), song(3, { image: '' })]);
  const images = find(h.root, 'img'), buttons = find(h.root, 'button'); loaded(images[0]); h.setActive(true);
  buttons[1].events.click(); buttons[2].events.click(); assert.deepEqual(glowOf(h), [180, 45, 65], 'retain the last valid color during loading');
  loaded(images[1]); assert.equal(h.sampling.length, 1); assert.deepEqual(glowOf(h), [180, 45, 65]);
  loaded(images[2]); assert.equal(h.sampling.length, 2); assert.deepEqual(glowOf(h), [45, 85, 210]);
  images[2].events.error(); assert.deepEqual(glowOf(h), [110, 158, 145]);
  buttons[0].events.click(); assert.deepEqual(glowOf(h), [180, 45, 65]);
  buttons[3].events.click(); assert.deepEqual(glowOf(h), [110, 158, 145]); assert.equal(h.sampling.length, 2);
});

test('atmosphere work pauses on hidden/inactive routes and unreadable exports do not break selection', () => {
  const h = fixture(false, false, pixels([40, 180, 210])); h.render([song(0)]); h.setActive(true);
  const image = find(h.root, 'img')[0]; h.document.hidden = true; h.document.events.visibilitychange(); loaded(image);
  assert.equal(h.sampling.length, 0); assert.equal(ambienceOf(h).hidden, true);
  h.document.hidden = false; h.document.events.visibilitychange(); assert.deepEqual(glowOf(h), [40, 180, 210]);
  assert.equal(h.sampling.length, 1); h.setActive(false); loaded(image); assert.equal(h.sampling.length, 1);
  h.setActive(true); assert.equal(ambienceOf(h).hidden, false); assert.equal(h.sampling.length, 1);
  const unreadable = fixture(true, false, new Error('pixels unavailable')); unreadable.render([song(0), song(1)]); find(unreadable.root, 'img').forEach(loaded);
  assert.doesNotThrow(() => unreadable.setActive(true)); find(unreadable.root, 'button')[1].events.click();
  assert.deepEqual(glowOf(unreadable), [110, 158, 145]); assert.equal(unreadable.sampling.length, 1);
  assert.equal(find(unreadable.root, 'button')[1].attrs['aria-pressed'], 'true');
});

test('cover-color cache is bounded and reuses one sampling canvas even across large collections', () => {
  const h = fixture(false, false, pixels([45, 160, 75]));
  h.render(Array.from({ length: 67 }, (_, i) => song(i, { image: i.toString(16).padStart(32, '0') + '.jpg' })));
  find(h.root, 'img').forEach(loaded); h.setActive(true);
  const buttons = find(h.root, 'button'); for (let i = 1; i < buttons.length; i++) buttons[i].events.click();
  assert.equal(h.sampling.length, 67); assert.equal(new Set(h.sampling.map(s => s.canvas)).size, 1);
  buttons[66].events.click(); assert.equal(h.sampling.length, 67, 'repeat selection has no sampling work');
  buttons[0].events.click(); assert.equal(h.sampling.length, 68, 'oldest color was evicted rather than retaining an unbounded collection');
  h.setActive(false); assert.equal(h.frames.size, 0);
});

test('pointer press feedback affects only the clicked tile and never changes lattice bounds or camera', () => {
  const h = fixture(); h.render([song(0), song(1)]); h.setActive(true);
  const nodes = find(h.root, 'article'), buttons = find(h.root, 'button'), before = geometry(h), camera = cameraOf(h), count = h.animations.length;
  const target = find(buttons[1], 'strong')[0];
  h.root.events.pointerdown({ button: 0, pointerId: 4, pointerType: 'mouse', clientX: 500, clientY: 300, target });
  assert.equal(nodes[0].classes.has('is-pressed'), false); assert.equal(nodes[1].classes.has('is-pressed'), true);
  assert.deepEqual(geometry(h), before); assert.deepEqual(cameraOf(h), camera); assert.equal(h.animations.length, count);
  h.root.events.pointerup({ pointerId: 9 }); assert.equal(nodes[1].classes.has('is-pressed'), true, 'another pointer cannot release this press');
  h.root.events.pointerup({ type: 'pointerup', pointerId: 4, clientX: 500, clientY: 300 });
  assert.equal(nodes[1].classes.has('is-pressed'), false); buttons[1].events.click(); assert.equal(buttons[1].attrs['aria-pressed'], 'true');
  const link = find(nodes[1], 'a')[0]; h.root.events.pointerdown({ button: 0, pointerId: 5, clientX: 500, clientY: 300, target: link });
  assert.ok(nodes.every(n => !n.classes.has('is-pressed')), 'external listening link is not swallowed by tile feedback');
});

test('drag threshold cancels press feedback and hover, while cancellation/blur/route changes cannot leave a stuck tile', () => {
  const h = fixture(); h.render([song(0)]); h.setActive(true);
  const node = find(h.root, 'article')[0], button = find(h.root, 'button')[0];
  const down = () => h.root.events.pointerdown({ button: 0, pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 300, target: button });
  down(); h.root.events.pointermove({ pointerId: 1, clientX: 503, clientY: 300 }); assert.equal(node.classes.has('is-pressed'), true);
  h.root.events.pointermove({ pointerId: 1, clientX: 510, clientY: 300 }); assert.equal(node.classes.has('is-pressed'), false); assert.equal(h.root.classes.has('is-dragging'), true);
  h.root.events.pointerup({ type: 'pointerup', pointerId: 1, clientX: 510, clientY: 300 }); assert.equal(h.root.classes.has('is-dragging'), false);
  let prevented = false; h.root.events.click({ preventDefault() { prevented = true; }, stopPropagation() {} }); assert.equal(prevented, true);
  for (const cleanup of [
    () => h.root.events.pointercancel({ type: 'pointercancel', pointerId: 1 }),
    () => h.root.events.lostpointercapture({ pointerId: 1 }),
    () => h.window.events.blur(),
    () => h.root.events.wheel({ deltaX: 0, deltaY: 0, preventDefault() {} }),
    () => h.media.events.change(),
    () => { h.document.hidden = true; h.document.events.visibilitychange(); },
    () => h.window.events.pagehide(),
    () => h.setActive(false)
  ]) {
    h.document.hidden = false; h.setActive(true); down(); assert.equal(node.classes.has('is-pressed'), true);
    cleanup(); assert.equal(node.classes.has('is-pressed'), false); assert.equal(h.root.classes.has('is-dragging'), false); assert.equal(h.frames.size, 0);
  }
});

test('Enter/Space press feedback preserves native activation and clears on release, focus loss or navigation', () => {
  const h = fixture(); h.render([song(0), song(1)]); h.setActive(true);
  const nodes = find(h.root, 'article'), buttons = find(h.root, 'button');
  for (const key of ['Enter', ' ', 'Spacebar']) {
    buttons[1].events.keydown({ key, preventDefault() { assert.fail('native button activation must remain available'); } });
    assert.equal(nodes[1].classes.has('is-pressed'), true); buttons[1].events.keydown({ key, repeat: true });
    buttons[0].events.keyup({ key }); assert.equal(nodes[1].classes.has('is-pressed'), true);
    buttons[1].events.keyup({ key }); assert.equal(nodes[1].classes.has('is-pressed'), false);
  }
  buttons[1].events.keydown({ key: ' ' }); buttons[1].events.blur(); assert.equal(nodes[1].classes.has('is-pressed'), false);
  buttons[1].events.keydown({ key: ' ' }); buttons[1].events.keydown({ key: 'ArrowLeft', preventDefault() {}, stopPropagation() {} });
  assert.ok(nodes.every(n => !n.classes.has('is-pressed'))); assert.equal(h.focused(), buttons[0]);
  h.setActive(false); buttons[1].events.keydown({ key: 'Enter' }); assert.equal(nodes[1].classes.has('is-pressed'), false);
});

test('microfeedback stays inside covers and atmosphere is non-intercepting, finite and reduced-motion aware', () => {
  const css = readFileSync(new URL('../public/music-wall.css', import.meta.url), 'utf8');
  assert.match(css, /\.music-ambience \{[^}]*z-index: 0; pointer-events: none/);
  assert.match(css, /\.music-canvas \{[^}]*z-index: 1/);
  assert.match(css, /@property --music-glow-r \{ syntax: '<number>'/);
  assert.match(css, /transition: --music-glow-r 620ms ease/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /\.music-tile:not\(\.is-pressed\):hover > \.music-tile-image \{ transform: scale\(1\.018\)/);
  assert.match(css, /\.music-tile\.is-pressed > \.music-tile-image \{ transform: scale\(\.988\)/);
  assert.match(css, /\.music-wall \.music-tile > \.music-tile-image,\.music-wall \.music-tile \.music-tile-caption \{ transform: none/);
  assert.doesNotMatch(css, /\.music-tile(?::hover|\.is-pressed)\s*\{[^}]*transform:/);
  assert.doesNotMatch(script, /fetch\(|localStorage|new Audio|createImageBitmap/);
  assert.doesNotMatch(css, /will-change|infinite/);
});

test('blur uses the existing wallpaper; display is full-page with one focus outline and transient motion layers', () => {
  const css = readFileSync(new URL('../public/music-wall.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(css, /\.single-screen\.music-view \.pond-stage::after \{ backdrop-filter: blur\(12px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /will-change|infinite/);
  assert.match(css, /\.music-tile-select:focus \{ outline: none; \}/);
  assert.match(css, /\.music-tile:has\(\.music-tile-select:focus-visible\)::after/);
  assert.doesNotMatch(css, /box-shadow: inset|\.music-tile-select:focus-visible \{ outline:/);
  assert.match(css, /\.single-screen\.music-view #content \{ width: 100%; max-width: none/);
  assert.match(css, /\.single-screen\.music-view \.site-shell > \.topbar \{ display: none/);
  assert.match(css, /\.music-page > \.music-page-head \{ position: absolute/);
  assert.match(css, /\.music-canvas \{[^}]*transform-origin: 0 0/);
  assert.match(css, /\.music-tile\.is-moving \{ z-index: 2; \}/);
  assert.match(css, /\.music-tile\.is-departing \{ z-index: 3; \}/);
  assert.match(css, /\.music-tile\.is-selected \{ z-index: 4; \}/);
  assert.match(html, /class="interest-destination collection-music-entry" href="#music"/);
  assert.equal((html.match(/id="pond-frame"/g) || []).length, 1);
});
