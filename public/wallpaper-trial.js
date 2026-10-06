(() => {
  let active = false;
  window.WallpaperTrial = {
    async run({ prepare, commit, stage, promote, signal }) {
      if (active) throw new Error("已有壁纸正在试播，请稍候");
      active = true;
      let candidate = null, removeListeners = () => {};
      try {
        const info = await prepare();
        if (signal?.aborted) throw new Error("已取消试播，原背景保持不变");
        const address = new URL(info.url);
        if (address.protocol !== "http:" || address.hostname !== "127.0.0.1" || address.origin === location.origin) throw new Error("试播地址不正确");
        candidate = document.createElement("iframe");
        candidate.className = "pond-frame";
        candidate.title = `${info.name} · 试播`;
        candidate.tabIndex = -1;
        candidate.setAttribute("sandbox", "allow-scripts allow-same-origin");
        candidate.setAttribute("referrerpolicy", "no-referrer");
        candidate.style.cssText = "position:fixed;inset:0;width:100%;height:100%;opacity:0;pointer-events:none;border:0";
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("试播超时，原背景保持不变")), info.kind === "scene" ? 50000 : 24000);
          const abort = () => reject(new Error("已取消试播，原背景保持不变"));
          const receive = (event) => {
            if (event.source !== candidate.contentWindow || event.origin !== address.origin) return;
            if (event.data?.type === "pond:ready") resolve();
            if (event.data?.type === "pond:error") reject(new Error(`试播失败：${String(event.data.reason || "此壁纸暂不兼容").slice(0, 240)}。原背景保持不变。`));
          };
          removeListeners = () => { clearTimeout(timer); window.removeEventListener("message", receive); signal?.removeEventListener("abort", abort); };
          window.addEventListener("message", receive);
          signal?.addEventListener("abort", abort, { once: true });
          candidate.src = address.href;
          stage.append(candidate);
        });
        removeListeners();
        if (signal?.aborted) throw new Error("已取消试播，原背景保持不变");
        const saved = await commit();
        promote(candidate, { ...saved, url: info.url });
        candidate = null;
        return saved;
      } finally {
        removeListeners();
        if (candidate) { candidate.src = "about:blank"; candidate.remove(); }
        active = false;
      }
    }
  };
})();
