(() => {
  const siteOrigin = "__SITE_ORIGIN__";
  const isKoi = "__WALLPAPER_KIND__" === "koi";
  let pond = null;
  let visible = true;
  let restoreProbe = () => {};
  let failed = false, ready = false, draws = 0, lastDraw = -1000;
  const reportError = (reason) => {
    if (ready || failed) return;
    failed = true;
    restoreProbe();
    parent.postMessage({ type: "pond:error", reason: String(reason || "壁纸脚本未能启动").slice(0, 240) }, siteOrigin);
  };
  // Installed before module execution. A successful HTTP load is not a frame.
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const observed = new WeakSet();
  const restorers = [];
  const probeGetContext = function (...args) {
    const context = originalGetContext.apply(this, args);
    if (context && !observed.has(context)) {
      observed.add(context);
      for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "drawImage", "fill", "fillRect", "stroke"]) {
        if (typeof context[name] !== "function") continue;
        const original = context[name];
        const own = Object.getOwnPropertyDescriptor(context, name);
        const probe = function (...values) {
          const result = original.apply(this, values);
          const now = performance.now();
          if (now - lastDraw > 16) { draws++; lastDraw = now; }
          return result;
        };
        context[name] = probe;
        restorers.push(() => {
          if (context[name] !== probe) return;
          if (own) Object.defineProperty(context, name, own);
          else delete context[name];
        });
      }
    }
    return context;
  };
  HTMLCanvasElement.prototype.getContext = probeGetContext;
  restoreProbe = () => {
    if (HTMLCanvasElement.prototype.getContext === probeGetContext) HTMLCanvasElement.prototype.getContext = originalGetContext;
    for (const restore of restorers.splice(0)) restore();
  };
  window.addEventListener("error", (event) => {
    if (event.message) reportError(event.message);
    else if (event.target?.tagName === "SCRIPT") reportError("壁纸脚本加载失败");
  }, true);
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason?.message || event.reason));

  window.addEventListener("wheel", (event) => {
    if (!Number.isFinite(event.deltaY)) return;
    window.parent.postMessage({ type: "pond:wheel", deltaY: event.deltaY, mode: event.deltaMode }, siteOrigin);
  }, { passive: true });

  function syncVisibility() {
    const running = visible && !document.hidden;
    if (pond) (running ? pond.start : pond.stop)();
    else window.wallpaperPropertyListener?.applyGeneralProperties?.({ fps: 30, isPaused: !running });
  }
  document.addEventListener("visibilitychange", syncVisibility);
  window.addEventListener("pagehide", () => { visible = false; syncVisibility(); restoreProbe(); });
  window.addEventListener("pageshow", (event) => { if (event.persisted) { visible = true; syncVisibility(); } });
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== siteOrigin || event.data?.type !== "pond:visibility") return;
    visible = Boolean(event.data.visible);
    syncVisibility();
  });

  window.addEventListener("load", async () => {
    try {
      if (isKoi) {
        pond = (await import("./src/app.js")).app;
        const internals = pond.inspect?.();
        if (internals?.config) {
          internals.config.fps = 30;
          internals.config.fishCount = window.innerWidth <= 760 ? 28 : 42;
          // The website renders its own local time; the wallpaper clock is cropped behind the site UI.
          internals.config.clockShow = false;
          pond.setFeature?.("clock", false);
          internals.population?.syncStock?.();
        }
        if (!visible || document.hidden) pond.stop();
      } else {
        // Pass declared defaults, not synthetic audio or private system state.
        const response = await fetch("/project.json");
        if (response.ok) {
          const project = await response.json();
          window.wallpaperPropertyListener?.applyUserProperties?.(project.general?.properties || {});
          syncVisibility();
        }
      }
      const since = performance.now();
      const check = () => {
        if (failed) return;
        if (draws >= 2 && performance.now() - since > 700) {
          ready = true;
          restoreProbe();
          parent.postMessage({ type: "pond:ready", evidence: "render" }, siteOrigin);
        } else if (performance.now() - since > 20000) reportError("未检测到画布渲染；可能不兼容或缺少运行依赖");
        else setTimeout(check, 100);
      };
      check();
    } catch (error) {
      reportError(error.message);
    }
  });
})();
