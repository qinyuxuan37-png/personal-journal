/* Optional city-level online weather, isolated from offline map and wallpaper. */
(() => {
  const model = window.LocalWeather, get = (id) => document.getElementById(id), panel = get("weather-panel");
  if (!model || !panel) return;
  const exported = document.documentElement.hasAttribute("data-export");
  const preferenceKey = "personal-space.weather-online.v1", cacheKey = "personal-space.weather-cache.v1";
  function stored(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
  const preference = stored(preferenceKey);
  let enabled = preference === true || (preference !== false && !exported && panel.dataset.defaultEnabled === "true");
  let location = window.publicMapLocation || null, controller = null, revision = 0, pendingKey = "", cachedValue = stored(cacheKey), lastAttempt = null;
  const status = get("weather-status"), toggle = get("weather-toggle"), dataPanel = get("weather-data");
  function clear() { dataPanel.hidden = true; for (const id of ["weather-temperature", "weather-condition", "weather-humidity", "weather-wind"]) get(id).textContent = "—"; }
  function syncToggle() {
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.textContent = enabled ? "关闭联网" : "启用联网";
    toggle.setAttribute("aria-label", enabled ? "关闭联网天气" : "启用 Open-Meteo 天气，会发送城市级坐标和公网 IP");
  }
  function stop() { ++revision; controller?.abort(); controller = null; pendingKey = ""; }
  function show(data, message) {
    dataPanel.hidden = false;
    get("weather-temperature").textContent = data.temperature === null ? "— °C" : `${data.temperature.toFixed(1)} °C`;
    get("weather-condition").textContent = model.describe(data.code);
    get("weather-humidity").textContent = `湿度 ${data.humidity === null ? "—" : Math.round(data.humidity) + "%"}`;
    get("weather-wind").textContent = `风速 ${data.wind === null ? "—" : data.wind.toFixed(1) + " m/s"}`;
    const timestamp = model.timeLabel(data.time, window.publicProfile?.timezone);
    dataPanel.title = `天气数据时间：${timestamp}`;
    status.textContent = message === "已更新" ? "" : `${message} · ${timestamp}`;
  }
  async function update() {
    syncToggle();
    if (!enabled) { stop(); clear(); status.textContent = ""; return; }
    const p = model.point(location);
    if (!p) { stop(); clear(); status.textContent = "请先填写或确认地图地区，再显示天气"; return; }
    const cached = model.cached(cachedValue, p.key);
    if (cached?.fresh) { stop(); show(cached.data, "已更新"); return; }
    if (pendingKey === p.key) return;
    stop();
    if (cached) show(cached.data, "正在更新，暂显示旧数据");
    else { clear(); status.textContent = "正在获取地区天气…"; }
    // Prevent repeated renders / tab focus from hammering a failing provider.
    if (lastAttempt?.key === p.key && Date.now() - lastAttempt.time < 60000) {
      if (cached) show(cached.data, "暂无法更新 · 旧数据");
      else status.textContent = "天气暂不可用，将自动重试 · 地图不受影响";
      return;
    }
    lastAttempt = { key: p.key, time: Date.now() };
    const token = revision, request = new AbortController(); controller = request; pendingKey = p.key;
    const timeout = window.setTimeout(() => request.abort(), 10000);
    try {
      const response = await fetch(model.url(location), { signal: request.signal, credentials: "omit", referrerPolicy: "no-referrer", mode: "cors" });
      if (!response.ok) throw new Error("天气服务暂不可用");
      const data = model.parse(await response.json());
      if (token !== revision || !enabled) return;
      cachedValue = { version: 1, key: p.key, received: Date.now(), data };
      try { localStorage.setItem(cacheKey, JSON.stringify(cachedValue)); } catch { /* In-memory cache remains usable. */ }
      show(data, "已更新");
    } catch {
      if (token !== revision || !enabled) return;
      const fallback = model.cached(cachedValue, p.key);
      if (fallback) show(fallback.data, "暂无法更新 · 旧数据");
      else { clear(); status.textContent = "天气暂不可用，请检查网络 · 地图不受影响"; }
    } finally {
      window.clearTimeout(timeout);
      if (token === revision) { controller = null; pendingKey = ""; }
    }
  }
  toggle.addEventListener("click", () => {
    enabled = !enabled;
    if (enabled) lastAttempt = null;
    try { localStorage.setItem(preferenceKey, JSON.stringify(enabled)); } catch { /* Preference lasts for this page only. */ }
    update();
  });
  document.addEventListener("map:located", (event) => { location = event.detail.location; update(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) update(); });
  window.addEventListener("online", () => { lastAttempt = null; update(); });
  window.setInterval(() => { if (!document.hidden) update(); }, 60000);
  update();
})();
