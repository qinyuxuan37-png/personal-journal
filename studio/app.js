const byId = (id) => document.getElementById(id);
const categories = {
  gallery: { scope: "public", title: "展示照片集", description: "只添加愿意展示的照片；保存后出现在展示页，私人照片不会自动同步。", fields: [["title", "照片名称", "text"], ["date", "拍摄日期", "date"], ["description", "照片说明", "textarea"], ["image", "展示照片", "image"]] },
  photos: { scope: "private", title: "照片", description: "为自己的照片留下时间与说明。", fields: [["title", "标题", "text"], ["date", "拍摄日期", "date"], ["description", "说明", "textarea"], ["image", "照片", "image"]] },
  notes: { scope: "private", title: "备忘录", description: "随时记下想法和待办。", fields: [["title", "标题", "text"], ["tags", "标签（用逗号分隔）", "text"], ["description", "正文", "textarea"]] },
  skills: { scope: "private", title: "Skill 收藏", description: "收藏技能、工具与自己的实践笔记。", fields: [["title", "名称", "text"], ["purpose", "用途", "text"], ["url", "链接", "url"], ["description", "私人备注", "textarea"]] },
  goals: { scope: "private", title: "目标", description: "记录进展，也记录为什么出发。", fields: [["title", "目标名称", "text"], ["description", "说明", "textarea"], ["status", "状态", "select", ["计划中", "进行中", "已完成", "已暂停"]], ["progress", "进度（0–100）", "number"], ["date", "截止日期", "date"]] },
  diary: { scope: "private", title: "日记", description: "按日期保存自己的每一天。", fields: [["title", "标题", "text"], ["date", "日期", "date"], ["mood", "心情", "text"], ["description", "正文", "textarea"]] },
  quotes: { scope: "private", title: "留给自己", description: "写给自己的话，也可以收藏触动你的名言。", fields: [["title", "一句话 / 标题", "text"], ["author", "作者", "text"], ["source", "出处", "text"], ["description", "自己的感想", "textarea"]] },
  tech: { scope: "public", title: "技术栈", description: "记录技术在作品中的实际用途。项目中的同名技术标签会自动关联。", fields: [["title", "技术名称", "text"], ["category", "展示分组", "select", ["界面与交互", "服务与数据", "桌面与设备", "更多实践"]], ["description", "实践说明", "textarea"], ["image", "技术图标 / 图片", "image"]] },
  projects: { scope: "public", title: "开源项目", description: "展示作品与开发过程；仓库链接可以留空，页面会显示源码暂未公开。", fields: [["title", "项目名称", "text"], ["tagline", "一句话介绍", "text"], ["status", "项目状态", "select", ["开发中", "持续维护", "已完成"]], ["description", "项目简介", "textarea"], ["highlights", "功能亮点（每行一条）", "textarea"], ["stack", "所用技术（用逗号分隔，与技术栈名称一致可关联）", "text"], ["visual", "无图片时的展示样式", "select", ["自动", "个人空间", "外设状态"]], ["url", "仓库链接（可留空）", "url"], ["demo", "演示链接（可留空）", "url"], ["image", "项目图片", "image"]] },
  games: { scope: "public", title: "喜欢的游戏", description: "记录你愿意分享的游戏。", fields: [["title", "游戏名称", "text"], ["description", "喜欢的原因或评价", "textarea"], ["image", "游戏图片", "image"]] },
  anime: { scope: "public", title: "番剧 / 动漫", description: "记录你愿意分享的作品。", fields: [["title", "作品名称", "text"], ["description", "喜欢的原因或评价", "textarea"], ["image", "作品图片", "image"]] },
  music: { scope: "public", title: "爱听的音乐", description: "以唱片卡展示喜欢的音乐；收听链接会在新窗口打开，不自动播放。", fields: [["title", "歌曲 / 专辑名称", "text"], ["artist", "歌手 / 音乐人", "text"], ["description", "喜欢的理由", "textarea"], ["url", "收听链接", "url"], ["image", "专辑封面", "image"]] }
};
const viewInfo = {
  home: ["总览", "最近的私人记录和未完成的目标。", "PRIVATE / SPACE"],
  "private-profile": ["私人资料", "只保存在本机，不出现在公开主页。", "PRIVATE / PROFILE"],
  "public-profile": ["公开资料", "这部分内容会出现在公开主页。", "PUBLIC / PROFILE"],
  backup: ["备份与恢复", "导出公开主页，备份与恢复私人记录。", "LOCAL / DATA"]
};
const requestedView = new URLSearchParams(window.location.search).get("view");
const state = { public: null, private: null, view: categories[requestedView] || viewInfo[requestedView] ? requestedView : "home", editing: null, search: {}, reordering: false, saving: false };
const motion = window.StudioMotion;
const navButtons = [...document.querySelectorAll("[data-view]")];
function el(tag, cls, content) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (content !== undefined) node.textContent = content;
  return node;
}
function notice(message, error = false) {
  const root = byId("notice");
  root.textContent = message;
  root.className = "notice" + (error ? " error" : "");
  const sequence = notice.sequence = (notice.sequence || 0) + 1;
  motion.arrive(root, -5);
  clearTimeout(notice.timer);
  notice.timer = setTimeout(async () => {
    await motion.play(root, [{ opacity: 1 }, { opacity: 0 }], 160);
    if (sequence !== notice.sequence) return;
    root.textContent = ""; root.className = "";
  }, 5500);
}
async function request(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = "操作失败";
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  if (options.method && options.method !== "GET" && /^\/api\/public\/(settings|entries)(\/|$)/.test(path)) {
    document.dispatchEvent(new Event("studio:public-changed"));
  }
  return response.headers.get("Content-Type")?.includes("application/json") ? response.json() : response;
}
function writeOptions(method, value) {
  return { method, headers: { "Content-Type": "application/json", "X-Local-Request": "1" }, body: JSON.stringify(value) };
}
async function refresh() {
  const [pub, priv] = await Promise.all([request("/api/public"), request("/api/private")]);
  state.public = pub; state.private = priv;
  render();
}
function imageUrl(scope, name) {
  return /^[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(name || "") ? "/media/" + scope + "/" + name : "";
}
async function upload(scope, file) {
  const types = { "image/jpeg": true, "image/png": true, "image/webp": true, "image/gif": true };
  if (!types[file.type]) throw new Error("只支持 JPG、PNG、WebP 或 GIF 图片");
  if (file.size > 12 * 1024 * 1024) throw new Error("图片不能超过 12 MB");
  return request("/api/" + scope + "/images", { method: "POST", headers: { "Content-Type": file.type, "X-Local-Request": "1" }, body: file });
}
function updateNavigation(view) {
  navButtons.forEach((button) => {
    const selected = button.dataset.view === view;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  byId("view-select").value = view;
  motion.syncNav(navButtons.find((button) => button.dataset.view === view));
}
function setView(view) {
  if ((!viewInfo[view] && !categories[view]) || state.saving || byId("entry-dialog").open) return;
  updateNavigation(view);
  if (!state.public || !state.private) { state.view = view; return; }
  if (state.view === view && !motion.switching) return;
  motion.swap(() => {
    state.view = view;
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
  }).catch((error) => notice("切换栏目失败：" + error.message, true));
}
function render() {
  if (!state.public || !state.private) return;
  const view = state.view;
  const info = viewInfo[view] || [categories[view].title, categories[view].description, categories[view].scope.toUpperCase() + " / CONTENT"];
  byId("section-title").textContent = info[0];
  byId("section-description").textContent = info[1];
  byId("section-kicker").textContent = info[2];
  byId("add-button").hidden = !categories[view];
  const root = byId("view-root"); root.replaceChildren();
  if (view === "home") renderHome(root);
  else if (view === "private-profile" || view === "public-profile") renderProfile(root, view === "public-profile" ? "public" : "private");
  else if (view === "backup") renderBackup(root);
  else renderEntries(root, view);
}
function renderHome(root) {
  const entries = state.private.entries;
  const counts = [["photos", "照片"], ["notes", "备忘录"], ["goals", "目标"], ["diary", "日记"]];
  const stats = el("div", "stats");
  counts.forEach(([view, name]) => {
    const item = el("button", "stat"); item.type = "button";
    item.append(el("span", "", name), el("strong", "", String(entries[view].length)), el("small", "", "查看记录 ↗"));
    item.addEventListener("click", () => setView(view)); stats.append(item);
  });
  root.append(stats);
  const profile = state.private.settings.profile || {};
  const timePanel = el("section", "panel");
  timePanel.append(el("h2", "", profile.name ? "你好，" + profile.name : "你的私人空间"), el("p", "muted", profile.city || "还没有设置私人地区"));
  const time = el("time", "clock"); time.id = "private-clock";
  time.append(el("span", "clock-date"), el("span", "clock-time"));
  timePanel.append(time); root.append(timePanel); updateClock();
  const goals = entries.goals.filter((entry) => entry.data.status !== "已完成").slice(0, 3);
  const goalPanel = el("section", "panel");
  const goalHead = el("div", "panel-head"); goalHead.append(el("h2", "", "未完成的目标"));
  const allGoals = el("button", "panel-link", "查看全部 ↗"); allGoals.type = "button"; allGoals.addEventListener("click", () => setView("goals")); goalHead.append(allGoals);
  goalPanel.append(goalHead);
  if (!goals.length) goalPanel.append(el("p", "muted", "还没有未完成的目标。"));
  goals.forEach((entry) => {
    const progress = Math.max(0, Math.min(100, Number(entry.data.progress) || 0));
    const row = el("button", "goal-row"); row.type = "button";
    const heading = el("span", "goal-row-head");
    heading.append(el("strong", "", entry.data.title || "未命名目标"), el("span", "", progress + "%"));
    const track = el("span", "goal-track"); const fill = el("span", "goal-fill"); fill.style.width = progress + "%"; track.append(fill);
    row.append(heading, track, el("small", "", entry.data.status || "计划中"));
    row.addEventListener("click", () => setView("goals")); goalPanel.append(row);
  });
  root.append(goalPanel);
  const recent = Object.values(entries).flat().sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
  const recentPanel = el("section", "panel"); recentPanel.append(el("h2", "", "最近记录"));
  if (!recent.length) recentPanel.append(el("p", "muted", "这里还是空的。选择一个栏目，写下第一条记录吧。"));
  recent.forEach((entry) => {
    const row = el("button", "recent-row"); row.type = "button";
    row.append(el("span", "recent-kind", categories[entry.kind].title), el("strong", "", entry.data.title || "未命名"), el("time", "", entry.updated_at.slice(0, 10)));
    row.addEventListener("click", () => setView(entry.kind)); recentPanel.append(row);
  });
  root.append(recentPanel);
  const quick = el("div", "quick-grid");
  ["photos", "notes", "goals", "diary", "quotes", "public-profile"].forEach((view) => {
    const button = el("button", "", (categories[view]?.title || viewInfo[view][0]) + " →");
    button.addEventListener("click", () => setView(view)); quick.append(button);
  });
  root.append(quick);
}
function updateClock() {
  if (document.hidden) return;
  const overlay = window.frameElement?.closest("dialog");
  if (overlay && !overlay.open) return;
  const target = byId("private-clock");
  if (!target) return;
  const profile = state.private?.settings.profile || {};
  try {
    const zone = profile.timezone || "Asia/Shanghai";
    if (updateClock.zone !== zone) {
      const date = new Intl.DateTimeFormat("zh-CN", { timeZone: zone, dateStyle: "full" });
      const time = new Intl.DateTimeFormat("zh-CN", { timeZone: zone, timeStyle: "medium", hour12: false });
      updateClock.formatters = { date, time }; updateClock.zone = zone;
    }
    const now = new Date();
    target.querySelector(".clock-date").textContent = updateClock.formatters.date.format(now);
    target.querySelector(".clock-time").textContent = updateClock.formatters.time.format(now);
  } catch {
    target.querySelector(".clock-date").textContent = "请检查私人资料中的时区设置";
    target.querySelector(".clock-time").textContent = "";
  }
}
setInterval(updateClock, 1000);
function field(labelText, control, full = false) {
  const wrap = el("div", "field" + (full ? " full" : ""));
  const label = el("label", "", labelText); label.htmlFor = control.id;
  wrap.append(label, control); return wrap;
}
function input(id, value = "", type = "text") {
  const node = document.createElement("input"); node.id = id; node.name = id; node.type = type; node.value = value; return node;
}
function renderProfile(root, scope) {
  const profile = state[scope].settings.profile || {};
  const panel = el("section", "panel");
  const form = el("form", "profile-form");
  form.append(field("名称 / 昵称", input("name", profile.name || "")));
  form.append(field("所在城市", input("city", profile.city || "")));
  const timezone = input("timezone", profile.timezone || "Asia/Shanghai");
  form.append(field("时区（例如 Asia/Shanghai）", timezone));
  if (scope === "public") {
    const latitude = input("mapLatitude", profile.mapLatitude || "", "number");
    const longitude = input("mapLongitude", profile.mapLongitude || "", "number");
    latitude.min = -90; latitude.max = 90; latitude.step = "any";
    longitude.min = -180; longitude.max = 180; longitude.step = "any";
    form.append(field("地图纬度（可选）", latitude), field("地图经度（可选）", longitude));
    form.append(el("p", "hint full", "离线地图自动匹配城市中英文名。可以填“上海”或“Shanghai, China”；未收录或需要精确指定位置时，同时填写经纬度。清空两项后恢复按城市定位。只填写愿意展示的城市级位置，不需要家庭住址。时区仍独立设置。"));
  }
  if (scope === "public") {
    form.append(field("圆图标 1 · GitHub 主页链接", input("github", profile.github || "", "url")));
    form.append(field("圆图标 2 · 名称", input("social2Name", profile.social2Name || "抖音")));
    form.append(field("圆图标 2 · 账号链接", input("social2Url", profile.social2Url || "", "url")));
    form.append(field("圆图标 3 · 名称", input("social3Name", profile.social3Name || "哔哩哔哩")));
    form.append(field("圆图标 3 · 账号链接", input("social3Url", profile.social3Url || "", "url")));
    form.append(el("p", "hint full", "账号链接只支持 http / https；留空时图标仍会显示，点击可回到这里设置。"));
  }
  const intro = document.createElement("textarea"); intro.id = "intro"; intro.name = "intro"; intro.value = profile.intro || "";
  form.append(field(scope === "public" ? "公开介绍" : "私人介绍", intro, true));
  if (scope === "public") {
    const reveal = document.createElement("textarea");
    reveal.id = "openingReveal"; reveal.name = "openingReveal"; reveal.rows = 2;
    reveal.maxLength = 80;
    reveal.value = profile.openingReveal || "";
    reveal.placeholder = "另一面\n在这里";
    const revealField = field("开场黑色圆形内的文字", reveal, true);
    revealField.append(el("span", "hint", "可换行分成两行；留空则使用默认文字。"));
    form.append(revealField);
    const caption = input("openingCaption", profile.openingCaption || "");
    caption.maxLength = 160;
    form.append(field("开场圆形内的补充说明", caption, true));
  }
  const photo = input("profile-image", "", "file"); photo.accept = "image/jpeg,image/png,image/webp,image/gif";
  const photoField = field("头像 / 照片（可选）", photo, true);
  const existing = imageUrl(scope, profile.avatar);
  if (existing) { const img = document.createElement("img"); img.className = "image-preview"; img.src = existing; img.alt = "当前照片"; photoField.append(img); }
  const remove = input("remove-avatar", "", "checkbox");
  if (existing) { const removeLabel = el("label", "hint", " 移除当前照片"); removeLabel.prepend(remove); photoField.append(removeLabel); }
  else { remove.hidden = true; photoField.append(remove); }
  form.append(photoField);
  const actions = el("div", "button-row"); const save = el("button", "primary", "保存资料"); save.type = "submit"; actions.append(save); form.append(actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); save.disabled = true;
    save.textContent = "保存中…"; save.setAttribute("aria-busy", "true");
    try {
      const read = (name) => form.elements.namedItem(name).value;
      const value = {
        name: read("name"),
        intro: read("intro"),
        city: read("city"),
        timezone: read("timezone"),
        mapLatitude: scope === "public" ? read("mapLatitude") : "",
        mapLongitude: scope === "public" ? read("mapLongitude") : "",
        github: scope === "public" ? read("github") : "",
        social2Name: scope === "public" ? read("social2Name") : "",
        social2Url: scope === "public" ? read("social2Url") : "",
        social3Name: scope === "public" ? read("social3Name") : "",
        social3Url: scope === "public" ? read("social3Url") : "",
        avatar: remove.checked ? "" : profile.avatar || "",
        openingReveal: scope === "public" ? read("openingReveal") : "",
        openingCaption: scope === "public" ? read("openingCaption") : ""
      };
      if (photo.files[0]) value.avatar = (await upload(scope, photo.files[0])).name;
      await request("/api/" + scope + "/settings", writeOptions("PUT", value));
      await refresh(); notice("资料已保存");
    } catch (error) { notice(error.message, true); }
    finally { save.disabled = false; save.textContent = "保存资料"; save.removeAttribute("aria-busy"); }
  });
  panel.append(form); root.append(panel);
  if (scope === "private") root.append(el("p", "warning", "私人资料只在本机显示，但未加密。能使用这台已解锁电脑的人，可能读取这些内容。"));
  else root.append(el("p", "warning", "请只在这里填写你愿意公开的内容；私人记录不会自动复制到公开主页。"));
}
function emptyEntries(message, action, label = "NOT YET / 待续") {
  const box = el("div", "empty empty-records");
  box.append(el("span", "empty-kicker", label), el("p", "", message));
  if (action) { const button = el("button", "secondary", action.label); button.type = "button"; button.addEventListener("click", action.run); box.append(button); }
  return box;
}
function addExternalLink(content, raw, label) {
  if (!raw) return;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return;
    const link = el("a", "entry-link", label);
    link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; content.append(link);
  } catch {}
}
async function moveEntry(kind, entries, index, offset) {
  if (state.reordering) return;
  const ids = entries.map((item) => item.id);
  const target = index + offset;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  state.reordering = true;
  const positions = new Map([...document.querySelectorAll(".entry[data-entry-id]")].map((card) => [card.dataset.entryId, card.getBoundingClientRect().top]));
  try {
    await request("/api/public/entries/order", writeOptions("PUT", { kind, ids }));
    await refresh();
    if (state.view === kind) {
      document.querySelectorAll(".entry[data-entry-id]").forEach((card) => {
        const oldTop = positions.get(card.dataset.entryId), newTop = card.getBoundingClientRect().top;
        if (Number.isFinite(oldTop) && Math.abs(oldTop - newTop) > 1 && newTop < window.innerHeight && oldTop > -300) {
          motion.play(card, [{ transform: `translateY(${oldTop - newTop}px)` }, { transform: "translateY(0)" }], 260);
        }
      });
    }
    notice("展示顺序已更新");
  } catch (error) { notice(error.message, true); }
  finally { state.reordering = false; }
}
function entryCard(kind, entry, orderIndex = -1, orderEntries = null) {
  const article = el("article", "entry");
  article.dataset.entryId = entry.id;
  const src = imageUrl(categories[kind].scope, entry.data.image);
  if (src) { const img = document.createElement("img"); img.src = src; img.alt = entry.data.title || ""; img.loading = "lazy"; article.append(img); }
  else article.classList.add("no-image");
  const content = el("div");
  content.append(el("h3", "", entry.data.title || "未命名"));
  const progress = entry.data.progress !== undefined && entry.data.progress !== "" ? entry.data.progress + "%" : "";
  const meta = [entry.data.date, entry.data.status, progress, entry.data.author, entry.data.source, entry.data.mood, entry.data.stack].filter(Boolean).join(" · ");
  if (meta) content.append(el("div", "entry-meta", meta));
  const details = entry.data.description || entry.data.purpose || "";
  if (details) {
    const paragraph = el("p", "entry-excerpt", details);
    if (details.length > 220) {
      paragraph.classList.add("is-clamped");
      const toggle = el("button", "read-more", "展开全文 ↓"); toggle.type = "button"; toggle.setAttribute("aria-expanded", "false");
      toggle.addEventListener("click", () => {
        motion.resize(paragraph, () => {
          const collapsed = paragraph.classList.toggle("is-clamped");
          toggle.textContent = collapsed ? "展开全文 ↓" : "收起 ↑";
          toggle.setAttribute("aria-expanded", String(!collapsed));
        });
      });
      content.append(paragraph, toggle);
    } else content.append(paragraph);
  }
  if (entry.data.tags) content.append(el("div", "entry-meta", "标签：" + entry.data.tags));
  addExternalLink(content, entry.data.url, "打开链接 ↗");
  addExternalLink(content, entry.data.demo, "查看演示 ↗");
  const buttons = el("div", "button-row");
  if (orderEntries && categories[kind].scope === "public") {
    const up = el("button", "secondary order-button", "↑ 上移"); up.type = "button";
    up.disabled = orderIndex === 0;
    up.setAttribute("aria-label", "上移「" + (entry.data.title || "这条记录") + "」");
    up.addEventListener("click", () => moveEntry(kind, orderEntries, orderIndex, -1));
    const down = el("button", "secondary order-button", "↓ 下移"); down.type = "button";
    down.disabled = orderIndex === orderEntries.length - 1;
    down.setAttribute("aria-label", "下移「" + (entry.data.title || "这条记录") + "」");
    down.addEventListener("click", () => moveEntry(kind, orderEntries, orderIndex, 1));
    buttons.append(up, down);
  }
  const edit = el("button", "secondary", "编辑"); edit.type = "button"; edit.addEventListener("click", () => openEntry(kind, entry));
  const del = el("button", "danger", "删除"); del.type = "button"; del.addEventListener("click", () => deleteEntry(kind, entry));
  buttons.append(edit, del); content.append(buttons); article.append(content);
  return article;
}
function renderEntries(root, kind) {
  const category = categories[kind];
  const entries = state[category.scope].entries[kind];
  if (!entries.length) {
    root.append(emptyEntries("这里还没有内容。写下第一条记录吧。", { label: "＋ 新增内容", run: () => openEntry(kind) }));
    return;
  }
  const toolbar = el("div", "list-toolbar");
  const count = el("span", "record-count");
  const search = input("entry-search", state.search[kind] || "", "search");
  search.placeholder = "搜索本栏内容"; search.setAttribute("aria-label", "搜索" + category.title);
  toolbar.append(count, search);
  const sortHint = category.scope === "public" ? el("p", "sort-hint") : null;
  const results = el("div");
  const paint = () => {
    const query = (state.search[kind] || "").trim().toLocaleLowerCase();
    const filtered = entries.filter((entry) => !query || Object.entries(entry.data)
      .filter(([key, value]) => key !== "image" && typeof value === "string")
      .some(([, value]) => value.toLocaleLowerCase().includes(query)));
    count.textContent = query ? filtered.length + " / " + entries.length + " 条记录" : entries.length + " 条记录";
    if (sortHint) sortHint.textContent = query ? "清除搜索后可调整主页展示顺序。" : "使用上移、下移调整公开主页上的展示顺序。";
    results.replaceChildren();
    if (!filtered.length) {
      results.append(emptyEntries("没有找到匹配的记录。", { label: "清除搜索", run: () => { search.value = ""; state.search[kind] = ""; paint(); search.focus(); } }, "NO MATCH / 无匹配"));
      return;
    }
    const list = el("div", "cards");
    filtered.forEach((entry, index) => list.append(entryCard(kind, entry, index, query ? null : entries)));
    results.append(list);
  };
  search.addEventListener("input", () => { state.search[kind] = search.value; paint(); });
  root.append(toolbar); if (sortHint) root.append(sortHint); root.append(results); paint();
}
async function deleteEntry(kind, entry) {
  if (!confirm("确定删除「" + (entry.data.title || "这条记录") + "」吗？删除后无法撤销。")) return;
  try {
    await request("/api/" + categories[kind].scope + "/entries/" + entry.id, { method: "DELETE", headers: { "X-Local-Request": "1" } });
    await refresh(); notice("已删除");
  } catch (error) { notice(error.message, true); }
}
function openEntry(kind, entry = null) {
  if (state.saving || !categories[kind]) return;
  state.editing = { kind, entry };
  byId("dialog-notice").textContent = "";
  byId("dialog-notice").hidden = true;
  byId("dialog-title").textContent = (entry ? "编辑" : "新增") + categories[kind].title;
  const isPublic = categories[kind].scope === "public";
  byId("dialog-kicker").textContent = isPublic ? "PUBLIC / EDITOR" : "PRIVATE / EDITOR";
  byId("dialog-scope").textContent = isPublic ? "保存后会显示在公开主页" : "仅保存在本机，不显示在公开主页";
  const root = byId("entry-fields"); root.replaceChildren();
  categories[kind].fields.forEach(([key, label, type, options]) => {
    if (type === "image") {
      const imageInput = input("entry-" + key, "", "file"); imageInput.accept = "image/jpeg,image/png,image/webp,image/gif";
      const wrap = field(label, imageInput, true);
      const current = imageUrl(categories[kind].scope, entry?.data.image);
      if (["photos", "gallery"].includes(kind) && !current) imageInput.required = true;
      if (current) { const img = document.createElement("img"); img.className = "image-preview"; img.src = current; img.alt = "当前图片"; wrap.append(img); }
      const remove = input("entry-remove-image", "", "checkbox");
      if (current) { const removeLabel = el("label", "hint", " 移除当前图片"); removeLabel.prepend(remove); wrap.append(removeLabel); }
      else { remove.hidden = true; wrap.append(remove); }
      root.append(wrap); return;
    }
    let control;
    if (type === "textarea") { control = document.createElement("textarea"); control.rows = 5; control.value = entry?.data[key] || ""; }
    else if (type === "select") {
      control = document.createElement("select");
      options.forEach((option) => { const item = el("option", "", option); item.value = option; control.append(item); });
      control.value = entry?.data[key] || options[0];
    } else control = input("entry-" + key, entry?.data[key] || "", type);
    control.id = "entry-" + key; control.name = key;
    if (key === "title") { control.required = true; control.maxLength = 200; }
    if (key === "progress") { control.min = "0"; control.max = "100"; }
    root.append(field(label, control, type === "textarea"));
  });
  motion.openDialog(byId("entry-dialog"));
  const first = root.querySelector("input,textarea,select"); if (first) first.focus();
}
async function saveEntry(event) {
  event.preventDefault();
  const { kind, entry } = state.editing;
  const category = categories[kind], form = byId("entry-form");
  const data = {};
  category.fields.forEach(([key, , type]) => { if (type !== "image") data[key] = form.elements.namedItem(key).value.trim(); });
  if (category.fields.some((fieldItem) => fieldItem[0] === "image")) {
    data.image = byId("entry-remove-image").checked ? "" : entry?.data.image || "";
    const file = byId("entry-image").files[0];
    if (file) data.image = (await upload(category.scope, file)).name;
    if (["photos", "gallery"].includes(kind) && !data.image) throw new Error("请为照片选择图片");
  }
  if (kind === "goals" && data.progress && (+data.progress < 0 || +data.progress > 100)) throw new Error("进度必须在 0 到 100 之间");
  const path = "/api/" + category.scope + "/entries" + (entry ? "/" + entry.id : "");
  await request(path, writeOptions(entry ? "PUT" : "POST", entry ? { data } : { kind, data }));
  await motion.closeDialog(byId("entry-dialog"));
  try { await refresh(); notice("内容已保存"); }
  catch { notice("内容已保存，但列表暂未刷新，请刷新页面查看。", true); }
}
function renderBackup(root) {
  const exportPanel = el("section", "panel");
  exportPanel.append(el("h2", "", "导出公开主页"), el("p", "muted", "下载可离线打开的公开主页 ZIP。只包含公开资料、公开条目和其引用的公开图片；不含私人记录、私人照片或内容管理入口。此操作不会把网站发布到网上。"));
  const exportLink = el("a", "primary", "下载公开主页 ZIP");
  exportLink.href = "/api/public/export"; exportLink.download = "personal-journal-public.zip";
  exportLink.style.display = "inline-block"; exportLink.style.textDecoration = "none";
  exportPanel.append(exportLink); root.append(exportPanel);
  const panel = el("section", "panel");
  panel.append(el("h2", "", "下载私人备份"), el("p", "muted", "备份包含私人记录数据库和私人照片，不包含公开主页内容。请把 ZIP 文件保存在安全的位置。"));
  const download = el("a", "primary", "下载私人备份 ZIP"); download.href = "/api/private/backup"; download.download = "personal-journal-private.zip"; download.style.display = "inline-block"; download.style.textDecoration = "none"; panel.append(download); root.append(panel);
  const restorePanel = el("section", "panel");
  restorePanel.append(el("h2", "", "从备份恢复"), el("p", "warning", "恢复会替换目前的全部私人记录与私人照片。程序会在本机 data/pre-restore-backups 文件夹额外保存恢复前的备份。公开主页不会被替换。"));
  const file = input("backup-file", "", "file"); file.accept = ".zip,application/zip";
  const fileField = field("选择之前导出的 ZIP 备份", file, true); restorePanel.append(fileField);
  const button = el("button", "danger", "恢复私人数据"); button.style.marginTop = "16px";
  button.addEventListener("click", async () => {
    if (!file.files[0]) return notice("请先选择备份文件", true);
    if (!confirm("确定恢复吗？当前私人数据会被备份文件替换。")) return;
    button.disabled = true;
    try {
      await request("/api/private/restore", { method: "POST", headers: { "Content-Type": "application/zip", "X-Local-Request": "1" }, body: file.files[0] });
      await refresh(); notice("恢复成功");
    } catch (error) { notice(error.message, true); }
    finally { button.disabled = false; }
  });
  restorePanel.append(button); root.append(restorePanel);
}
navButtons.forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
navButtons.forEach((button) => { const option = el("option", "", button.textContent); option.value = button.dataset.view; byId("view-select").append(option); });
byId("view-select").addEventListener("change", (event) => setView(event.target.value));
byId("add-button").addEventListener("click", () => openEntry(state.view));
const closeEntry = () => { if (!state.saving) motion.closeDialog(byId("entry-dialog")); };
byId("close-dialog").addEventListener("click", closeEntry);
byId("cancel-dialog").addEventListener("click", closeEntry);
byId("entry-dialog").addEventListener("cancel", (event) => { event.preventDefault(); closeEntry(); });
byId("entry-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.saving) return;
  state.saving = true;
  const button = event.currentTarget.querySelector("[type=submit]"); button.disabled = true;
  button.textContent = "保存中…"; button.setAttribute("aria-busy", "true");
  byId("entry-dialog").setAttribute("aria-busy", "true");
  byId("close-dialog").disabled = byId("cancel-dialog").disabled = true;
  try { await saveEntry(event); }
  catch (error) {
    event.preventDefault();
    if (byId("entry-dialog").open) {
      byId("dialog-notice").textContent = error.message; byId("dialog-notice").hidden = false;
      motion.arrive(byId("dialog-notice"), -3);
    }
    else notice(error.message, true);
  }
  finally {
    state.saving = false; button.disabled = false;
    button.textContent = "保存"; button.removeAttribute("aria-busy");
    byId("entry-dialog").removeAttribute("aria-busy");
    byId("close-dialog").disabled = byId("cancel-dialog").disabled = false;
  }
});
document.addEventListener("studio:navigate", (event) => setView(event.detail));
refresh().then(() => { updateNavigation(state.view); motion.arrive(byId("view-stage")); }).catch((error) => notice("无法连接本地服务：" + error.message, true))
  .finally(() => document.dispatchEvent(new Event("studio:ready")));
