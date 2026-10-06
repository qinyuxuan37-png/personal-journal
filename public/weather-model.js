/* Open-Meteo schema, units and cache rules. No location or private data access. */
(() => {
  const freshFor = 10 * 60 * 1000, usableFor = 2 * 60 * 60 * 1000;
  const descriptions = {
    0: "晴", 1: "晴间多云", 2: "多云", 3: "阴", 45: "雾", 48: "冻雾",
    51: "小毛毛雨", 53: "毛毛雨", 55: "较强毛毛雨", 56: "冻毛毛雨", 57: "较强冻毛毛雨",
    61: "小雨", 63: "中雨", 65: "大雨", 66: "冻雨", 67: "较强冻雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
    80: "小阵雨", 81: "阵雨", 82: "强阵雨", 85: "小阵雪", 86: "强阵雪",
    95: "雷阵雨", 96: "雷雨伴冰雹", 99: "强雷雨伴冰雹"
  };
  const number = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
  function point(location) {
    if (!location || number(location.lat, -90, 90) === null || number(location.lon, -180, 180) === null) return null;
    // City-level rounding; no high-precision personal point sent to the provider.
    const lat = location.lat.toFixed(2), lon = location.lon.toFixed(2);
    return { key: `${lat},${lon}`, lat, lon };
  }
  function url(location) {
    const p = point(location); if (!p) throw new Error("请先确认地区");
    const address = new URL("https://api.open-meteo.com/v1/forecast");
    address.search = new URLSearchParams({ latitude: p.lat, longitude: p.lon,
      current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
      temperature_unit: "celsius", wind_speed_unit: "ms", timeformat: "unixtime", forecast_days: "1" }).toString();
    return address.href;
  }
  function recent(seconds, now) { const age = now - seconds * 1000; return age >= -30 * 60 * 1000 && age < usableFor; }
  function parse(payload, now = Date.now()) {
    const c = payload?.current, units = payload?.current_units;
    if (!c || units?.temperature_2m !== "°C" || units?.wind_speed_10m !== "m/s" || units?.relative_humidity_2m !== "%") throw new Error("天气数据格式不正确");
    const data = { temperature: number(c.temperature_2m, -100, 70), humidity: number(c.relative_humidity_2m, 0, 100),
      wind: number(c.wind_speed_10m, 0, 200), code: number(c.weather_code, 0, 999), time: number(c.time, 1, 1e11) };
    if (data.time === null || !recent(data.time, now) || [data.temperature, data.humidity, data.wind].every((x) => x === null)) throw new Error("天气数据缺失或已过期");
    return data;
  }
  function cached(value, key, now = Date.now()) {
    if (value?.version !== 1 || value.key !== key || !Number.isFinite(value.received)) return null;
    const age = now - value.received, d = value.data;
    if (age < 0 || age >= usableFor || !d || !Number.isFinite(d.time) || !recent(d.time, now)) return null;
    for (const [field, min, max] of [["temperature", -100, 70], ["humidity", 0, 100], ["wind", 0, 200], ["code", 0, 999]]) {
      if (d[field] !== null && number(d[field], min, max) === null) return null;
    }
    if ([d.temperature, d.humidity, d.wind].every((x) => x === null)) return null;
    return { data: d, fresh: age < freshFor };
  }
  function describe(code) { return descriptions[code] || "天气未知"; }
  function timeLabel(seconds, timezone) {
    try { return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone || undefined, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(seconds * 1000)); }
    catch { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(seconds * 1000)); }
  }
  window.LocalWeather = Object.freeze({ point, url, parse, cached, describe, timeLabel, freshFor, usableFor });
})();
