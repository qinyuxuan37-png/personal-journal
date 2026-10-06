(() => {
  if (document.documentElement.classList.contains("studio-embedded")) return;
  const stage = document.getElementById("studio-wallpaper");
  const frame = document.getElementById("studio-wallpaper-frame");
  let current = "";

  async function syncWallpaper() {
    try {
      const response = await fetch("/api/wallpaper", { cache: "no-store" });
      if (!response.ok) throw new Error("背景服务暂不可用");
      const info = await response.json();
      if (!info.available) { stage.hidden = true; frame.src = "about:blank"; current = ""; return; }
      const source = new URL(info.url);
      if (source.protocol !== "http:" || source.hostname !== "127.0.0.1" || source.origin === location.origin) throw new Error("背景地址不正确");
      const identity = `${info.name}|${info.custom}|${info.kind}`;
      if (identity === current) return;
      current = identity;
      stage.hidden = false;
      frame.title = `${info.name || "本机壁纸"} · 动态背景`;
      frame.src = source.href;
    } catch {
      // The workspace remains usable over its dark fallback when the wallpaper service is unavailable.
    }
  }

  syncWallpaper();
  window.addEventListener("focus", syncWallpaper);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncWallpaper(); });
})();
