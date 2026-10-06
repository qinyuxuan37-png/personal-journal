/* Transparent SVG map: bundled land/city data only, never tiles or geolocation. */
(() => {
  const model = window.OfflineMap, get = (id) => document.getElementById(id);
  const dialog = get("map-dialog"), trigger = get("map-preview");
  if (!model || !dialog || !trigger) return;
  const dataUrl = new URL("offline-map-data.js", document.currentScript.src).href;
  const workerUrl = new URL("offline-map-worker.js", document.currentScript.src).href;
  const exported = document.documentElement.hasAttribute("data-export");
  const choiceKey = "personal-space.map-choice.v1";
  let dataPromise, catalog, profile = {}, location = null, currentKey = "", revision = 0;
  let activeQuery = null, landReady = false, mapReady = false;
  const results = new Map();
  const ns = "http://www.w3.org/2000/svg";
  function node(tag, attributes) {
    const element = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes || {})) element.setAttribute(key, value);
    return element;
  }
  class Surface {
    constructor(svg, interactive) {
      this.svg = svg; this.interactive = interactive; this.view = new model.Viewport(); this.location = null; this.drag = null;
      this.land = node("path", { class: "offline-map-land", "fill-rule": "evenodd" });
      this.grid = node("path", { class: "offline-map-grid" });
      let grid = "";
      for (let lon = -180; lon <= 180; lon += 30) { const x = model.project(lon, 0).x; grid += `M${x},0V1000`; }
      for (let lat = -60; lat <= 60; lat += 30) { const y = model.project(0, lat).y; grid += `M0,${y}H1000`; }
      this.grid.setAttribute("d", grid);
      this.marker = node("g", { class: "offline-map-marker" });
      this.halo = node("circle", { class: "map-pin-halo" });
      this.pin = node("circle", { class: "map-pin" });
      this.label = node("text", { class: "map-pin-label" });
      this.marker.append(this.halo, this.pin, this.label);
      svg.append(this.grid, this.land, this.marker);
      this.resize();
      if ("ResizeObserver" in window) new ResizeObserver(() => this.resize()).observe(svg);
      else window.addEventListener("resize", () => this.resize());
      if (interactive) this.bind();
    }
    resize() {
      const rect = this.svg.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) this.view.resize(rect.width, rect.height);
      this.paint();
    }
    setLocation(value, reset) { this.location = value; if (reset) this.view.locate(value); this.paint(); }
    paint() {
      const box = this.view.box(), scale = box.w / this.view.width;
      this.svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
      this.marker.setAttribute("visibility", this.location ? "visible" : "hidden");
      if (this.location) {
        const point = model.project(this.location.lon, this.location.lat);
        for (const circle of [this.halo, this.pin]) { circle.setAttribute("cx", point.x); circle.setAttribute("cy", point.y); }
        this.halo.setAttribute("r", 11 * scale); this.pin.setAttribute("r", 4 * scale);
        const onRight = (point.x - box.x) / box.w > .72;
        this.label.setAttribute("x", point.x + (onRight ? -16 : 16) * scale);
        this.label.setAttribute("y", point.y + 4 * scale);
        this.label.setAttribute("text-anchor", onRight ? "end" : "start");
        this.label.setAttribute("font-size", 13 * scale);
        const name = Array.from(this.location.name);
        this.label.textContent = name.slice(0, 26).join("") + (name.length > 26 ? "…" : "");
      }
      if (this.interactive) { get("map-zoom-in").disabled = this.view.zoom >= 20; get("map-zoom-out").disabled = this.view.zoom <= 1; }
    }
    bind() {
      const svg = this.svg;
      svg.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || this.drag) return;
        this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
        svg.setPointerCapture(event.pointerId); svg.classList.add("is-dragging"); svg.focus({ preventScroll: true });
      });
      svg.addEventListener("pointermove", (event) => {
        if (this.drag?.id !== event.pointerId) return;
        this.view.pan(event.clientX - this.drag.x, event.clientY - this.drag.y);
        this.drag.x = event.clientX; this.drag.y = event.clientY; this.paint();
      });
      const end = () => { this.drag = null; svg.classList.remove("is-dragging"); };
      for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) svg.addEventListener(event, end);
      svg.addEventListener("wheel", (event) => {
        event.preventDefault(); const rect = svg.getBoundingClientRect();
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
        this.view.zoomBy(Math.exp(-Math.max(-500, Math.min(500, delta)) * .002), { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }); this.paint();
      }, { passive: false });
      svg.addEventListener("keydown", (event) => {
        const directions = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
        if (directions[event.key]) this.view.pan(...directions[event.key]);
        else if (["+", "="].includes(event.key)) this.view.zoomBy(1.4);
        else if (event.key === "-") this.view.zoomBy(1 / 1.4);
        else if (event.key === "Home") this.view.locate(this.location);
        else return;
        event.preventDefault(); this.paint();
      });
    }
  }
  const mini = new Surface(get("map-mini"), false), full = new Surface(get("map-full"), true);
  function loadData() {
    if (dataPromise) return dataPromise;
    dataPromise = new Promise((resolve, reject) => {
      const finish = () => {
        try {
          // Compatibility path for file:// exports and older browsers.
          catalog = { resolve: (value, preferred) => model.lookup(window.OfflineGeoData, value, preferred) };
          for (const map of [mini, full]) map.land.setAttribute("d", window.OfflineGeoData.land);
          resolve();
        } catch (error) { reject(error); }
      };
      if (window.OfflineGeoData) { finish(); return; }
      const script = document.createElement("script");
      script.src = dataUrl; script.onload = finish;
      script.onerror = () => { script.remove(); reject(new Error("本地地图文件未加载，请重试")); };
      document.head.append(script);
    }).catch((error) => { dataPromise = null; throw error; });
    return dataPromise;
  }
  function savedChoice(query) {
    try { const value = JSON.parse(localStorage.getItem(choiceKey)); return value?.query === query ? value.id : ""; } catch { return ""; }
  }
  function resolveLocation(value, preferred) {
    if (!window.Worker || new URL(workerUrl).protocol === "file:") {
      return loadData().then(() => catalog.resolve(value, preferred));
    }
    const input = { city: value.city, mapLatitude: value.mapLatitude, mapLongitude: value.mapLongitude };
    const key = JSON.stringify([input, preferred]);
    if (activeQuery?.key === key) return activeQuery.promise;
    activeQuery?.cancel();
    if (results.has(key)) return Promise.resolve(results.get(key));
    const worker = new window.Worker(workerUrl);
    const task = { key, promise: null, cancel: null };
    activeQuery = task;
    task.promise = new Promise((resolve, reject) => {
      let settled = false, timer;
      const finish = (error, payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); worker.terminate();
        if (activeQuery === task) activeQuery = null;
        if (error) { reject(error); return; }
        if (payload.land !== undefined) {
          for (const map of [mini, full]) map.land.setAttribute("d", payload.land);
          landReady = true;
        }
        if (results.size >= 8) results.delete(results.keys().next().value);
        results.set(key, payload.result);
        resolve(payload.result);
      };
      task.cancel = () => finish(new Error("地图查询已取消"));
      timer = setTimeout(() => finish(new Error("本地地图加载超时，请重试")), 15000);
      worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data);
      worker.onerror = () => finish(new Error("本地地图文件未加载，请重试"));
      try { worker.postMessage({ profile: input, preferred, includeLand: !landReady }); }
      catch (error) { finish(error); }
    });
    return task.promise;
  }
  function statusText(id, message) {
    get(id).textContent = message;
    get(id).hidden = !message;
  }
  function showLocation(value, reset = true) {
    location = value;
    mini.setLocation(value, reset); full.setLocation(value, reset);
    get("map-location").textContent = value ? [value.name, value.region, value.country].filter((part, index, all) => part && all.indexOf(part) === index).join(" · ") : (profile.city || "尚未设置地区");
    get("map-coordinates").textContent = value ? `${value.lat.toFixed(4)}°, ${value.lon.toFixed(4)}° · ${value.id === "custom" ? "手动坐标" : "城市级参考位置"}` : "";
    trigger.setAttribute("aria-label", value ? `展开${value.name}的本地地图` : "展开本地地图，设置或确认地区");
    get("map-full").setAttribute("aria-label", `本地地图${value ? "，" + value.name : ""}。方向键移动，加减号缩放，Home 返回地区。`);
    window.publicMapLocation = value;
    document.dispatchEvent(new CustomEvent("map:located", { detail: { location: value } }));
  }
  async function update(next = window.publicProfile || {}) {
    const token = ++revision;
    profile = next;
    get("map-retry").hidden = true;
    statusText("map-preview-status", "正在准备本地地图…");
    try {
      const query = model.normalize(next.city);
      const result = await resolveLocation(next, savedChoice(query));
      if (token !== revision) return;
      mapReady = true;
      const key = `${query}|${profile.mapLatitude || ""}|${profile.mapLongitude || ""}`;
      showLocation(result.location || null, key !== currentKey); currentKey = key;
      const messages = {
        found: "", empty: "填写城市后自动定位",
        missing: "城市未收录 · 可补填坐标", ambiguous: `找到 ${result.matches.length} 个同名城市 · 点击确认`,
        invalid: "坐标不正确，请检查公开资料"
      };
      statusText("map-preview-status", messages[result.type]);
      statusText("map-status", result.type === "found" ? "" : messages[result.type] + "。在公开资料中可填写“城市, 国家”或经纬度。");
      const choices = get("map-choices"); choices.replaceChildren(); choices.hidden = result.type !== "ambiguous";
      if (result.type === "ambiguous") {
        for (const city of result.matches.slice(0, 30)) {
          const button = document.createElement("button"); button.type = "button";
          button.textContent = [city.name, city.region, city.country, `${city.lat.toFixed(2)}°, ${city.lon.toFixed(2)}°`].filter(Boolean).join(" · ");
          button.addEventListener("click", () => {
            showLocation(city); choices.hidden = true;
            statusText("map-status", "");
            statusText("map-preview-status", "");
            try { localStorage.setItem(choiceKey, JSON.stringify({ query, id: city.id })); } catch { statusText("map-status", "浏览器无法保存选择，下次可能需要重新确认。"); }
          });
          choices.append(button);
        }
      }
    } catch (error) {
      if (token !== revision) return;
      statusText("map-preview-status", "地图暂不可用 · 点击重试");
      statusText("map-status", error.message); get("map-retry").hidden = false;
    }
  }
  trigger.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
    full.resize();
    if (!mapReady) update();
  });
  get("map-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => trigger.focus({ preventScroll: true }));
  dialog.addEventListener("keydown", (event) => { if (event.key === "Escape") event.stopPropagation(); });
  for (const [id, factor] of [["map-zoom-in", 1.4], ["map-zoom-out", 1 / 1.4]]) get(id).addEventListener("click", () => { full.view.zoomBy(factor); full.paint(); });
  get("map-center").addEventListener("click", () => { full.view.locate(location); full.paint(); });
  get("map-retry").addEventListener("click", () => update());
  document.addEventListener("public:rendered", () => update());
  window.addEventListener("pagehide", () => { revision++; activeQuery?.cancel(); });
  window.addEventListener("pageshow", (event) => { if (event.persisted) update(); });
  if (window.publicProfile) update();
})();
