(() => {
  const list = document.getElementById("wallpaper-library");
  if (!list) return;
  const refresh = document.getElementById("wallpaper-library-refresh");
  const status = document.getElementById("wallpaper-library-status");
  const count = document.getElementById("wallpaper-library-count");
  let items = [], loading = false, selecting = false;
  const checks = new Map();

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function render() {
    const fragment = document.createDocumentFragment();
    for (const group of ["subscribed", "retained", "unknown"]) {
    const grouped = items.filter((item) => (item.subscription || "unknown") === group);
    if (!grouped.length) continue;
    fragment.append(element("h4", "wallpaper-library-group", group === "subscribed" ? "当前订阅" : group === "retained" ? "本地保留 · 已退订" : "本地文件 · 订阅状态未确认"));
    for (const item of grouped) {
      const card = element("button", "wallpaper-library-card");
      card.type = "button";
      card.dataset.wallpaperId = item.id;
      card.disabled = !item.supported || selecting;
      card.setAttribute("aria-pressed", String(item.selected));
      card.setAttribute("aria-label", `${item.title} · ${item.selected ? "使用中" : item.supported ? "应用壁纸" : "暂不支持"}`);
      const imageBox = element("span", "wallpaper-library-preview");
      const placeholder = element("span", "wallpaper-library-placeholder", "暂无预览");
      imageBox.append(placeholder);
      if (item.preview) {
        const image = element("img", "");
        image.alt = ""; image.loading = "lazy"; image.decoding = "async";
        image.src = item.preview;
        image.addEventListener("error", () => { image.hidden = true; });
        imageBox.append(image);
      }
      const label = item.kind === "scene" ? "场景 · 兼容播放" : item.kind === "html" ? "网页 · 互动" : "暂不支持的类型";
      const body = element("span", "wallpaper-library-caption");
      body.append(element("strong", "wallpaper-library-title", item.title));
      body.append(element("span", "wallpaper-library-kind", label));
      const check = checks.get(item.id);
      body.append(element("span", "wallpaper-library-check", !item.supported ? "不支持的入口或文件过大" : check === "rendered" ? "本次已检测到渲染" : check === "failed" ? "试播失败 · 可重试" : "待试播验证"));
      body.append(element("span", "wallpaper-library-action", item.selected ? "✓ 使用中" : item.supported ? "试播并应用 ↗" : "暂不可用"));
      card.append(imageBox, body);
      fragment.append(card);
    }
    }
    list.replaceChildren(fragment);
    count.textContent = items.length ? `· ${items.length}` : "";
  }
  async function load() {
    if (loading || selecting) return;
    loading = true; refresh.disabled = true;
    list.setAttribute("aria-busy", "true");
    status.textContent = "正在读取本机下载目录…";
    try {
      const response = await fetch("/api/wallpaper/library", { cache: "no-store" });
      if (!response.ok) throw new Error("壁纸列表读取失败，请检查本地服务后重试。");
      const result = await response.json();
      items = result.items;
      render();
      status.textContent = items.length ? "" : result.configured
        ? "这个下载目录中还没有壁纸。下载完成后点击刷新列表。"
        : "尚未识别 Steam 壁纸目录，可先通过下方导入文件夹。";
    } catch (error) { status.textContent = error.message; }
    finally { loading = false; refresh.disabled = false; list.setAttribute("aria-busy", "false"); }
  }
  list.addEventListener("click", async (event) => {
    const card = event.target.closest("[data-wallpaper-id]");
    if (!card || selecting || loading || card.disabled) return;
    const item = items.find((entry) => entry.id === card.dataset.wallpaperId);
    if (!item || item.selected) return;
    selecting = true; refresh.disabled = true;
    list.setAttribute("aria-busy", "true");
    list.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      if (!window.WallpaperControls) throw new Error("页面尚未准备好，请稍后重试。");
      await window.WallpaperControls.select(item.id);
      checks.set(item.id, "rendered");
      items.forEach((entry) => { entry.selected = entry.id === item.id; });
      status.textContent = "";
    } catch (error) { checks.set(item.id, "failed"); status.textContent = error.message; }
    finally {
      selecting = false; refresh.disabled = false;
      render(); list.setAttribute("aria-busy", "false");
      list.querySelector(`[data-wallpaper-id="${item.id}"]`)?.focus({ preventScroll: true });
    }
  });
  refresh.addEventListener("click", load);
  document.getElementById("wallpaper-diy")?.addEventListener("click", load);
  document.getElementById("diy-tab-background")?.addEventListener("click", load);
})();
