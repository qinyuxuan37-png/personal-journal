/* Display-only cover wall; blank previews are ephemeral, never saved as music. */
(() => {
  const root = document.getElementById('music-wall');
  if (!root) return;
  const exported = document.documentElement.hasAttribute('data-export');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const imageName = /^[a-f0-9]{32}\.(jpg|png|webp|gif)$/;
  const text = value => typeof value === 'string' ? value.trim() : '';
  const address = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const duration = 680;
  const entranceDuration = 440;
  const viewScale = 1.12, focusSpan = 3;
  const followGain = .7, followResponse = 65;
  const viewport = () => ({ width: root.clientWidth / viewScale, height: root.clientHeight / viewScale });
  let entries = [], tiles = [], selected = -1, preview = false, active = false, resizeFrame = 0, lastWidth = 0, lastHeight = 0;
  const canvas = document.createElement('div'); canvas.className = 'music-canvas'; root.append(canvas);
  const ambience = document.createElement('div'); ambience.className = 'music-ambience'; ambience.hidden = true;
  ambience.setAttribute('aria-hidden', 'true'); root.append(ambience);
  let plan = null, panFrame = 0, lastTime = null, drag = null, motionToken = 0, entrancePending = false;
  const camera = { x: 0, y: 0, targetX: 0, targetY: 0 };
  const followOffset = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0, inside: false, type: 'mouse' };
  const animations = new Set();
  const neutralColor = [110, 158, 145], colorCache = new Map();
  let ambientColor = neutralColor.slice(), sampleCanvas = null, pressedNode = null;

  function palette(pixels) {
    // Ignore neutral ink/paper and pool similar colors; a white album border
    // must not turn the whole room white. Input is a tiny 16x16 local sample.
    const bins = new Map();
    for (let i = 0; i + 3 < Math.min(pixels?.length || 0, 4096); i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
      if (![r, g, b, a].every(v => Number.isFinite(v) && v >= 0 && v <= 255) || a < 180) continue;
      const high = Math.max(r, g, b), low = Math.min(r, g, b), luma = r * .2126 + g * .7152 + b * .0722;
      if (high - low < 22 || luma < 22 || luma > 235) continue;
      const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5), bin = bins.get(key) || { r: 0, g: 0, b: 0, n: 0, score: 0 };
      bin.r += r; bin.g += g; bin.b += b; bin.n++; bin.score += .35 + (high - low) / 255; bins.set(key, bin);
    }
    let best = null; for (const bin of bins.values()) if (!best || bin.score > best.score) best = bin;
    if (!best) return neutralColor.slice();
    const rgb = [best.r, best.g, best.b].map(v => v / best.n), peak = Math.max(...rgb);
    const gain = peak < 170 ? 170 / peak : 1;
    return rgb.map(v => Math.round(clamp(v * gain, 0, 235)));
  }
  function applyAmbient(color) {
    if (color.every((v, i) => v === ambientColor[i])) return;
    ambientColor = color.slice();
    ['r', 'g', 'b'].forEach((channel, i) => ambience.style.setProperty('--music-glow-' + channel, String(color[i])));
  }
  function updateAmbient() {
    if (!active || document.hidden) return;
    const image = tiles[selected]?.image, name = entries[selected]?.data.image;
    if (!image || image.hidden || !imageName.test(name || '')) { applyAmbient(neutralColor); return; }
    if (colorCache.has(name)) { applyAmbient(colorCache.get(name)); return; }
    // Keep the previous atmosphere while the next selected image is loading.
    if (!image.complete || !image.naturalWidth) return;
    let color = neutralColor.slice();
    try {
      if (!sampleCanvas) { sampleCanvas = document.createElement('canvas'); sampleCanvas.width = 16; sampleCanvas.height = 16; }
      const context = sampleCanvas.getContext?.('2d', { willReadFrequently: true });
      if (context) { context.drawImage(image, 0, 0, 16, 16); color = palette(context.getImageData(0, 0, 16, 16).data); }
    } catch { /* File exports or unreadable pixels keep a quiet neutral glow. */ }
    colorCache.set(name, color);
    if (colorCache.size > 64) colorCache.delete(colorCache.keys().next().value);
    applyAmbient(color);
  }
  function clearPress() {
    pressedNode?.classList.toggle('is-pressed', false); pressedNode = null;
  }
  function press(node) {
    if (!active || document.hidden || !tiles.some(tile => tile.node === node)) return;
    clearPress(); pressedNode = node; node.classList.toggle('is-pressed', true);
  }

  const coreCount = 23;
  const initialSeams = { exit: 'east', first: true, reference: true };
  const opposite = { west: 'east', east: 'west', north: 'south', south: 'north' };
  // Measured from the supplied frame, not generated from a density percentage.
  // One 9x5 landscape window contains 23 covers (eleven fixed small squares).
  const referenceCells = [
    [3, 1, 3, 3],
    [0, 0, 2, 1], [2, 0, 2, 1], [4, 0, 1, 1], [5, 0, 1, 1], [6, 0, 3, 2],
    [0, 1, 1, 1.5], [0, 2.5, 1, 1.5], [1, 1, 2, 1],
    [1, 2, 1, 1], [2, 2, 1, 1], [1, 3, 1, 1], [2, 3, 1, 1],
    [6, 2, 1, 1], [6, 3, 1, 1], [7, 2, 1, 2], [8, 2, 1, 2],
    [0, 4, 1.5, 1], [1.5, 4, 3, 1], [4.5, 4, 1.5, 1],
    [6, 4, 1, 1], [7, 4, 1, 1], [8, 4, 1, 1]
  ];
  const wingCells = [
    [0, 0, 2, 1], [2, 0, 1, 2], [0, 1, 1, 1], [1, 1, 1, 1],
    [0, 2, 1, 2], [1, 2, 2, 1], [1, 3, 1, 1], [2, 3, 1, 2], [0, 4, 2, 1]
  ];
  const cell = ([x, y, w, h]) => ({ x, y, w, h });
  function coreSlots(x, y, seams) {
    const cells = referenceCells.map(cell);
    // Retain the measured first frame. Subsequent selections alter only a
    // complete neighboring rectangle, never scatter unrelated random cuts.
    if (!seams.reference && seams.exit === 'east') {
      cells[8] = cell([1, seams.first ? 1 : 2, 1, 2]);
      cells[9] = cell([1, seams.first ? 3 : 1, 1, 1]);
      cells[10] = cell([2, 1, 1, 1]); cells[11] = cell([2, 2, 1, 1]);
    }
    if (!seams.reference && seams.exit === 'west') {
      cells[15] = cell([7, 2, 2, 1]); cells[16] = cell([7, 3, 2, 1]);
    }
    if (!seams.reference && seams.exit === 'north') {
      cells[17] = cell([0, 4, 2, 1]); cells[18] = cell([2, 4, 3, 1]); cells[19] = cell([5, 4, 1, 1]);
    }
    // Only the south exit needs a different cut: borrow half a unit from the
    // neighboring bottom card, keeping both covers and the complete row intact.
    if (seams.exit === 'south') { cells[19].w = 1; cells[20].x = 5.5; cells[20].w = 1.5; }
    return cells.map(r => ({ ...r, x: x + r.x, y: y + r.y }));
  }
  function blueprint(width, height, count = 0, seams = initialSeams) {
    // Fit the 9x5 window, not the entire oversized world, into a landscape
    // viewport. On portrait/ultrawide screens keep squares square and pan the
    // landscape canvas instead of squeezing it into a different grid.
    const screenPitch = Math.max(28, Math.min(width / 3.2, height / 3.2, Math.max(width / 9, height / 5)));
    const gap = 4 / viewScale, pitch = screenPitch / viewScale, unit = pitch - gap;
    const cells = coreSlots(3, 1, seams);
    const wing = (x, mirrored = false) => cells.push(...wingCells.map(cell).map(r => ({ ...r, x: x + (mirrored ? 3 - r.x - r.w : r.x), y: 1 + r.y })));
    const band = (y, widths, x = 0) => {
      for (const w of widths) { cells.push({ x, y, w, h: 1 }); x += w; }
    };
    wing(0); wing(12, true);
    band(0, [1, 2, 1, 1, 3, 1, 2, 1, 1, 2]);
    band(6, [2, 1, 1, 2, 1, 1, 3, 1, 1, 2]);
    let cols = 15;
    // Real collections may grow without duplicating songs. Extend the panorama
    // with complete strips; the reference window and focus position never move.
    while (cells.length < count) { wing(cols, true); band(0, [1, 2], cols); band(6, [2, 1], cols); cols += 3; }
    return { cells: cells.map(r => ({ x: r.x * pitch, y: r.y * pitch, w: r.w * pitch, h: r.h * pitch })),
      unit, gap, big: pitch * focusSpan - gap, width: cols * pitch, height: 7 * pitch, left: 0, top: 0,
      templateFrame: { x: 3 * pitch, y: pitch, w: 9 * pitch, h: 5 * pitch }, templateCount: coreCount };
  }
  const inset = (cell, gap) => ({ x: cell.x + gap / 2, y: cell.y + gap / 2, w: cell.w - gap, h: cell.h - gap });
  function capacity(width, height = 600) { return width > 0 && height > 0 ? blueprint(width, height).cells.length : 0; }
  function entrySide(source, focus) {
    const dx = source.x + source.w / 2 - focus.x - focus.w / 2, dy = source.y + source.h / 2 - focus.y - focus.h / 2;
    const horizontal = source.x + source.w <= focus.x + .01 || source.x >= focus.x + focus.w - .01;
    const vertical = source.y + source.h <= focus.y + .01 || source.y >= focus.y + focus.h - .01;
    // Prefer a separating axis. The main pair then cannot cross through each
    // other, including diagonal and distant selections.
    if (horizontal && (!vertical || Math.abs(dx) >= Math.abs(dy)) || !vertical && Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'west' : 'east';
    return dy < 0 ? 'north' : 'south';
  }
  function seamsFor(source, focus) {
    const entry = entrySide(source, focus), horizontal = entry === 'west' || entry === 'east';
    const first = horizontal ? source.y + source.h / 2 <= focus.y + focus.h / 2 : source.x + source.w / 2 <= focus.x + focus.w / 2;
    return { exit: opposite[entry], first };
  }
  function departureSlot(slots, focus, seams, pitch) {
    const edge = r => seams.exit === 'east' ? r.x - focus.x - focus.w : seams.exit === 'west' ? focus.x - r.x - r.w
      : seams.exit === 'south' ? r.y - focus.y - focus.h : focus.y - r.y - r.h;
    const horizontal = seams.exit === 'east' || seams.exit === 'west';
    const offset = r => horizontal ? r.y - focus.y : r.x - focus.x;
    const candidates = slots.map((r, i) => ({ r, i })).filter(({ r, i }) => i && Math.abs(r.w - pitch) < .01 && Math.abs(r.h - pitch) < .01
      && Math.abs(edge(r)) < .01 && offset(r) >= -.01 && offset(r) + pitch <= (horizontal ? focus.h : focus.w) + .01);
    candidates.sort((a, b) => (seams.first ? 1 : -1) * (offset(a.r) - offset(b.r)));
    if (candidates.length) return candidates[0].i;
    // Sparse real collections leave slots unoccupied. Put the departing cover
    // in a vacant adjacent square, without manufacturing extra music records.
    for (const position of [1, 0, 2]) {
      const r = horizontal ? { x: seams.exit === 'east' ? focus.x + focus.w : focus.x - pitch, y: focus.y + position * pitch, w: pitch, h: pitch }
        : { x: focus.x + position * pitch, y: seams.exit === 'south' ? focus.y + focus.h : focus.y - pitch, w: pitch, h: pitch };
      const free = slots.every((b, i) => i <= 1 || Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x) < .01 || Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y) < .01);
      if (free) { slots[1] = r; return 1; }
    }
    return 1;
  }
  function matchNeighbors(covers, slots, previous, target, order) {
    // Lock unchanged rectangles first. Match the remaining few local
    // covers with a minimum-motion assignment, rather than an index-based relay.
    for (let i = covers.length - 1; i >= 0; i--) {
      const old = previous[covers[i]], same = slots.findIndex(s => ['x', 'y', 'w', 'h'].every(k => Math.abs(old[k] - target[s][k]) < .01));
      if (same >= 0) { order[slots[same]] = covers[i]; covers.splice(i, 1); slots.splice(same, 1); }
    }
    const n = covers.length;
    if (!n) return;
    const cost = covers.map(c => slots.map(s => {
      const a = previous[c], b = target[s];
      return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.x + a.w - b.x - b.w) ** 2 + (a.y + a.h - b.y - b.h) ** 2;
    }));
    const best = new Float64Array(1 << n).fill(Infinity), choice = new Int8Array(1 << n); best[0] = 0;
    for (let mask = 0; mask < best.length - 1; mask++) {
      let row = 0; for (let bits = mask; bits; bits &= bits - 1) row++;
      for (let col = 0; col < n; col++) if (!(mask & 1 << col)) {
        const next = mask | 1 << col, value = best[mask] + cost[row][col];
        if (value < best[next]) { best[next] = value; choice[next] = col; }
      }
    }
    let mask = best.length - 1;
    for (let row = n - 1; row >= 0; row--) { const col = choice[mask]; order[slots[col]] = covers[row]; mask ^= 1 << col; }
  }
  function layout(count, focus, width, height = 600, previous = null) {
    if (!count || width <= 0 || height <= 0) return { boxes: [], cells: [], base: [], width: 0, height: 0, left: 0, top: 0, focus: -1 };
    const current = clamp(focus, 0, count - 1);
    const compatible = previous?.order?.length === count && previous.viewportWidth === width && previous.viewportHeight === height;
    if (compatible && previous.focus === current) return previous;
    if (!compatible) {
      const pattern = blueprint(width, height, count), cells = pattern.cells.slice(0, count), boxes = cells.map(c => inset(c, pattern.gap));
      previous = { ...pattern, cells, boxes, base: boxes, slots: cells, order: cells.map((_, i) => i), focus: 0, focusSlot: boxes[0],
        seams: initialSeams, viewportWidth: width, viewportHeight: height };
      if (!current) return previous;
    }
    const source = previous.visual?.[current] || previous.boxes[current], oldFocus = previous.visual?.[previous.focus] || previous.focusSlot;
    const seams = seamsFor(source, oldFocus), pattern = blueprint(width, height, count, seams);
    const slots = pattern.cells.slice(0, count), exit = departureSlot(slots, slots[0], seams, pattern.unit + pattern.gap);
    const target = slots.map(c => inset(c, pattern.gap)), order = previous.order.slice();
    const sourceSlot = previous.order.indexOf(current), localSlots = Array.from({ length: Math.min(coreCount, count) }, (_, i) => i);
    if (sourceSlot >= coreCount) localSlots.push(sourceSlot);
    const covers = localSlots.map(s => previous.order[s]).filter(c => c !== current && c !== previous.focus);
    order[0] = current; order[exit] = previous.focus;
    matchNeighbors(covers, localSlots.filter(s => s !== 0 && s !== exit), previous.boxes, target, order);
    const cells = new Array(count); order.forEach((cover, slot) => { cells[cover] = slots[slot]; });
    return { ...pattern, cells, boxes: cells.map(c => inset(c, pattern.gap)), slots, order, base: previous.base,
      focus: current, focusSlot: target[0], seams, viewportWidth: width, viewportHeight: height };
  }
  function transition(from, to) {
    // Incoming and outgoing keep their ordering along the entry axis. Adjacent
    // covers share the same moving seam: interpolating either edge gives exactly
    // the same boundary plus the gutter. Other neighbors remain fully visible.
    return [{ boxes: from, offset: 0 }, { boxes: to, offset: 1 }];
  }
  function paintCamera() { canvas.style.transform = 'translate(' + -camera.x * viewScale + 'px, ' + -camera.y * viewScale + 'px) scale(' + viewScale + ')'; }
  function boundCamera() {
    if (!plan) return;
    const { width, height } = viewport();
    const right = Math.max(plan.left, plan.width - width), bottom = Math.max(plan.top, plan.height - height);
    camera.x = clamp(camera.x, plan.left, right); camera.y = clamp(camera.y, plan.top, bottom);
    camera.targetX = clamp(camera.targetX, plan.left, right); camera.targetY = clamp(camera.targetY, plan.top, bottom);
    paintCamera();
  }
  function haltPan(keepPointer = false) {
    if (panFrame) window.cancelAnimationFrame(panFrame);
    panFrame = 0; lastTime = null; camera.targetX = camera.x; camera.targetY = camera.y;
    if (keepPointer !== true) pointer.inside = false;
    if (drag?.target.hasPointerCapture?.(drag.id)) drag.target.releasePointerCapture(drag.id);
    drag = null;
    clearPress(); root.classList.toggle('is-dragging', false);
  }
  function tick(timestamp) {
    panFrame = 0;
    if (!active || document.hidden || drag) return;
    const dt = lastTime === null ? 16 : Math.min(40, Math.max(1, timestamp - lastTime)); lastTime = timestamp;
    // Position servo, not edge velocity: a stationary pointer has one finite
    // destination. A short time-based response is identical at different FPS.
    const follow = reduced.matches ? 1 : 1 - Math.exp(-dt / followResponse);
    camera.x += (camera.targetX - camera.x) * follow;
    camera.y += (camera.targetY - camera.y) * follow;
    const epsilon = .15 / viewScale;
    if (Math.abs(camera.targetX - camera.x) < epsilon) camera.x = camera.targetX;
    if (Math.abs(camera.targetY - camera.y) < epsilon) camera.y = camera.targetY;
    boundCamera();
    if (camera.x !== camera.targetX || camera.y !== camera.targetY) schedulePan();
    else lastTime = null;
  }
  function schedulePan() { if (active && !document.hidden && !panFrame && !drag) panFrame = window.requestAnimationFrame(tick); }
  function moveCameraTo(x, y) {
    camera.targetX = x; camera.targetY = y; boundCamera();
    if (reduced.matches) { camera.x = camera.targetX; camera.y = camera.targetY; boundCamera(); return; }
    const epsilon = .15 / viewScale;
    if (Math.abs(camera.targetX - camera.x) < epsilon && Math.abs(camera.targetY - camera.y) < epsilon) {
      camera.targetX = camera.x; camera.targetY = camera.y; return;
    }
    if (camera.x !== camera.targetX || camera.y !== camera.targetY) schedulePan();
  }
  function pointerDestination() {
    if (!plan || !root.clientWidth || !root.clientHeight) return { x: camera.x, y: camera.y };
    const area = root.getBoundingClientRect(), view = viewport(), b = plan.focusSlot;
    const homeX = clamp(b.x + b.w / 2 - view.width / 2, 0, Math.max(0, plan.width - view.width));
    const homeY = clamp(b.y + b.h / 2 - view.height / 2, 0, Math.max(0, plan.height - view.height));
    const axis = (position, start, size, home, maximum) => {
      const n = clamp((position - start) / size * 2 - 1, -1, 1) * followGain;
      return n < 0 ? home * (1 + n) : home + (maximum - home) * n;
    };
    return { x: axis(pointer.x, area.left, area.width, homeX, Math.max(0, plan.width - view.width)),
      y: axis(pointer.y, area.top, area.height, homeY, Math.max(0, plan.height - view.height)) };
  }
  function rebaseFollow(x = camera.x, y = camera.y) {
    // Manual navigation/re-entry establishes a new local origin. The next
    // mouse move must continue from here, not undo the wheel or drag position.
    const mapped = pointerDestination(); followOffset.x = x - mapped.x; followOffset.y = y - mapped.y;
  }
  function rememberPointer(event) {
    if (Number.isFinite(event.clientX)) pointer.x = event.clientX;
    if (Number.isFinite(event.clientY)) pointer.y = event.clientY;
    if (event.pointerType) pointer.type = event.pointerType;
    const area = root.getBoundingClientRect();
    pointer.inside = pointer.x >= area.left && pointer.x <= area.left + area.width && pointer.y >= area.top && pointer.y <= area.top + area.height;
  }
  function followPointer() {
    if (!pointer.inside || pointer.type === 'touch' || reduced.matches) return;
    const mapped = pointerDestination(); moveCameraTo(mapped.x + followOffset.x, mapped.y + followOffset.y);
  }
  root.addEventListener('pointerenter', event => { if (active && !drag) { rememberPointer(event); rebaseFollow(); } });
  root.addEventListener('pointermove', event => {
    if (!active) return;
    const wasInside = pointer.inside;
    rememberPointer(event);
    if (drag && event.pointerId === drag.id) {
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; clearPress(); root.classList.toggle('is-dragging', true); }
      camera.x = drag.cx - dx / viewScale; camera.y = drag.cy - dy / viewScale;
      camera.targetX = camera.x; camera.targetY = camera.y; boundCamera(); return;
    }
    if (!wasInside) rebaseFollow();
    followPointer();
  });
  root.addEventListener('pointerleave', () => { pointer.inside = false; if (!drag) haltPan(); });
  root.addEventListener('pointerdown', event => {
    if (!active || event.button !== 0 || event.target.closest?.('a')) return;
    haltPan(); rememberPointer(event); suppressClick = false;
    press(event.target.closest?.('.music-tile'));
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y, moved: false, target: event.target };
    // Capture the original button so an ordinary tap still activates it.
    event.target.setPointerCapture?.(event.pointerId);
  });
  let suppressClick = false;
  function endDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    rememberPointer(event); suppressClick = drag.moved;
    if (drag.target.hasPointerCapture?.(drag.id)) drag.target.releasePointerCapture(drag.id);
    drag = null;
    clearPress(); root.classList.toggle('is-dragging', false);
    if (event.type === 'pointercancel') { haltPan(); return; }
    rebaseFollow();
  }
  root.addEventListener('pointerup', endDrag); root.addEventListener('pointercancel', endDrag);
  root.addEventListener('lostpointercapture', event => {
    if (drag?.id !== event.pointerId) return;
    suppressClick = drag.moved; haltPan();
  });
  root.addEventListener('click', event => {
    if (!suppressClick) return; suppressClick = false; event.preventDefault(); event.stopPropagation();
  }, true);
  root.addEventListener('wheel', event => {
    if (!active || !plan || event.ctrlKey || event.metaKey) return;
    event.preventDefault(); haltPan(true); rememberPointer(event);
    if (Number.isFinite(event.clientX)) pointer.type = 'mouse';
    const scale = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? root.clientHeight : 1;
    camera.x += (event.shiftKey ? event.deltaY : event.deltaX) * scale / viewScale;
    camera.y += (event.shiftKey ? 0 : event.deltaY) * scale / viewScale;
    camera.targetX = camera.x; camera.targetY = camera.y; boundCamera(); rebaseFollow();
  }, { passive: false });
  function stop() {
    motionToken++;
    for (const animation of animations) animation.cancel();
    animations.clear();
    tiles.forEach(t => { t.node.classList.toggle('is-moving', false); t.node.classList.toggle('is-departing', false); t.node.classList.toggle('is-entering', false); });
  }
  function animate(node, frames, options, startTime) {
    if (!node.animate || reduced.matches || !active || document.hidden) {
      node.classList.toggle('is-moving', false); node.classList.toggle('is-departing', false); node.classList.toggle('is-entering', false); return;
    }
    const token = motionToken, animation = node.animate(frames, options); animations.add(animation);
    // Every cover uses one timeline origin, including the two sides of the
    // shared seam; sequential animate() calls must not introduce phase drift.
    if (Number.isFinite(startTime)) animation.startTime = startTime;
    const done = () => {
      animations.delete(animation);
      if (token === motionToken) { node.classList.toggle('is-moving', false); node.classList.toggle('is-departing', false); node.classList.toggle('is-entering', false); }
    };
    animation.finished.then(done, done);
  }
  function playEntrance() {
    if (!entrancePending) return;
    entrancePending = false;
    if (!active || document.hidden || reduced.matches || !plan) return;
    const view = viewport(), pitch = plan.unit + plan.gap, startTime = document.timeline?.currentTime;
    tiles.forEach((tile, i) => {
      const b = plan.boxes[i];
      if (b.x + b.w <= camera.x || b.x >= camera.x + view.width || b.y + b.h <= camera.y || b.y >= camera.y + view.height) return;
      // The recording assembles the cover wall from left to right. Pop each
      // visible rectangle around its own center; do not move the entire page.
      const column = Math.max(0, (b.x - camera.x) / pitch), row = Math.max(0, (b.y - camera.y) / pitch);
      const delay = Math.min(280, Math.round(column * 30 + row * 10));
      const frames = [[0, .84, 0], [.68, 1.025, 1], [.86, .997, 1], [1, 1, 1]].map(([offset, size, opacity], step) => ({
        transform: 'translate(' + b.w * (1 - size) / 2 + 'px, ' + b.h * (1 - size) / 2 + 'px)',
        width: b.w * size + 'px', height: b.h * size + 'px', opacity, offset,
        easing: step === 0 ? 'cubic-bezier(.2,.75,.2,1)' : 'ease-in-out'
      }));
      tile.node.classList.toggle('is-entering', true);
      animate(tile.node, frames, { duration: entranceDuration, delay, easing: 'linear', fill: 'backwards' }, startTime);
    });
  }
  function arrange(moving = false) {
    const width = root.clientWidth, height = root.clientHeight || 600;
    if (!active || width <= 0 || !tiles.length) return;
    if (moving) entrancePending = false;
    // Read in-flight visual bounds before canceling, so rapid clicks retarget
    // from what is actually on screen rather than the abandoned destination.
    const before = moving && !reduced.matches ? tiles.map(t => t.node.getBoundingClientRect()) : [];
    const area = root.getBoundingClientRect();
    const from = before.map(b => ({ x: (b.left - area.left) / viewScale + camera.x, y: (b.top - area.top) / viewScale + camera.y, w: b.width / viewScale, h: b.height / viewScale }));
    const departing = plan?.focus;
    stop();
    const resized = width !== lastWidth || height !== lastHeight;
    if (resized) haltPan();
    plan = layout(tiles.length, selected, width, height, moving && from.length ? { ...plan, visual: from } : plan);
    Object.assign(canvas.style, { width: plan.width + 'px', height: plan.height + 'px' });
    if (resized) {
      const view = viewport();
      camera.x = plan.focusSlot.x + plan.big / 2 - view.width / 2;
      camera.y = plan.focusSlot.y + plan.big / 2 - view.height / 2;
      camera.targetX = camera.x; camera.targetY = camera.y;
    }
    lastWidth = width; lastHeight = height; boundCamera();
    tiles.forEach((tile, i) => {
      const b = plan.boxes[i], current = i === selected;
      Object.assign(tile.node.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
      tile.node.classList.toggle('is-selected', current);
      tile.button.setAttribute('aria-pressed', String(current));
      if (tile.detail) tile.detail.hidden = !current;
      if (tile.link) tile.link.hidden = !current || !tile.link.getAttribute('href');
      // Load the covers that are actually in view, including the lower rows;
      // offscreen covers stay lazy and use the browser's normal image cache.
      if (tile.image) {
        const view = viewport();
        tile.image.loading = b.x + b.w > camera.x && b.x < camera.x + view.width && b.y + b.h > camera.y && b.y < camera.y + view.height ? 'eager' : 'lazy';
      }
    });
    updateAmbient();
    const stages = from.length ? transition(from, plan.boxes) : [];
    const startTime = document.timeline?.currentTime;
    tiles.forEach((tile, i) => {
      const b = plan.boxes[i];
      if (!stages.length || !['x', 'y', 'w', 'h'].some(k => Math.abs(from[i][k] - b[k]) > .1)) return;
      tile.node.classList.toggle('is-moving', true);
      tile.node.classList.toggle('is-departing', i === departing);
      animate(tile.node, stages.map(s => {
        const a = s.boxes[i];
        return { transform: 'translate(' + (a.x - b.x) + 'px, ' + (a.y - b.y) + 'px)', width: a.w + 'px', height: a.h + 'px', offset: s.offset };
      }), { duration, easing: 'cubic-bezier(.22,1,.36,1)' }, startTime);
    });
    if (!moving) playEntrance();
  }
  function revealFocus() {
    const b = plan.focusSlot, { width, height } = viewport();
    if (b.x >= camera.x && b.x + b.w <= camera.x + width && b.y >= camera.y && b.y + b.h <= camera.y + height) return false;
    const toX = clamp(b.x + b.w / 2 - width / 2, 0, Math.max(0, plan.width - width));
    const toY = clamp(b.y + b.h / 2 - height / 2, 0, Math.max(0, plan.height - height));
    moveCameraTo(toX, toY); rebaseFollow(toX, toY); return true;
  }
  function choose(index, keyboard = false) {
    if (index < 0 || index >= entries.length || !active || !plan) return;
    if (index === selected) { if (keyboard) tiles[index].button.focus({ preventScroll: true }); return; }
    selected = index;
    arrange(true); const revealed = revealFocus();
    const status = document.getElementById('music-wall-status');
    if (status) status.textContent = preview ? '已选中第 ' + (index + 1) + ' 个空白封面' : '已选中 ' + (text(entries[index].data.title) || '未命名音乐');
    if (keyboard) tiles[index].button.focus({ preventScroll: true });
    if (!revealed) followPointer();
  }
  function element(tag, className, value) {
    const node = document.createElement(tag); node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function previewCount() { return capacity(root.clientWidth || window.innerWidth || 1100, root.clientHeight || window.innerHeight || 600); }
  function refreshPreview() {
    if (!preview || entries.length === previewCount()) return false;
    render([]); return true;
  }
  function render(items = []) {
    const previous = entries[selected]?.id, oldIds = entries.map(e => e.id);
    stop(); haltPan();
    entries = items.filter(e => e?.kind === 'music' && e.data && typeof e.data === 'object');
    preview = !entries.length;
    if (preview) entries = Array.from({ length: previewCount() }, (_, i) => ({ id: 'preview-cover-' + i, data: {} }));
    selected = entries.findIndex(e => e.id === previous);
    if (selected < 0 && entries.length) selected = 0;
    // A public-data refresh/reorder is not a selection. Preserve spatial
    // ownership by identity, without storing a complete layout per cover.
    const indices = new Map(entries.map((entry, i) => [entry.id, i])), oldIndices = new Map(oldIds.map((id, i) => [id, i]));
    if (plan?.order && oldIds.length === entries.length && oldIndices.size === oldIds.length && indices.size === entries.length && oldIds.every(id => indices.has(id))) {
      const remap = list => entries.map(entry => list[oldIndices.get(entry.id)]);
      plan = { ...plan, focus: selected, order: plan.order.map(i => indices.get(oldIds[i])), cells: remap(plan.cells), boxes: remap(plan.boxes), base: remap(plan.base) };
    } else plan = null;
    tiles = []; canvas.replaceChildren();
    root.classList.toggle('is-preview', preview);
    root.setAttribute('aria-label', preview ? '空白封面动画预览' : '音乐封面墙');
    const status = document.getElementById('music-wall-status');
    if (status) status.textContent = '';
    entries.forEach((entry, i) => {
      const data = entry.data, title = text(data.title) || '未命名音乐';
      const node = element('article', 'music-tile'); node.style.setProperty('--cover-hue', String((i * 47 + 170) % 360));
      node.style.setProperty('--preview-lightness', (19 + i % 5 * 3) + '%');
      let image;
      if (imageName.test(data.image || '')) {
        const img = element('img', 'music-tile-image'); img.src = (exported ? './media/public/' : '/media/public/') + data.image;
        img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; image = img;
        img.addEventListener('load', () => { if (tiles[selected]?.image === img) updateAmbient(); });
        img.addEventListener('error', () => { img.hidden = true; if (tiles[selected]?.image === img) updateAmbient(); }); node.append(img);
      }
      const button = element('button', 'music-tile-select'); button.type = 'button';
      button.setAttribute('aria-label', preview ? '预览第 ' + (i + 1) + ' 个空白封面' : '查看 ' + title + (text(data.artist) ? ' · ' + text(data.artist) : ''));
      button.append(element('span', 'music-tile-number', String(i + 1).padStart(2, '0')));
      if (!preview) {
        const caption = element('span', 'music-tile-caption');
        caption.append(element('strong', '', title));
        if (text(data.artist)) caption.append(element('small', '', text(data.artist)));
        button.append(caption);
      }
      button.addEventListener('click', () => choose(i));
      button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') { if (!event.repeat) press(node); return; }
        const next = { ArrowRight: Math.min(entries.length - 1, i + 1), ArrowDown: Math.min(entries.length - 1, i + 1), ArrowLeft: Math.max(0, i - 1), ArrowUp: Math.max(0, i - 1), Home: 0, End: entries.length - 1 }[event.key];
        if (next === undefined) return;
        clearPress();
        event.preventDefault(); event.stopPropagation(); choose(next, true);
      });
      button.addEventListener('keyup', event => { if (['Enter', ' ', 'Spacebar'].includes(event.key) && pressedNode === node) clearPress(); });
      button.addEventListener('blur', () => { if (pressedNode === node) clearPress(); });
      let detail, link;
      node.append(button);
      if (!preview) {
        detail = element('p', 'music-tile-note', text(data.description));
        link = element('a', 'music-tile-listen', '去听听 ↗');
        const url = address(data.url); if (url) link.setAttribute('href', url);
        link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', '收听 ' + title + '（新窗口）');
        link.hidden = true; detail.hidden = true; node.append(detail, link);
      }
      canvas.append(node); tiles.push({ node, button, detail, link, image });
    });
    arrange();
  }
  function setActive(value) {
    const entering = Boolean(value) && !active;
    active = value;
    ambience.hidden = !active || document.hidden;
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame); resizeFrame = 0;
    if (!active) { entrancePending = false; stop(); haltPan(); return; }
    // popstate/hashchange may notify the same route twice. Do not cancel an
    // in-flight pop (or cover exchange) just because activation repeats.
    if (!entering && !entrancePending && plan && root.clientWidth === lastWidth && root.clientHeight === lastHeight) return;
    if (entering) entrancePending = true;
    if (!refreshPreview()) arrange();
  }
  const resize = () => {
    if (!active || root.clientWidth === lastWidth && root.clientHeight === lastHeight || resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => { resizeFrame = 0; if (!refreshPreview()) arrange(); });
  };
  if (window.ResizeObserver) new window.ResizeObserver(resize).observe(root);
  else window.addEventListener('resize', resize);
  reduced.addEventListener('change', () => { entrancePending = false; stop(); haltPan(); if (active) arrange(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { entrancePending = false; stop(); haltPan(); if (resizeFrame) window.cancelAnimationFrame(resizeFrame); resizeFrame = 0; }
    else if (active) { if (!refreshPreview()) arrange(); }
    ambience.hidden = !active || document.hidden;
  });
  window.addEventListener('blur', haltPan);
  window.addEventListener('pagehide', () => { entrancePending = false; stop(); haltPan(); if (resizeFrame) window.cancelAnimationFrame(resizeFrame); resizeFrame = 0; });
  window.MusicWall = Object.freeze({ render, setActive, layout, transition, capacity, viewScale, palette });
})();
