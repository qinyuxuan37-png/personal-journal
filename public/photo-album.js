/* Public-photo arc carousel. Browsing only; no private snapshot or lightbox. */
(() => {
  const exported = document.documentElement.hasAttribute('data-export');
  const imageName = /^[a-f0-9]{32}\.(jpg|png|webp|gif)$/;
  const text = value => typeof value === 'string' ? value : '';
  const controllers = new WeakMap();
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const modulo = (value, count) => ((value % count) + count) % count;
  function pose(offset, width) {
    // Approved first mockup: frontal center, mirrored inward-facing sides,
    // and a shallow U that recedes rather than nine equally tilted sheets.
    const distance = Math.abs(offset), extent = Math.min(distance, 4.6);
    const radius = clamp(width * .57, 168, 590), angle = offset * .225;
    const front = Math.exp(-offset * offset * 1.25);
    const rise = clamp(width * .13, 72, 130);
    return {
      x: Math.sin(angle) * radius,
      y: 42 + 10 * front - rise * (extent / 4) ** 1.45,
      z: 80 * front - extent * 25,
      yaw: (-Math.atan(offset * .36) * 180 / Math.PI) || 0,
      pitch: 2,
      scale: 1 + .07 * front - extent * .018,
      front
    };
  }
  function sheet(data, index) {
    const figure = document.createElement('figure');
    figure.className = 'album-sheet';
    figure.style.setProperty('--sheet-index', String(index));
    figure.setAttribute('role', 'listitem');
    const face = document.createElement('div');
    face.className = 'album-sheet-face';
    if (!data) {
      figure.classList.add('is-placeholder');
      figure.setAttribute('aria-hidden', 'true');
      const numeral = document.createElement('span');
      numeral.className = 'album-placeholder-number';
      numeral.textContent = String(index + 1).padStart(2, '0');
      face.append(numeral);
    } else {
      figure.tabIndex = 0;
      const title = text(data.title).trim() || '未命名照片';
      const img = document.createElement('img');
      img.alt = text(data.description).trim() || title;
      img.loading = 'lazy'; img.decoding = 'async';
      img.width = 400; img.height = 600;
      img.src = (exported ? './media/public/' : '/media/public/') + data.image;
      const fallback = document.createElement('span');
      fallback.className = 'album-image-fallback';
      fallback.textContent = '图片暂不可用'; fallback.hidden = true;
      img.addEventListener('error', () => { img.hidden = true; fallback.hidden = false; });
      const caption = document.createElement('figcaption');
      const name = document.createElement('strong'); name.textContent = title;
      caption.append(name);
      if (/^\d{4}-\d{2}-\d{2}$/.test(text(data.date))) {
        const time = document.createElement('time');
        time.dateTime = data.date; time.textContent = data.date.replaceAll('-', '.');
        caption.append(time);
      }
      face.append(img, fallback); figure.append(caption);
    }
    figure.prepend(face);
    return figure;
  }
  function mount(root, strip, valid, initialKey) {
    const viewport = root.querySelector('.album-viewport');
    const cards = [...strip.children], count = cards.length, cyclic = count >= 5;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const selected = valid.findIndex(entry => (entry.id || entry.data.image) === initialKey);
    let position = selected >= 0 ? selected : valid.length ? 0 : Math.floor(count / 2);
    let target = position, frame = 0, lastTime = null, wheelTimer = null, drag = null, disposed = false, onscreen = true;
    let width = viewport.clientWidth || 800;
    const cleanups = [];
    const listen = (node, event, callback, options) => {
      node.addEventListener(event, callback, options);
      cleanups.push(() => node.removeEventListener(event, callback, options));
    };
    const bounded = value => cyclic ? value : clamp(value, 0, count - 1);
    const offsetAt = index => cyclic ? modulo(index - position + count / 2, count) - count / 2 : index - position;
    function paint() {
      const current = modulo(Math.round(position), count);
      cards.forEach((card, index) => {
        const offset = offsetAt(index), distance = Math.abs(offset);
        const edge = cyclic ? Math.min(4.6, count / 2) : 4.6;
        // Keep the four side cards fully visible at rest; fade only as a card
        // wraps behind the arc, so it cannot teleport visibly across the panel.
        const opacity = clamp((edge - distance) / .4, 0, 1);
        card.hidden = opacity <= .001;
        card.tabIndex = valid.length && index === current ? 0 : -1;
        card.classList.toggle('is-current', index === current);
        if (valid.length) card.setAttribute('aria-current', index === current ? 'true' : 'false');
        if (card.hidden) return;
        const point = pose(offset, width);
        card.style.transform = `translate(-50%, -50%) translate3d(${point.x.toFixed(2)}px, ${point.y.toFixed(2)}px, ${point.z.toFixed(2)}px) rotateX(${point.pitch}deg) rotateY(${point.yaw.toFixed(2)}deg) scale(${point.scale.toFixed(3)})`;
        card.style.opacity = String(opacity);
        card.style.zIndex = String(100 - Math.round(distance * 10));
        card.style.setProperty('--sheet-front', String(point.front));
      });
    }
    function stop() {
      if (frame) window.cancelAnimationFrame(frame);
      if (wheelTimer !== null) window.clearTimeout(wheelTimer);
      frame = 0; wheelTimer = null; lastTime = null;
    }
    function rest() {
      stop();
      position = target = cyclic ? modulo(Math.round(target), count) : bounded(Math.round(target));
      paint();
    }
    function tick(now) {
      frame = 0;
      if (disposed || document.hidden || !onscreen) { rest(); return; }
      const elapsed = lastTime === null ? 1000 / 60 : clamp(now - lastTime, 0, 64);
      lastTime = now;
      position += (target - position) * (1 - Math.exp(-elapsed / 78));
      if (Math.abs(target - position) < .001) { position = target; lastTime = null; paint(); return; }
      paint(); frame = window.requestAnimationFrame(tick);
    }
    function move(next, immediate = false) {
      target = bounded(next);
      if (reduced.matches || immediate) {
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0; lastTime = null; position = target; paint();
      } else if (!frame) frame = window.requestAnimationFrame(tick);
    }
    const step = () => clamp(width * .09, 44, 86);
    function finishDrag(event) {
      if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
      const pointerId = drag.id; drag = null;
      viewport.classList.remove('is-dragging');
      if (viewport.hasPointerCapture?.(pointerId)) viewport.releasePointerCapture(pointerId);
      move(Math.round(target));
    }
    listen(viewport, 'wheel', event => {
      if (event.ctrlKey || event.metaKey || count < 2 || document.hidden || drag) return;
      const amount = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!Number.isFinite(amount) || !amount) return;
      event.preventDefault(); event.stopPropagation();
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      if (reduced.matches) { move(Math.round(target) + Math.sign(amount), true); return; }
      move(target + clamp(amount * units / 150, -1.2, 1.2));
      if (wheelTimer !== null) window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => { wheelTimer = null; move(Math.round(target)); }, 150);
    }, { passive: false });
    listen(viewport, 'pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false || count < 2 || drag) return;
      stop(); target = position;
      drag = { id: event.pointerId, x: event.clientX, position };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('is-dragging');
      viewport.focus({ preventScroll: true });
      event.preventDefault();
    });
    listen(viewport, 'pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      move(drag.position + (drag.x - event.clientX) / step(), true);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(viewport, type, finishDrag);
    listen(viewport, 'dragstart', event => event.preventDefault());
    listen(viewport, 'keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      let next;
      if (event.key === 'ArrowRight') next = Math.round(target) + 1;
      else if (event.key === 'ArrowLeft') next = Math.round(target) - 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = count - 1;
      else return;
      event.preventDefault(); event.stopPropagation();
      viewport.focus({ preventScroll: true }); stop(); move(next);
    });
    const suspend = () => { finishDrag(); rest(); };
    listen(document, 'visibilitychange', () => { if (document.hidden) suspend(); });
    listen(window, 'pagehide', suspend);
    listen(window, 'blur', suspend);
    listen(reduced, 'change', () => { if (reduced.matches) suspend(); });
    if (window.ResizeObserver) {
      const observer = new window.ResizeObserver(() => { width = viewport.clientWidth || width; paint(); });
      observer.observe(viewport); cleanups.push(() => observer.disconnect());
    } else listen(window, 'resize', () => { width = viewport.clientWidth || width; paint(); });
    if (window.IntersectionObserver) {
      const observer = new window.IntersectionObserver(records => {
        onscreen = records[0]?.isIntersecting !== false;
        if (!onscreen) suspend();
      });
      observer.observe(viewport); cleanups.push(() => observer.disconnect());
    }
    paint();
    return {
      key: () => { const entry = valid[modulo(Math.round(position), count)]; return entry?.id || entry?.data.image; },
      dispose() { disposed = true; suspend(); cleanups.forEach(cleanup => cleanup()); }
    };
  }
  function render(root, entries = []) {
    if (!root) return;
    const previous = controllers.get(root), initialKey = previous?.key();
    previous?.dispose();
    const strip = root.querySelector('.album-strip');
    const valid = (Array.isArray(entries) ? entries : []).filter(entry =>
      entry?.kind === 'gallery' && imageName.test(text(entry.data?.image)));
    strip.replaceChildren();
    root.querySelector('.album-count').textContent = `${valid.length} 张`;
    root.querySelector('.album-empty').hidden = valid.length > 0;
    strip.classList.toggle('is-empty', valid.length === 0);
    if (valid.length) valid.forEach((entry, index) => strip.append(sheet(entry.data, index)));
    else for (let index = 0; index < 9; index++) strip.append(sheet(null, index));
    controllers.set(root, mount(root, strip, valid, initialKey));
  }
  window.PhotoAlbum = Object.freeze({ render, pose });
})();
