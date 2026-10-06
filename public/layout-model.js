/* Versioned grid data only: no CSS, DOM or personal content in a layout. */
(() => {
  const cols = 24, rows = 16;
  const minimums = { profile: [9, 7], clock: [6, 4] };
  const legacyMinimums = { ...minimums, tech: [5, 3], projects: [5, 3], interests: [5, 3] };
  const ids = Object.keys(minimums);
  const copy = (value) => value == null ? null : JSON.parse(JSON.stringify(value));
  const defaults = () => ({ version: 2, items: {
    profile: { x: 0, y: 3, w: 10, h: 10 }, clock: { x: 18, y: 0, w: 6, h: 5 }
  } });
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  function validSchema(value, version, sizes) {
    const keys = Object.keys(sizes);
    if (!value || value.version !== version || !value.items || Object.keys(value).length !== 2 || Object.keys(value.items).length !== keys.length) return false;
    return keys.every((id, index) => {
      const box = value.items[id];
      if (!box || Object.keys(box).sort().join() !== "h,w,x,y" || !Object.values(box).every(Number.isInteger)) return false;
      const [w, h] = sizes[id];
      return box.x >= 0 && box.y >= 0 && box.w >= w && box.h >= h && box.x + box.w <= cols && box.y + box.h <= rows &&
        keys.slice(index + 1).every((other) => value.items[other] && !overlaps(box, value.items[other]));
    });
  }
  // Drop retired entry cards without moving the user's identity or clock.
  function normalize(value) {
    if (validSchema(value, 2, minimums)) return copy(value);
    if (validSchema(value, 1, legacyMinimums)) return { version: 2, items: {
      profile: copy(value.items.profile), clock: copy(value.items.clock)
    } };
    return null;
  }
  const valid = (value) => normalize(value) !== null;
  const equal = (a, b) => a === null || b === null ? a === b :
    ids.every((id) => ["x", "y", "w", "h"].every((key) => a.items[id][key] === b.items[id][key]));
  function change(layout, id, dx, dy, resize = false) {
    if (!ids.includes(id) || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    const next = layout == null ? defaults() : normalize(layout);
    if (!next) return null;
    const box = next.items[id], [w, h] = minimums[id];
    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    if (resize) {
      box.w = clamp(box.w + Math.round(dx), w, cols - box.x);
      box.h = clamp(box.h + Math.round(dy), h, rows - box.y);
    } else {
      box.x = clamp(box.x + Math.round(dx), 0, cols - box.w);
      box.y = clamp(box.y + Math.round(dy), 0, rows - box.h);
    }
    return valid(next) ? next : null;
  }
  class History {
    constructor(initial = null) { this.states = [normalize(initial)]; this.index = 0; }
    current() { return copy(this.states[this.index]); }
    push(value) {
      if (equal(this.current(), value)) return;
      this.states.splice(this.index + 1);
      this.states.push(normalize(value));
      if (this.states.length > 80) this.states.shift();
      this.index = this.states.length - 1;
    }
    undo() { this.index = Math.max(0, this.index - 1); return this.current(); }
    redo() { this.index = Math.min(this.states.length - 1, this.index + 1); return this.current(); }
    get canUndo() { return this.index > 0; }
    get canRedo() { return this.index < this.states.length - 1; }
  }
  window.SpaceLayout = Object.freeze({ cols, rows, ids, defaults, valid, normalize, equal, change, copy, History });
})();
