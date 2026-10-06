(() => {
  const opening = document.getElementById("opening");
  const reveal = document.getElementById("opening-reveal");
  const shell = document.getElementById("site-shell");
  const homePanels = () => window.HomePages?.ids || [...document.querySelectorAll('#content > [data-home-page][id]')].map(panel => panel.id);
  const panels = () => [...homePanels(), "music", "tech", "projects", "interests"];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const initialHash = window.location.hash.length > 1;
  const skipRequested = new URLSearchParams(window.location.search).has("skipIntro");
  const isExport = document.documentElement.getAttribute("data-export") !== null;
  const preferenceKey = "personal-space.opening.v1", seenKey = "personal-space.opening-seen.v1";
  function getPreference() {
    try {
      const value = isExport ? "always" : window.localStorage.getItem(preferenceKey);
      return ["always", "session", "never"].includes(value) ? value : "always";
    } catch { return "always"; }
  }
  window.OpeningControls = Object.freeze({
    getPreference,
    setPreference(value) {
      if (isExport || !["always", "session", "never"].includes(value)) return false;
      try { window.localStorage.setItem(preferenceKey, value); return true; } catch { return false; }
    }
  });
  let seenThisTab = false;
  try { seenThisTab = window.sessionStorage.getItem(seenKey) === "1"; } catch { /* Storage may be unavailable. */ }
  const seen = new WeakSet();
  let revealObserver = null;
  let openingActive = false;
  let finishing = false;
  let pressStart = null;
  let dragged = false;
  let frame = 0;
  let lastFrame = null;
  let activePanel = null;
  const panelNames = { music: "爱听的音乐", tech: "技术栈", projects: "开源项目", interests: "兴趣收藏" };

  const radius = () => window.innerWidth <= 760
    ? Math.min(160, Math.max(104, window.innerWidth * 0.27))
    : Math.min(205, Math.max(125, window.innerWidth * 0.13));
  const angleFor = (x, y) => Math.max(
    -15,
    Math.min(
      15,
      (x / window.innerWidth - 0.5) * 26 +
      (y / window.innerHeight - 0.5) * 8
    )
  );
  const current = {
    x: window.innerWidth * (window.innerWidth > 760 ? 0.62 : 0.72),
    y: window.innerHeight * 0.5,
    r: radius(),
    angle: 0
  };
  const target = { ...current };

  function paintSpot() {
    const x = current.x.toFixed(1) + "px";
    const y = current.y.toFixed(1) + "px";
    const r = current.r.toFixed(1) + "px";
    reveal.style.clipPath = "circle(" + r + " at " + x + " " + y + ")";
    opening.style.setProperty("--spot-x", x);
    opening.style.setProperty("--spot-y", y);
    opening.style.setProperty("--spot-r", r);
    opening.style.setProperty("--inner-rotate", current.angle.toFixed(2) + "deg");
    opening.style.setProperty("--outer-rotate", (-current.angle * 0.26).toFixed(2) + "deg");
  }

  function animateSpot(timestamp) {
    frame = 0;
    if (!openingActive || finishing) return;
    // Use elapsed time so a 144 Hz display does not feel faster than a 60 Hz one.
    const elapsed = lastFrame === null ? 1000 / 60 : Math.max(1, Math.min(48, timestamp - lastFrame));
    lastFrame = timestamp;
    const follow = 1 - Math.exp(-elapsed / 78);
    current.x += (target.x - current.x) * follow;
    current.y += (target.y - current.y) * follow;
    current.r += (target.r - current.r) * (1 - Math.exp(-elapsed / 96));
    current.angle += (target.angle - current.angle) * (1 - Math.exp(-elapsed / 130));
    paintSpot();
    if (
      Math.abs(target.x - current.x) > 0.35 ||
      Math.abs(target.y - current.y) > 0.35 ||
      Math.abs(target.r - current.r) > 0.35 ||
      Math.abs(target.angle - current.angle) > 0.03
    ) frame = requestAnimationFrame(animateSpot);
    else { lastFrame = null; Object.assign(current, target); paintSpot(); }
  }

  function scheduleSpot() {
    if (reduced) {
      Object.assign(current, target);
      paintSpot();
    } else if (!frame) {
      frame = requestAnimationFrame(animateSpot);
    }
  }

  function observeReveals() {
    const items = document.querySelectorAll(".reveal-item");
    if (reduced || !("IntersectionObserver" in window)) {
      items.forEach((item) => item.classList.add("is-visible"));
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver((records) => {
        records.forEach((record) => {
          if (!record.isIntersecting) return;
          record.target.classList.add("is-visible");
          revealObserver.unobserve(record.target);
        });
      }, { threshold: 0.08, rootMargin: "0px 0px -4% 0px" });
    }
    items.forEach((item) => {
      if (seen.has(item)) return;
      seen.add(item);
      revealObserver.observe(item);
    });
  }

  function showPanel(id, focus = false) {
    const active = panels().includes(id) ? id : (homePanels()[0] || "about");
    const changed = activePanel !== active;
    window.HomePages?.reset();
    document.body.classList.toggle("home-view", homePanels().includes(active));
    document.body.classList.toggle("music-view", active === "music");
    panels().forEach((name) => {
      const panel = document.getElementById(name);
      if (!panel) return;
      const selected = name === active;
      panel.classList.toggle("is-active", selected);
      panel.inert = !selected;
      if (selected && changed) panel.scrollTop = 0;
      if (selected) panel.querySelectorAll(".reveal-item").forEach((item) => item.classList.add("is-visible"));
    });
    window.MusicWall?.setActive(active === "music");
    window.HomePages?.change(activePanel, active);
    activePanel = active;
    if (changed && document.body.classList.contains("site-ready")) {
      document.getElementById("panel-announcement").textContent = "已打开" + (window.HomePages?.label(active) || panelNames[active] || document.getElementById(active).getAttribute('aria-label') || active);
    }
    if (focus && !openingActive) document.getElementById(active).querySelector("h1,h2")?.focus({ preventScroll: true });
  }

  function finishOpening(focusMain = true) {
    if (openingActive || finishing) {
      try { window.sessionStorage.setItem(seenKey, "1"); } catch { /* Entering never depends on storage. */ }
    }
    openingActive = false;
    finishing = false;
    opening.hidden = true;
    opening.removeAttribute("aria-busy");
    shell.inert = false;
    document.body.classList.remove("intro-active");
    document.body.classList.remove("intro-revealing");
    document.body.classList.remove("intro-transition");
    document.body.classList.add("site-ready");
    observeReveals();
    document.dispatchEvent(new Event("intro:finished"));
    if (focusMain) document.getElementById(activePanel).querySelector("h1,h2")?.focus({ preventScroll: true });
  }

  async function leaveOpening() {
    if (finishing || !openingActive) return;
    finishing = true;
    openingActive = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    opening.setAttribute("aria-busy", "true");
    if (reduced) {
      finishOpening();
      return;
    }
    // Keep the current composition while assets prepare; never park on a full black screen.
    opening.classList.add("is-preparing");
    const wait = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));
    await Promise.all([
      wait(120),
      Promise.race([Promise.resolve(window.wallpaperReady).catch(() => {}), wait(1800)])
    ]);
    opening.classList.remove("is-preparing");
    opening.classList.add("is-expanding");
    document.body.classList.add("intro-transition");
    const x = current.x;
    const y = current.y;
    const distance = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    ) + 80;
    reveal.style.clipPath = "circle(" + distance + "px at " + x + "px " + y + "px)";
    // Expansion and crossfade overlap, revealing the same running wallpaper beneath.
    window.setTimeout(() => opening.classList.add("is-exiting"), 100);
    window.setTimeout(() => document.body.classList.add("intro-revealing"), 220);
    window.setTimeout(() => finishOpening(), 1000);
  }

  function startOpening() {
    if (openingActive || finishing) return;
    opening.classList.remove("is-ready", "is-preparing", "is-expanding", "is-exiting");
    document.body.classList.remove("site-ready");
    lastFrame = null; pressStart = null; dragged = false;
    Object.assign(current, { x: window.innerWidth * .62, y: window.innerHeight * .5, r: radius(), angle: 0 });
    Object.assign(target, current);
    opening.hidden = false;
    openingActive = true;
    shell.inert = true;
    document.body.classList.add("intro-active");
    opening.tabIndex = -1;
    opening.focus({ preventScroll: true });
    paintSpot();
    requestAnimationFrame(() => opening.classList.add("is-ready"));
  }
  document.documentElement.classList.add("motion-enabled");
  document.body.classList.add("single-screen");
  showPanel(window.location.hash.slice(1));
  const preference = getPreference();
  if (initialHash || skipRequested || preference === "never" || (preference === "session" && seenThisTab)) finishOpening(false);
  else startOpening();
  document.addEventListener("intro:preview", () => {
    if (!document.body.classList.contains("layout-editing") && !document.querySelector("dialog[open]")) startOpening();
  });

  opening.addEventListener("pointermove", (event) => {
    if (!openingActive || event.isPrimary === false) return;
    if (pressStart && Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 10) dragged = true;
    target.x = Math.max(0, Math.min(window.innerWidth, event.clientX));
    target.y = Math.max(0, Math.min(window.innerHeight, event.clientY));
    target.angle = angleFor(target.x, target.y);
    scheduleSpot();
  });
  opening.addEventListener("pointerdown", (event) => {
    if (!openingActive || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    pressStart = { x: event.clientX, y: event.clientY };
    dragged = false;
    target.x = event.clientX;
    target.y = event.clientY;
    target.angle = angleFor(target.x, target.y);
    target.r = radius() * 1.25;
    scheduleSpot();
  });
  window.addEventListener("pointerup", () => {
    pressStart = null;
    if (!openingActive) return;
    target.r = radius();
    scheduleSpot();
  });
  window.addEventListener("pointercancel", () => {
    pressStart = null;
    dragged = true;
    if (!openingActive) return;
    target.r = radius();
    scheduleSpot();
  });
  window.addEventListener("blur", () => {
    if (pressStart) dragged = true;
    pressStart = null;
    target.r = radius();
    lastFrame = null;
    if (openingActive) scheduleSpot();
  });
  opening.addEventListener("click", (event) => {
    if (dragged) { dragged = false; return; }
    if (openingActive && Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY) && event.detail !== 0) {
      current.x = Math.max(0, Math.min(window.innerWidth, event.clientX));
      current.y = Math.max(0, Math.min(window.innerHeight, event.clientY));
      paintSpot();
    }
    leaveOpening();
  });
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    if (!link) return;
    const id = link.getAttribute("href").slice(1);
    if (!panels().includes(id)) return;
    event.preventDefault();
    if (window.location.hash !== "#" + id) history.pushState(null, "", "#" + id);
    showPanel(id, true);
  });
  window.addEventListener("popstate", () => showPanel(window.location.hash.slice(1), true));
  window.addEventListener("hashchange", () => showPanel(window.location.hash.slice(1), true));
  document.addEventListener("homepages:changed", () => {
    const next = panels().includes(activePanel) ? activePanel : (homePanels()[0] || "about");
    if (next !== activePanel) history.replaceState(null, "", "#" + next);
    showPanel(next);
  });
  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]")) return;
    if (event.key !== "Escape" || openingActive || finishing || activePanel === "about") return;
    event.preventDefault();
    const parent = activePanel === "music" ? "interests" : "about";
    if (window.location.hash !== "#" + parent) history.pushState(null, "", "#" + parent);
    showPanel(parent, true);
  });
  opening.addEventListener("keydown", (event) => {
    if (!openingActive) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      leaveOpening();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      opening.focus({ preventScroll: true });
      return;
    }
    const directions = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      ArrowUp: [0, -1], ArrowDown: [0, 1]
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 96 : 48;
    target.x = Math.max(0, Math.min(window.innerWidth, target.x + direction[0] * step));
    target.y = Math.max(0, Math.min(window.innerHeight, target.y + direction[1] * step));
    target.angle = angleFor(target.x, target.y);
    scheduleSpot();
  });
  window.addEventListener("resize", () => {
    if (openingActive) {
      target.r = radius();
      target.x = Math.max(target.r, Math.min(window.innerWidth - target.r, target.x));
      target.y = Math.max(target.r, Math.min(window.innerHeight - target.r, target.y));
      target.angle = angleFor(target.x, target.y);
      scheduleSpot();
    }
  });
  document.addEventListener("public:rendered", () => {
    if (!openingActive) observeReveals();
  });
})();
