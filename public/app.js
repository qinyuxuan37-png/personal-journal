const $ = (id) => document.getElementById(id);
const exported = document.documentElement.hasAttribute("data-export");
const empty = (text) => {
  const node = document.createElement("div"); node.className = "empty reveal-item";
  const label = document.createElement("span"); label.className = "empty-label"; label.textContent = "TO BE CONTINUED / 待续";
  const message = document.createElement("p"); message.textContent = text;
  node.append(label, message);
  return node;
};
const number = (index) => String(index + 1).padStart(2, "0");
const setCount = (id, length) => { $(id).textContent = String(length).padStart(2, "0") + " 项"; };
const safeLink = (value) => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } };
const imageUrl = (name) => /^[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(name || "") ? (exported ? "./media/public/" : "/media/public/") + name : "";
function renderList(id, entries, render, hint) {
  const root = $(id); root.replaceChildren();
  if (!entries.length) root.append(empty(hint));
  else entries.forEach((entry, index) => {
    const node = render(entry.data, index);
    node.classList.add("reveal-item");
    node.style.setProperty("--delay", (index % 8) * 70 + "ms");
    root.append(node);
  });
}
function media(data, index, label, className) {
  const wrapper = document.createElement("div"); wrapper.className = className;
  const src = imageUrl(data.image);
  if (src) {
    const img = document.createElement("img"); img.src = src; img.alt = ""; img.loading = "lazy"; wrapper.append(img);
  } else {
    const numeral = document.createElement("span"); numeral.className = "media-number"; numeral.textContent = number(index);
    const category = document.createElement("small"); category.className = "media-label"; category.textContent = label;
    wrapper.append(numeral, category);
  }
  return wrapper;
}
function detailText(value, fallback) {
  const paragraph = document.createElement("p");
  paragraph.textContent = value || fallback;
  return paragraph;
}
function skill(data, index) {
  const item = document.createElement("details"); item.className = "skill-item";
  const summary = document.createElement("summary");
  const heading = document.createElement("span"); heading.className = "skill-heading";
  const label = document.createElement("small"); label.textContent = "SKILL / " + number(index);
  const title = document.createElement("strong"); title.textContent = data.title || "未命名技术";
  heading.append(label, title);
  const arrow = document.createElement("span"); arrow.className = "detail-arrow"; arrow.setAttribute("aria-hidden", "true"); arrow.textContent = "↗";
  summary.append(media(data, index, "SKILL", "skill-visual"), heading, arrow);
  const note = document.createElement("div"); note.className = "skill-note";
  note.append(detailText(data.description, "还没有补充这项技术的说明。"));
  item.append(summary, note);
  return item;
}
function project(data, index) {
  const item = document.createElement("details"); item.className = "project-item";
  const summary = document.createElement("summary");
  const numeral = document.createElement("span"); numeral.className = "project-number"; numeral.textContent = number(index);
  const heading = document.createElement("span"); heading.className = "project-heading";
  const title = document.createElement("strong"); title.textContent = data.title || "未命名项目";
  heading.append(title);
  if (data.stack) { const stack = document.createElement("small"); stack.textContent = data.stack; heading.append(stack); }
  const arrow = document.createElement("span"); arrow.className = "detail-arrow"; arrow.setAttribute("aria-hidden", "true"); arrow.textContent = "↗";
  summary.append(numeral, heading, arrow);
  const detail = document.createElement("div"); detail.className = "project-detail";
  detail.append(media(data, index, "PROJECT", "project-visual"));
  const body = document.createElement("div"); body.className = "project-detail-body";
  const kicker = document.createElement("span"); kicker.className = "card-kicker"; kicker.textContent = "OPEN SOURCE / " + number(index);
  body.append(kicker, detailText(data.description, "还没有补充项目介绍。"));
  const actions = document.createElement("div"); actions.className = "card-actions";
  const url = safeLink(data.url); if (url) { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = "查看仓库 ↗"; actions.append(a); }
  const demo = safeLink(data.demo); if (demo) { const a = document.createElement("a"); a.href = demo; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = "查看演示 ↗"; actions.append(a); }
  if (actions.childElementCount) body.append(actions);
  detail.append(body); item.append(summary, detail);
  return item;
}
function interest(data, index, label) {
  const item = document.createElement("details"); item.className = "interest-item";
  const summary = document.createElement("summary");
  const cover = media(data, index, label, "interest-cover");
  const caption = document.createElement("span"); caption.className = "interest-caption";
  const type = document.createElement("small"); type.textContent = label + " / " + number(index);
  const title = document.createElement("strong"); title.textContent = data.title || "未命名作品";
  const arrow = document.createElement("span"); arrow.className = "detail-arrow"; arrow.setAttribute("aria-hidden", "true"); arrow.textContent = "↗";
  caption.append(type, title, arrow); summary.append(cover, caption);
  const note = document.createElement("div"); note.className = "interest-note";
  note.append(detailText(data.description, "还没有补充这项收藏的说明。"));
  item.append(summary, note);
  return item;
}
function music(data, index) {
  const item = document.createElement("article"); item.className = "music-card";
  const record = media(data, index, "MUSIC", "music-record");
  record.setAttribute("aria-hidden", "true");
  const body = document.createElement("div"); body.className = "music-copy";
  const label = document.createElement("small"); label.className = "card-kicker"; label.textContent = "TRACK / " + number(index);
  const title = document.createElement("h4"); title.textContent = data.title || "未命名音乐";
  body.append(label, title);
  if (data.artist) { const artist = document.createElement("p"); artist.className = "music-artist"; artist.textContent = data.artist; body.append(artist); }
  if (data.description) body.append(detailText(data.description));
  const url = safeLink(data.url);
  if (url) {
    const link = document.createElement("a"); link.className = "music-listen";
    link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
    link.textContent = "去听听 ↗"; link.setAttribute("aria-label", `收听 ${data.title || "音乐"}（新窗口）`);
    body.append(link);
  }
  item.append(record, body);
  return item;
}
function renderSocialLink(id, raw, label) {
  const link = $(id), address = safeLink(raw);
  link.hidden = false;
  link.removeAttribute("data-local-only");
  link.removeAttribute("aria-disabled");
  link.removeAttribute("tabindex");
  if (address) {
    link.href = address;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = label;
    link.setAttribute("aria-label", label + "（新窗口）");
  } else {
    link.removeAttribute("target");
    link.removeAttribute("rel");
    link.title = label + " · 未设置链接";
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    link.setAttribute("tabindex", "0");
    link.setAttribute("aria-label", label + "（未设置链接）");
  }
}
function renderProfile(profile, entries) {
  const name = profile.name?.trim() || "我的空间";
  $("profile-name").textContent = name;
  $("profile-intro").textContent = profile.intro || "";
  $("profile-intro").hidden = !profile.intro?.trim();
  renderSocialLink("github-link", profile.github, "GitHub");
  const social2 = profile.social2Name?.trim() || "抖音";
  const social3 = profile.social3Name?.trim() || "哔哩哔哩";
  renderSocialLink("social2-link", profile.social2Url, social2);
  renderSocialLink("social3-link", profile.social3Url, social3);
  const douyin = /^(抖音|douyin)$/i.test(social2);
  if (douyin) $("social2-brand").removeAttribute("hidden");
  else $("social2-brand").setAttribute("hidden", "");
  $("social2-icon").hidden = douyin;
  $("social2-icon").textContent = Array.from(social2).slice(0, 2).join("").toUpperCase();
  const bilibili = /^(哔哩哔哩|b站|bilibili)$/i.test(social3);
  if (bilibili) $("social3-brand").removeAttribute("hidden");
  else $("social3-brand").setAttribute("hidden", "");
  $("social3-icon").hidden = bilibili;
  $("social3-icon").textContent = Array.from(social3).slice(0, 2).join("").toUpperCase();

  const avatar = $("avatar"), placeholder = $("avatar-placeholder");
  const image = imageUrl(profile.avatar);
  placeholder.textContent = "";
  placeholder.hidden = Boolean(image);
  avatar.hidden = !image;
  avatar.alt = `${name}的头像`;
  avatar.onerror = () => { avatar.hidden = true; placeholder.hidden = false; };
  if (image) avatar.src = image;
  else avatar.removeAttribute("src");

  $("profile-tech-count").textContent = String(entries.tech.length);
  $("profile-projects-count").textContent = String(entries.projects.length);
  $("profile-interests-count").textContent = String(entries.games.length + entries.anime.length + (entries.music || []).length);
}
function clock(profile) {
  clearInterval(clock.timer);
  $("city").textContent = profile.city || "未设置地区";
  $("city").hidden = !profile.city;
  let formatter;
  try { formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: profile.timezone || "Asia/Shanghai", dateStyle: "medium", timeStyle: "medium", hour12: false }); }
  catch { /* Keep the existing invalid-timezone message below. */ }
  const format = () => {
    if (document.hidden) return;
    $("clock").textContent = formatter ? formatter.format(new Date()) : "请检查时区设置";
  };
  format(); clock.timer = setInterval(format, 1000);
}
async function initPond() {
  if (exported) return;
  let resolveReady;
  window.wallpaperReady = new Promise((resolve) => { resolveReady = resolve; });
  const stage = $("pond-stage");
  let frame = $("pond-frame"), trialAbort = null;
  const status = $("pond-status"), dialog = $("wallpaper-dialog");
  const pathInput = $("wallpaper-path"), message = $("wallpaper-message");
  const currentLabel = $("wallpaper-current"), browse = $("wallpaper-browse");
  const apply = $("wallpaper-apply"), restore = $("wallpaper-default");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const showStatus = (value) => { status.textContent = value; status.hidden = !value; };
  const showMessage = (value, error = false) => {
    message.textContent = value;
    message.classList.toggle("is-error", error);
  };
  let info = null, source = null, loaded = false, started = false, loadTimer = null;
  const clearLoadTimer = () => {
    if (loadTimer !== null) window.clearTimeout(loadTimer);
    loadTimer = null;
  };
  window.addEventListener("pagehide", clearLoadTimer);
  const visible = () => !document.hidden && !stage.hidden && stage.getBoundingClientRect().bottom > 0 && stage.getBoundingClientRect().top < innerHeight;
  const notifyVisibility = () => {
    if (source && loaded) frame.contentWindow?.postMessage({ type: "pond:visibility", visible: visible() }, source.origin);
  };
  const observer = "IntersectionObserver" in window ? new IntersectionObserver(notifyVisibility, { threshold: 0.01 }) : null;
  document.addEventListener("visibilitychange", notifyVisibility);
  function showBackground() {
    const show = Boolean(source && !reduced);
    stage.hidden = !show;
    document.body.classList.toggle("has-pond", show);
    if (show && !loaded) {
      loaded = true;
      const address = new URL(source.href);
      address.searchParams.set("siteBackground", String(Date.now()));
      frame.src = address.href;
      showStatus("正在加载动态背景…");
      clearLoadTimer();
      loadTimer = window.setTimeout(() => {
        loadTimer = null;
        const notice = "动态背景加载超时，请在 DIY 空间检查壁纸文件或选择其他背景";
        showStatus(notice); showMessage(notice, true); resolveReady();
      }, 60000);
    } else {
      notifyVisibility();
    }
  }
  function useInfo(next) {
    clearLoadTimer();
    // A newly selected wallpaper needs its own readiness gate for opening previews.
    if (info) window.wallpaperReady = new Promise((resolve) => { resolveReady = resolve; });
    info = next;
    source = null;
    loaded = false;
    document.body.classList.toggle("wallpaper-ready", false);
    frame.src = "about:blank";
    const available = next.available && next.kind !== "unsupported";
    if (available) {
      const address = new URL(next.url);
      if (address.protocol !== "http:" || address.hostname !== "127.0.0.1" || address.origin === location.origin) throw new Error("壁纸地址不正确");
      source = address;
    }
    currentLabel.textContent = available
      ? `当前背景：${next.name}${next.custom ? "（自定义）" : "（默认）"}`
      : "当前没有可用的动态背景";
    restore.disabled = !next.custom;
    frame.title = next.name ? `${next.name} · 动态互动背景` : "动态互动背景";
    showBackground();
    if (!source) {
      const notice = next.custom || next.kind === "unsupported"
        ? "所选壁纸文件已失效或格式不支持，请重新下载，或在 DIY 空间选择其他背景"
        : "可通过 DIY 空间 → 背景导入本机互动壁纸";
      showStatus(notice);
      if (next.custom || next.kind === "unsupported") showMessage(notice, true);
    }
    else if (reduced) showStatus("已按系统设置关闭动态背景");
    if (!source || reduced) resolveReady();
  }
  async function request(method, path, payload) {
    const response = await fetch(path, {
      method,
      headers: { "X-Local-Request": "1", ...(payload ? { "Content-Type": "application/json" } : {}) },
      body: payload ? JSON.stringify(payload) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "操作失败，请重试");
    return result;
  }
  function busy(value) { browse.disabled = value; apply.disabled = value; restore.disabled = value || !info?.custom; }
  dialog.addEventListener("close", () => trialAbort?.abort());
  async function switchWallpaper(payload, method = "PUT") {
    if (!window.WallpaperTrial) throw new Error("试播组件尚未就绪，请刷新页面");
    if (reduced) throw new Error("系统已开启减少动态效果；关闭该设置后可试播动态壁纸");
    trialAbort = new AbortController();
    showMessage("正在试播…原背景会保留，成功后再替换。关闭面板可取消。");
    try {
      return await window.WallpaperTrial.run({
        signal: trialAbort.signal, stage,
        prepare: () => request("POST", "/api/wallpaper/prepare", payload),
        commit: () => request(method, "/api/wallpaper", method === "DELETE" ? undefined : payload),
        promote(candidate, next) {
          clearLoadTimer();
          const previous = frame;
          previous.removeAttribute("id");
          frame = candidate;
          frame.id = "pond-frame";
          frame.style.cssText = "";
          info = next; source = new URL(next.url); loaded = true;
          currentLabel.textContent = `当前背景：${next.name}${next.custom ? "（自定义）" : "（默认）"}`;
          frame.title = `${next.name} · 动态互动背景`;
          document.body.classList.toggle("wallpaper-ready", true);
          stage.hidden = false;
          const cleanup = () => { previous.src = "about:blank"; previous.remove(); };
          if (frame.animate) {
            const animation = frame.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: "ease-out" });
            animation.finished.then(cleanup, cleanup);
            setTimeout(cleanup, 450);
          } else cleanup();
          showStatus(""); resolveReady(); notifyVisibility();
          showMessage("已检测到画布渲染并应用。关闭面板即可查看实际效果。");
        }
      });
    } finally { trialAbort = null; }
  }
  window.WallpaperControls = {
    async select(libraryId) {
      if (apply.disabled) throw new Error("正在处理背景，请稍候再选择");
      busy(true);
      showMessage("正在切换背景…");
      try {
        return await switchWallpaper({ libraryId });
      } catch (error) { showMessage(error.message, true); throw error; }
      finally { busy(false); }
    }
  };
  pathInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); apply.click(); }
  });
  browse.addEventListener("click", async () => {
    busy(true);
    showMessage("请在系统窗口中选择壁纸文件夹…");
    try {
      const result = await request("POST", "/api/wallpaper/choose");
      if (result.path) { pathInput.value = result.path; showMessage("已选好文件夹，点击「使用这个背景」生效。"); }
      else showMessage("未选择文件夹。你也可以手动粘贴路径。");
    } catch (error) { showMessage(error.message, true); }
    finally { busy(false); }
  });
  apply.addEventListener("click", async () => {
    if (!pathInput.value.trim()) { showMessage("请先选择或填写壁纸文件夹。", true); pathInput.focus(); return; }
    busy(true);
    showMessage("正在切换背景…");
    try {
      await switchWallpaper({ path: pathInput.value });
      dialog.close();
    } catch (error) { showMessage(error.message, true); }
    finally { busy(false); }
  });
  restore.addEventListener("click", async () => {
    busy(true);
    showMessage("正在恢复默认背景…");
    try {
      await switchWallpaper({ default: true }, "DELETE");
      pathInput.value = "";
      dialog.close();
    } catch (error) { showMessage(error.message, true); }
    finally { busy(false); }
  });
  window.addEventListener("message", (event) => {
    if (!source || event.origin !== source.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === "pond:ready") {
      clearLoadTimer();
      document.body.classList.toggle("wallpaper-ready", true);
      showStatus(""); notifyVisibility(); resolveReady();
    }
    if (event.data?.type === "pond:wheel" && visible()) {
      const scale = event.data.mode === 1 ? 16 : event.data.mode === 2 ? innerHeight : 1;
      const delta = Number(event.data.deltaY);
      const panel = document.querySelector("main .is-active");
      if (panel && Number.isFinite(delta)) panel.scrollBy(0, Math.max(-800, Math.min(800, delta * scale)));
    }
    if (event.data?.type === "pond:error") {
      clearLoadTimer();
      document.body.classList.toggle("wallpaper-ready", true);
      resolveReady();
      const notice = info?.kind === "scene"
        ? "此场景暂不兼容，当前仅显示预览图；可在 DIY 空间选择其他壁纸"
        : "背景交互脚本未就绪，画面将保持显示；可在 DIY 空间的背景设置中更换文件夹";
      showStatus(notice); showMessage(notice, true);
    }
  });
  const start = async () => {
    if (started) return;
    started = true;
    observer?.observe(stage);
    try { useInfo(await request("GET", "/api/wallpaper")); }
    catch { showStatus("本机背景服务暂不可用"); resolveReady(); }
  };
  // Prepare the live canvas behind the opaque opening, before its exit begins.
  frame.addEventListener("load", () => {
    if (!source || !loaded || frame.src === "about:blank") return;
    // A scene iframe's HTML load is not a rendered frame. Its player reports readiness.
    if (info?.kind !== "koi") return;
    const address = frame.src;
    const complete = () => {
      if (frame.src !== address) return;
      clearLoadTimer();
      document.body.classList.toggle("wallpaper-ready", true);
      showStatus(""); resolveReady();
    };
    // Allow the koi bridge to finish configuring its canvas, with a fallback.
    if (info?.kind === "koi") window.setTimeout(complete, 1200);
    else complete();
  });
  start();
}
async function init() {
  try {
    let snapshot;
    if (exported) {
      snapshot = window.PUBLIC_EXPORT_SNAPSHOT;
      if (!snapshot) throw new Error("公开数据缺失");
    } else {
      const response = await fetch("/api/public");
      if (!response.ok) throw new Error("读取失败");
      snapshot = await response.json();
    }
    const profile = snapshot.settings.profile || {};
    window.publicProfile = profile;
    window.publicLayout = window.SpaceLayout.normalize(snapshot.settings.layout);
    const openingName = (profile.name || "").trim();
    $("opening-name").textContent = openingName ? openingName.slice(0, 24) : "这里的主人";
    $("opening-name").classList.toggle("is-long", openingName.length > 10);
    const alternateTitle = profile.openingReveal || "另一面\n在这里";
    const alternateElement = $("opening-alt-title");
    alternateElement.textContent = alternateTitle;
    const alternateLength = alternateTitle.replace(/\s/g, "").length;
    alternateElement.classList.toggle("is-long", alternateLength > 14);
    alternateElement.classList.toggle("is-very-long", alternateLength > 34);
    $("opening-alt-caption").textContent = profile.openingCaption || "继续探索。";
    renderProfile(profile, snapshot.entries);
    document.title = (profile.name || "我的") + " · 个人主页";
    clock(profile);
    setCount("tech-count", snapshot.entries.tech.length);
    setCount("projects-count", snapshot.entries.projects.length);
    const musicEntries = snapshot.entries.music || [];
    setCount("interests-count", snapshot.entries.games.length + snapshot.entries.anime.length + musicEntries.length);
    setCount("music-count", musicEntries.length);
    window.WorkShowcase?.render(snapshot.entries.tech, snapshot.entries.projects);
    renderList("games-list", snapshot.entries.games, (data, index) => interest(data, index, "GAME"), "下一场冒险，待续。");
    renderList("anime-list", snapshot.entries.anime, (data, index) => interest(data, index, "ANIME"), "喜欢的故事，待续。");
    // The retired interest panel stays dormant; avoid duplicate hidden cover images.
    window.MusicWall?.render(musicEntries);
    window.PhotoAlbum?.render($("photo-album"), snapshot.entries.gallery || []);
  } catch {
    $("profile-intro").hidden = false;
    $("profile-intro").textContent = exported ? "公开内容暂时无法读取，请重新导出主页。" : "内容暂时无法读取，请确认本地服务正在运行。";
  } finally {
    document.dispatchEvent(new Event("public:rendered"));
  }
}
document.addEventListener("public:refresh", init);
init();
initPond();
