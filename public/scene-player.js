// This module runs only on the isolated, read-only wallpaper origin.
const siteOrigin = document.documentElement.dataset.siteOrigin;
const canvas = document.getElementById("scene-canvas");
const status = document.getElementById("scene-status");
const preview = document.getElementById("scene-preview");
let player = null, visible = true, disposed = false;
const send = (type) => parent.postMessage({ type }, siteOrigin);
const syncVisibility = () => {
  if (!player) return;
  if (visible && !document.hidden) player.resume();
  else player.pause();
};
window.addEventListener("message", (event) => {
  if (event.origin !== siteOrigin || event.source !== parent) return;
  if (event.data?.type === "pond:visibility") {
    visible = event.data.visible === true;
    syncVisibility();
  }
});
document.addEventListener("visibilitychange", syncVisibility);
window.addEventListener("pagehide", () => {
  disposed = true;
  player?.destroy({ releasePkgCache: true });
  player = null;
});
window.addEventListener("wheel", (event) => {
  parent.postMessage({ type: "pond:wheel", deltaY: event.deltaY, mode: event.deltaMode }, siteOrigin);
}, { passive: true });
preview.addEventListener("error", () => { preview.hidden = true; });
try {
  const { mount, httpSource } = await import("/__vendor/webwallgl.mjs");
  if (!disposed) {
    const instance = await mount(canvas, {
      source: httpSource(location.origin), fit: "cover", fps: 30,
      renderDpr: Math.min(devicePixelRatio || 1, 1.5),
      volume: 0, audio: null, media: null, mountTimeoutMs: 45000,
    });
    if (disposed) instance.destroy({ releasePkgCache: true });
    else {
      player = instance;
      syncVisibility();
      document.body.classList.add("is-ready");
      status.hidden = true;
      send("pond:ready");
    }
  }
} catch (error) {
  error?.instance?.destroy({ releasePkgCache: true });
  if (!disposed) {
    console.warn("Scene wallpaper could not be rendered", error);
    status.textContent = "此场景暂不兼容，当前仅显示预览图。请在 DIY 空间选择其他壁纸。";
    send("pond:error");
  }
}
