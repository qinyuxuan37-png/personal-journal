/* Standalone, opt-in local diagnostic. Not included in the production homepage.
 * No content/settings writes. Reports numerical telemetry only via the existing
 * loopback HTTP access log; no external collector or new privileged endpoint.
 */
(() => {
  'use strict';
  if (!['127.0.0.1', 'localhost'].includes(location.hostname)) return;
  const frame = document.getElementById('site');
  const status = document.getElementById('progress');
  const output = document.getElementById('results');
  const run = crypto.randomUUID();
  const controller = new AbortController();
  const reports = [];
  let win, doc, editorOpened = false, mapOpened = false;
  const round = n => Math.round(n * 100) / 100;
  function report(phase, values = {}) {
    const record = { run, phase, ...values };
    reports.push(record);
    output.textContent = JSON.stringify(reports, null, 2);
    // This serves a normal existing local asset. The query is saved by the
    // server's existing access log, without touching the journal databases.
    void fetch('/public/favicon.svg?perf_probe=' + encodeURIComponent(JSON.stringify(record)), {
      cache: 'no-store', credentials: 'omit', signal: controller.signal
    }).catch(() => {});
  }
  function check() { if (controller.signal.aborted) throw new Error('检测已停止'); }
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(predicate, timeout = 15000) {
    const end = performance.now() + timeout;
    while (!predicate()) {
      check(); if (performance.now() > end) throw new Error('等待页面状态超时');
      await delay(100);
    }
  }
  function snapshot() {
    const heap = win.performance.memory;
    const editor = doc.getElementById('studio-frame');
    let editorNodes = 0;
    try { editorNodes = editor?.contentDocument?.querySelectorAll('*').length || 0; } catch { /* only same-origin counts */ }
    return {
      jsHeapEstimateMiB: heap ? round(heap.usedJSHeapSize / 1048576) : null,
      heapAllocatedMiB: heap ? round(heap.totalJSHeapSize / 1048576) : null,
      domNodes: doc.querySelectorAll('*').length, editorNodes,
      siteIframeCount: doc.querySelectorAll('iframe').length,
      fullCityDatasetInPage: Boolean(win.OfflineGeoData),
      editorOpen: Boolean(doc.getElementById('studio-dialog')?.open),
      wallpaperReadyClass: doc.body.classList.contains('wallpaper-ready'),
      wallpaperStatusVisible: !doc.getElementById('pond-status')?.hidden,
      viewport: [win.innerWidth, win.innerHeight], documentVisible: !doc.hidden
    };
  }
  async function sample(phase, milliseconds) {
    check(); status.textContent = `检测中：${phase} · 请保持前台`;
    const before = snapshot(), intervals = [];
    let previous, raf, observer, longTasks = 0, longTaskMs = 0, invalidVisibility = document.hidden;
    const visibility = () => { if (document.hidden) invalidVisibility = true; };
    document.addEventListener('visibilitychange', visibility);
    const tick = now => {
      if (previous !== undefined) intervals.push(now - previous);
      previous = now; raf = win.requestAnimationFrame(tick);
    };
    const observe = entries => { for (const entry of entries) { longTasks++; longTaskMs += entry.duration; } };
    const supportsLongTasks = win.PerformanceObserver?.supportedEntryTypes?.includes('longtask') || false;
    if (supportsLongTasks) {
      observer = new win.PerformanceObserver(list => observe(list.getEntries()));
      observer.observe({ type: 'longtask' });
    }
    raf = win.requestAnimationFrame(tick);
    const started = performance.now();
    try {
      const end = started + milliseconds;
      while (performance.now() < end) { check(); await delay(200); }
    } finally {
      win.cancelAnimationFrame(raf);
      if (observer) { observe(observer.takeRecords()); observer.disconnect(); }
      document.removeEventListener('visibilitychange', visibility);
    }
    check();
    const elapsed = performance.now() - started;
    const sorted = intervals.slice().sort((a, b) => a - b);
    report(phase, {
      validForegroundSample: !invalidVisibility,
      durationMs: round(elapsed), before, after: snapshot(),
      rafCallbacksPerSecond: round((intervals.length + 1) * 1000 / elapsed),
      frameIntervalP95Ms: sorted.length ? round(sorted[Math.floor((sorted.length - 1) * .95)]) : null,
      gapsOver50ms: intervals.filter(n => n > 50).length,
      longTasks: supportsLongTasks ? longTasks : null,
      longTaskMs: supportsLongTasks ? round(longTaskMs) : null
    });
  }
  async function openEditor() {
    check();
    const link = doc.querySelector('a[data-local-only][href="/studio"]');
    if (!link) throw new Error('未找到编辑空间入口');
    link.click(); editorOpened = true;
    await waitFor(() => doc.getElementById('studio-dialog').open && doc.getElementById('studio-dialog').classList.contains('studio-ready'));
  }
  async function closeEditor() {
    doc.getElementById('studio-close').click();
    await waitFor(() => !doc.getElementById('studio-dialog').open);
    editorOpened = false;
  }
  function cleanup() {
    if (editorOpened) doc?.getElementById('studio-close')?.click();
    if (mapOpened) doc?.getElementById('map-close')?.click();
  }
  document.getElementById('stop').addEventListener('click', () => {
    cleanup(); controller.abort(); status.textContent = '已停止检测，不会继续操作面板';
  });
  window.addEventListener('pagehide', () => { cleanup(); controller.abort(); });
  async function runCheck() {
    report('started', { hidden: document.hidden, scope: 'temporary same-origin iframe; JS heap estimate excludes isolated wallpaper/GPU' });
    frame.src = '/?skipIntro=1#about';
    await waitFor(() => frame.contentWindow?.publicProfile, 30000);
    win = frame.contentWindow; doc = frame.contentDocument;
    const wallpaperEvents = [];
    const onWallpaper = event => {
      const wallpaper = doc.getElementById('pond-frame');
      if (event.source !== wallpaper?.contentWindow || !['pond:ready', 'pond:error'].includes(event.data?.type)) return;
      if (wallpaperEvents.length < 8) wallpaperEvents.push(event.data.type);
    };
    win.addEventListener('message', onWallpaper);
    try {
      status.textContent = '等待地图、壁纸加载…';
      await Promise.race([win.wallpaperReady || Promise.resolve(), delay(50000)]);
      await delay(3000); check();
      report('loaded', { ...snapshot(), wallpaperEvents });
      if (new URLSearchParams(location.search).has('pages')) {
        const wallpaper = doc.getElementById('pond-frame');
        const source = wallpaper.src, before = wallpaper.getBoundingClientRect();
        doc.getElementById('photos-page-link').click();
        await delay(160);
        const during = wallpaper.getBoundingClientRect();
        report('pages-transition', {
          homeTransform: win.getComputedStyle(doc.getElementById('about')).transform,
          photoTransform: win.getComputedStyle(doc.getElementById('photos')).transform,
          wallpaperStationary: before.x === during.x && before.y === during.y,
          sameWallpaper: doc.getElementById('pond-frame') === wallpaper && wallpaper.src === source
        });
        await delay(650);
        const photo = doc.getElementById('photos'), photoStyle = win.getComputedStyle(photo);
        report('pages-photo', {
          active: photo.classList.contains('is-active'), width: photo.clientWidth, height: photo.clientHeight,
          background: photoStyle.backgroundColor, transform: photoStyle.transform,
          homeHidden: win.getComputedStyle(doc.getElementById('about')).display === 'none',
          sameWallpaper: doc.getElementById('pond-frame') === wallpaper && wallpaper.src === source
        });
        doc.getElementById('home-page-link').click(); await delay(80);
        doc.getElementById('photos-page-link').click(); await delay(80);
        doc.getElementById('home-page-link').click(); await delay(750);
        report('pages-complete', {
          homeActive: doc.getElementById('about').classList.contains('is-active'),
          photosHidden: win.getComputedStyle(photo).display === 'none',
          leftoverSlidingLayers: doc.querySelectorAll('.page-sliding').length,
          sameWallpaper: doc.getElementById('pond-frame') === wallpaper && wallpaper.src === source
        });
        status.textContent = '横向切屏检测完成';
        frame.src = 'about:blank'; frame.hidden = true;
        document.querySelector('details').open = true;
        document.getElementById('stop').disabled = true;
        return;
      }
      await sample('homepage', 10000);
      await openEditor(); await sample('editor-open', 8000);
      await closeEditor(); await sample('editor-closed', 8000);
      status.textContent = '检测中：重复开关编辑空间 5 次';
      const editorFrame = doc.getElementById('studio-frame'), editorDocument = editorFrame.contentDocument;
      for (let i = 0; i < 5; i++) {
        await openEditor(); await delay(500); await closeEditor(); await delay(500); check();
      }
      report('editor-cycles', { ...snapshot(), cycles: 5, reusedEditorDocument: editorFrame.contentDocument === editorDocument });
      for (let i = 0; i < 5; i++) {
        check(); doc.getElementById('map-preview').click(); mapOpened = true;
        await delay(300); doc.getElementById('map-close').click(); mapOpened = false; await delay(300);
      }
      await sample('after-cycles-settled', 10000);
      report('complete', { ...snapshot(), phases: reports.length });
      status.textContent = '检测完成 · 数据已留在下方与本机日志中';
      document.getElementById('stop').disabled = true;
      // Future runs release their extra wallpaper instance after measurement.
      frame.src = 'about:blank'; frame.hidden = true;
      document.querySelector('details').open = true;
    } finally { win.removeEventListener('message', onWallpaper); cleanup(); }
  }
  runCheck().catch(error => {
    status.textContent = controller.signal.aborted ? '检测已停止' : '检测未完成：' + error.message;
    if (!controller.signal.aborted) report('error', { message: String(error.message).slice(0, 120) });
    cleanup();
  });
})();
