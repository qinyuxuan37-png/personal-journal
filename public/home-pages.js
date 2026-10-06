(() => {
  const content = document.getElementById('content');
  const nav = document.getElementById('home-pagination');
  if (!content || !nav) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 'about', cleanup = null, gesture = null, wheelTotal = 0, wheelTime = 0, wheelLock = 0;
  const duration = 520, easing = 'cubic-bezier(.333333,1,.666667,1)';
  let pages = [], labels = new Map(), dotFrame = 0, dotX = null, dotTarget = null;
  const dotLinks = () => [...nav.querySelectorAll('a')];
  function paintDot(x, strength = 0, direction = 1) {
    dotX = x;
    nav.style.setProperty('--dot-x', `${x}px`);
    nav.style.setProperty('--dot-scale-x', String(1 + .25 * strength));
    nav.style.setProperty('--dot-scale-y', String(1 - .06 * strength));
    nav.style.setProperty('--tail-tip', `${x - direction * 3}px`);
    nav.style.setProperty('--tail-direction', String(direction));
    nav.style.setProperty('--tail-width', `${14 * strength}px`);
    nav.style.setProperty('--tail-opacity', String(.32 * strength));
  }
  function stopDot(snap = true) {
    if (dotFrame) window.cancelAnimationFrame(dotFrame);
    dotFrame = 0;
    if (dotX !== null) paintDot(snap && dotTarget !== null ? dotTarget : dotX);
  }
  function moveDot(id, animate) {
    const link = dotLinks().find(item => item.getAttribute('href') === '#' + id);
    if (!link) { stopDot(); return; }
    // Measure the actual button center, not a fixed index * spacing assumption.
    const target = link.offsetLeft + link.offsetWidth / 2;
    stopDot(false);
    dotTarget = target;
    nav.classList.add('has-dot-indicator');
    if (link.offsetLeft < nav.scrollLeft) nav.scrollLeft = link.offsetLeft;
    else if (link.offsetLeft + link.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = link.offsetLeft + link.offsetWidth - nav.clientWidth;
    }
    if (!animate || dotX === null || Math.abs(target - dotX) < .1) { paintDot(target); return; }
    const from = dotX, distance = target - from, direction = Math.sign(distance), start = performance.now();
    const tick = now => {
      const progress = Math.min(1, Math.max(0, (now - start) / duration));
      // One clock drives travel, stretch and a bounded tail in both directions.
      // Retarget from the last painted center when a click interrupts this flight.
      const eased = 1 - (1 - progress) ** 3;
      const strength = progress === 1 ? 0 : Math.sin(Math.PI * progress) * Math.min(1, Math.abs(distance) / 14);
      paintDot(from + distance * eased, strength, direction);
      dotFrame = progress < 1 ? window.requestAnimationFrame(tick) : 0;
    };
    dotFrame = window.requestAnimationFrame(tick);
  }
  function refresh() {
    reset(); stopDot();
    const panels = [...content.querySelectorAll(':scope > [data-home-page][id]')];
    const existing = new Map(dotLinks().map(link => [link.getAttribute('href').slice(1), link]));
    pages = []; labels = new Map();
    const links = [];
    for (const panel of panels) {
      if (pages.includes(panel.id)) continue;
      pages.push(panel.id);
      const label = panel.getAttribute('aria-label') || `第 ${pages.length} 页`;
      labels.set(panel.id, label);
      const link = existing.get(panel.id) || document.createElement('a');
      link.setAttribute('href', '#' + panel.id);
      link.setAttribute('aria-label', '切换到' + label);
      links.push(link);
    }
    nav.replaceChildren(...links);
    dotX = dotTarget = null;
    nav.classList.remove('has-dot-indicator');
    document.dispatchEvent(new Event('homepages:changed'));
    return pages.slice();
  }
  const blockedTarget = target => target?.closest?.('a,button,input,textarea,select,[contenteditable],summary,[role="slider"],[data-page-gesture-lock],.layout-handle,svg');
  const allowed = () => pages.includes(current) && !document.querySelector('dialog[open]') &&
    !['intro-active', 'intro-transition', 'layout-editing', 'studio-open'].some(name => document.body.classList.contains(name));
  function reset() { cleanup?.(); cleanup = null; gesture = null; }
  function change(previous, next) {
    current = next;
    const index = pages.indexOf(next);
    const animate = previous !== next && pages.includes(previous) && index >= 0 && !reduced.matches && !document.hidden;
    moveDot(next, animate);
    nav.querySelectorAll('a').forEach(link => {
      if (link.getAttribute('href') === '#' + next) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (!animate) return;
    const outgoing = document.getElementById(previous), incoming = document.getElementById(next);
    if (!incoming.animate || !outgoing.animate) return;
    const direction = pages.indexOf(next) > pages.indexOf(previous) ? 1 : -1;
    outgoing.classList.add('is-active', 'page-sliding'); incoming.classList.add('page-sliding');
    outgoing.inert = true;
    const options = { duration, easing, fill: 'both' };
    const animations = [
      outgoing.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-direction * 110}%)` }], options),
      incoming.animate([{ transform: `translateX(${direction * 110}%)` }, { transform: 'translateX(0)' }], options)
    ];
    let done = false, timer;
    const finish = () => {
      if (done) return; done = true; window.clearTimeout(timer);
      outgoing.classList.remove('is-active', 'page-sliding'); incoming.classList.remove('page-sliding');
      animations.forEach(animation => animation.cancel());
      if (cleanup === finish) cleanup = null;
    };
    cleanup = finish;
    timer = window.setTimeout(finish, 650);
    Promise.all(animations.map(animation => animation.finished)).then(finish, finish);
  }
  function go(direction) {
    if (!allowed()) return false;
    const next = pages[pages.indexOf(current) + direction];
    if (!next) return false;
    const link = [...nav.querySelectorAll('a')].find(item => item.getAttribute('href') === '#' + next);
    if (!link) return false;
    link.click();
    return true;
  }
  // Only foreground card surfaces bubble here. Empty space belongs to the
  // isolated wallpaper iframe: do not replay its clicks/drags into navigation.
  content.addEventListener('pointerdown', event => {
    gesture = null;
    if (!allowed() || blockedTarget(event.target) || event.button !== 0 || event.isPrimary === false) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  content.addEventListener('pointerup', event => {
    const start = gesture; gesture = null;
    if (!start || start.id !== event.pointerId || !allowed() || blockedTarget(event.target)) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  });
  content.addEventListener('pointercancel', () => { gesture = null; });
  // Horizontal touchpad gestures (or Shift + wheel) only; ordinary vertical
  // scrolling and Ctrl + wheel zoom remain untouched.
  content.addEventListener('wheel', event => {
    if (!allowed() || event.ctrlKey || blockedTarget(event.target)) return;
    const x = event.shiftKey ? event.deltaY || event.deltaX : event.deltaX;
    if (!x || (!event.shiftKey && Math.abs(x) <= Math.abs(event.deltaY))) return;
    const now = performance.now();
    event.preventDefault();
    if (now < wheelLock) { wheelLock = now + 260; return; }
    if (now - wheelTime > 180 || Math.sign(x) !== Math.sign(wheelTotal)) wheelTotal = 0;
    wheelTime = now;
    wheelTotal += x * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? content.clientWidth : 1);
    if (Math.abs(wheelTotal) >= 64) {
      go(wheelTotal > 0 ? 1 : -1); wheelTotal = 0; wheelLock = now + 600;
    }
  }, { passive: false });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || blockedTarget(event.target)) return;
    if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && go(event.key === 'ArrowRight' ? 1 : -1)) event.preventDefault();
  });
  reduced.addEventListener('change', () => { if (reduced.matches) { reset(); stopDot(); } });
  window.addEventListener('blur', () => { gesture = null; });
  window.addEventListener('resize', () => { reset(); moveDot(current, false); });
  window.addEventListener('pagehide', () => { reset(); stopDot(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { reset(); stopDot(); } });
  window.HomePages = Object.freeze({ reset, change, refresh, get ids() { return pages.slice(); }, label: id => labels.get(id) });
  refresh();
})();
