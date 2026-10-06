/* Local city matching and viewport math. No network or browser location API. */
(() => {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const normalize = (value) => String(value || "").normalize("NFKC").normalize("NFD")
    .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").replace(/市$/u, "");
  const countryNames = { CN: ["中国", "China"], US: ["美国", "USA"], GB: ["英国", "UK"], JP: ["日本", "Japan"], KR: ["韩国"], FR: ["法国"], DE: ["德国"], AU: ["澳大利亚", "澳洲"], CA: ["加拿大"] };
  const chinaRegions = { Zhejiang: "浙江", Jiangsu: "江苏", Anhui: "安徽", Fujian: "福建", Jiangxi: "江西", Shandong: "山东", Henan: "河南", Hebei: "河北", Shanxi: "山西", Shaanxi: "陕西", Hubei: "湖北", Hunan: "湖南", Guangdong: "广东", Guangxi: "广西", Sichuan: "四川", Guizhou: "贵州", Yunnan: "云南", Liaoning: "辽宁", Jilin: "吉林", Heilongjiang: "黑龙江", Hainan: "海南", Gansu: "甘肃", Qinghai: "青海", Ningxia: "宁夏", Xinjiang: "新疆", Tibet: "西藏", "Inner Mongolia": "内蒙古", Shanghai: "上海", Beijing: "北京", Tianjin: "天津", Chongqing: "重庆" };
  function project(lon, lat) {
    const radians = clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180;
    return { x: (lon + 180) / 360 * 1000, y: (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 1000 };
  }
  function coordinates(profile) {
    const a = String(profile.mapLatitude ?? "").trim(), b = String(profile.mapLongitude ?? "").trim();
    if (!a && !b) return null;
    const lat = Number(a), lon = Number(b);
    if (!a || !b || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
    return { id: "custom", name: profile.city?.trim() || "自定义位置", lat, lon, country: "", region: "" };
  }
  function catalog(data) {
    if (data?.version !== 1 || !Array.isArray(data.cities) || typeof data.land !== "string") throw new Error("离线地图数据缺失");
    const names = new Map(), primary = new Map(), qualifiers = new Map(), cities = new Map();
    function add(map, key, city) {
      key = normalize(key); if (!key) return;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(city);
    }
    for (const row of data.cities) {
      const [id, name, code, country, region, lon, lat, aliases, canonical = []] = row;
      const city = { id, name, code, country, region, lon, lat };
      cities.set(id, city);
      for (const alias of [name, ...aliases]) add(names, alias, city);
      for (const alias of [name, ...canonical]) add(primary, alias, city);
      const localRegion = code === "CN" ? chinaRegions[region] : "";
      for (const qualifier of [code, country, region, ...(countryNames[code] || []), localRegion, localRegion && localRegion + "省"]) add(qualifiers, qualifier, city);
    }
    function resolve(profile, preferredId) {
      const manual = coordinates(profile);
      if (manual === false) return { type: "invalid", matches: [] };
      if (manual) return { type: "found", matches: [manual], location: manual, manual: true };
      const query = normalize(profile.city);
      if (!query) return { type: "empty", matches: [] };
      let matches = [...(primary.get(query) || names.get(query) || [])];
      if (!matches.length) {
        const found = new Set();
        for (const [qualifier, members] of qualifiers) {
          let remainder = "";
          if (query.startsWith(qualifier)) remainder = query.slice(qualifier.length);
          else if (query.endsWith(qualifier)) remainder = query.slice(0, -qualifier.length);
          const exact = [...(primary.get(remainder) || [])].filter((city) => members.has(city));
          for (const city of exact.length ? exact : names.get(remainder) || []) if (members.has(city)) found.add(city);
        }
        matches = [...found];
      }
      const preferred = matches.find((city) => city.id === preferredId);
      if (preferred) return { type: "found", matches, location: preferred };
      if (matches.length === 1) return { type: "found", matches, location: matches[0] };
      return { type: matches.length ? "ambiguous" : "missing", matches };
    }
    return { resolve, cities };
  }
  // A one-off query needs only its candidate cities, not four global indexes.
  function lookup(data, profile, preferredId) {
    if (data?.version !== 1 || !Array.isArray(data.cities) || typeof data.land !== "string") throw new Error("离线地图数据缺失");
    const query = normalize(profile.city);
    const candidates = coordinates(profile) !== null || !query ? [] : data.cities.filter((row) =>
      [row[1], ...row[7], ...(row[8] || [])].some((name) => {
        const alias = normalize(name);
        return alias && (query.startsWith(alias) || query.endsWith(alias));
      }));
    return catalog({ version: 1, land: "", cities: candidates }).resolve(profile, preferredId);
  }
  class Viewport {
    constructor(width = 700, height = 400) { this.x = 500; this.y = 500; this.zoom = 1; this.resize(width, height); }
    resize(width, height) { this.width = Math.max(1, width); this.height = Math.max(1, height); this.constrain(); }
    constrain() {
      const w = 1000 / this.zoom, h = w * this.height / this.width;
      this.x = clamp(this.x, w / 2, 1000 - w / 2);
      this.y = h >= 1000 ? 500 : clamp(this.y, h / 2, 1000 - h / 2);
    }
    box() {
      const w = 1000 / this.zoom, h = w * this.height / this.width;
      return { x: this.x - w / 2, y: this.y - h / 2, w, h };
    }
    locate(location) { const point = location ? project(location.lon, location.lat) : { x: 500, y: 500 }; this.x = point.x; this.y = point.y; this.zoom = location ? 8 : 1; this.constrain(); }
    pan(dx, dy) { const scale = 1000 / this.zoom / this.width; this.x -= dx * scale; this.y -= dy * scale; this.constrain(); }
    zoomBy(factor, anchor = { x: .5, y: .5 }) {
      if (!Number.isFinite(factor) || factor <= 0) return;
      const old = this.box(), target = { x: old.x + old.w * anchor.x, y: old.y + old.h * anchor.y };
      this.zoom = clamp(this.zoom * factor, 1, 20);
      const next = this.box();
      this.x = target.x + next.w * (.5 - anchor.x); this.y = target.y + next.h * (.5 - anchor.y); this.constrain();
    }
  }
  window.OfflineMap = Object.freeze({ normalize, project, coordinates, catalog, lookup, Viewport });
})();
