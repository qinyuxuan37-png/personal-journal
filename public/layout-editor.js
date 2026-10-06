(() => {
  if (document.documentElement.hasAttribute("data-export")) return;
  const model = window.SpaceLayout;
  const get = (id) => document.getElementById("layout-" + id);
  const canvas = document.getElementById("about");
  const toolbar = get("toolbar"), status = get("status"), start = get("start");
  const wide = window.matchMedia("(min-width: 1000px) and (min-height: 640px)");
  const labels = { profile: "个人卡片", clock: "地区与时间" };
  const items = [...canvas.querySelectorAll(".layout-item")];
  const handles = [];
  let editing = false, busy = false, saved = null, draft = null, history, drag = null, noticeTimer;
  const hint = "拖动模块 · 右下角缩放 · 方向键微调，Shift + 方向键缩放 · Esc 取消";
  const dirty = () => !model.equal(saved, draft);
  function say(message, temporary = false) {
    clearTimeout(noticeTimer);
    status.hidden = false;
    status.textContent = message;
    if (temporary) noticeTimer = setTimeout(() => { if (!editing) status.hidden = true; }, 5000);
  }
  function sync() {
    start.disabled = window.publicLayout === undefined || !wide.matches;
    if (!editing) return;
    window.renderSpaceLayout(draft || model.defaults());
    get("undo").disabled = busy || !history.canUndo;
    get("redo").disabled = busy || !history.canRedo;
    get("save").disabled = busy || !dirty();
    get("save").textContent = busy ? "保存中…" : "保存布局";
    get("cancel").disabled = busy;
    get("reset").disabled = busy || draft === null;
    handles.forEach((handle) => { handle.inert = busy; });
  }
  function finish(message) {
    cancelDrag();
    editing = false;
    document.body.classList.remove("layout-editing");
    handles.splice(0).forEach((handle) => handle.remove());
    items.forEach((item) => { item.inert = false; });
    toolbar.hidden = true;
    window.renderSpaceLayout();
    if (message) say(message, true); else status.hidden = true;
    (document.getElementById("wallpaper-diy") || start).focus({ preventScroll: true });
  }
  function paintProposal(id, next) {
    handles.forEach((handle) => handle.classList.toggle("is-blocked", handle.dataset.layout === id && !next));
    if (!next) { say("这里会与其他模块重叠，请换个位置或先移开其他模块。"); return; }
    draft = next;
    sync();
  }
  function cancelDrag() {
    if (!drag) return;
    const previous = drag;
    drag = null;
    draft = history.current();
    previous.handle.classList.remove("is-dragging", "is-blocked");
    if (previous.button.hasPointerCapture(previous.pointerId)) previous.button.releasePointerCapture(previous.pointerId);
    sync();
  }
  function makeHandle(id) {
    const handle = document.createElement("div");
    handle.className = "layout-handle";
    handle.dataset.layout = id;
    const move = document.createElement("button"), resize = document.createElement("button");
    move.type = resize.type = "button";
    move.className = "layout-move";
    move.setAttribute("aria-label", "移动" + labels[id] + "，可使用方向键");
    const label = document.createElement("span");
    label.textContent = "⠿ " + labels[id];
    move.append(label);
    resize.className = "layout-resize";
    resize.textContent = "↘";
    resize.setAttribute("aria-label", "缩放" + labels[id] + "，可使用方向键");
    handle.append(move, resize);
    for (const button of [move, resize]) {
      button.addEventListener("pointerdown", (event) => {
        if (busy || drag || event.button !== 0) return;
        event.preventDefault();
        button.focus({ preventScroll: true });
        const rect = canvas.getBoundingClientRect();
        drag = { handle, button, pointerId: event.pointerId, id, resize: button === resize,
          x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, base: history.current() };
        handle.classList.add("is-dragging");
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const dx = (event.clientX - drag.x) / drag.width * model.cols;
        const dy = (event.clientY - drag.y) / drag.height * model.rows;
        // Clicking a handle alone must not convert the automatic layout into a saved one.
        if (!Math.round(dx) && !Math.round(dy)) { draft = drag.base; sync(); return; }
        paintProposal(id, model.change(drag.base, id, dx, dy, drag.resize));
      });
      button.addEventListener("pointerup", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag = null;
        handle.classList.remove("is-dragging", "is-blocked");
        button.releasePointerCapture(event.pointerId);
        history.push(draft);
        sync();
        say(hint);
      });
      button.addEventListener("pointercancel", cancelDrag);
      button.addEventListener("lostpointercapture", cancelDrag);
      button.addEventListener("keydown", (event) => {
        const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!steps[event.key] || busy || drag || event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        const next = model.change(draft, id, ...steps[event.key], button === resize || event.shiftKey);
        paintProposal(id, next);
        if (next) { history.push(next); sync(); say(labels[id] + "已调整；保存后生效。"); }
      });
    }
    handles.push(handle);
    canvas.append(handle);
  }
  start.addEventListener("click", () => {
    if (editing || !wide.matches || window.publicLayout === undefined) return;
    document.getElementById("wallpaper-dialog")?.close();
    if (!canvas.classList.contains("is-active")) {
      document.getElementById("home-page-link")?.click();
      window.HomePages?.reset();
    }
    saved = model.normalize(window.publicLayout);
    draft = model.copy(saved);
    history = new model.History(saved);
    editing = true;
    document.body.classList.add("layout-editing");
    items.forEach((item) => { item.inert = true; });
    model.ids.forEach(makeHandle);
    toolbar.hidden = false;
    sync();
    say(hint);
    handles[0].querySelector("button").focus({ preventScroll: true });
  });
  get("cancel").addEventListener("click", () => { if (!busy) finish("已取消，本次布局调整未保存。"); });
  get("reset").addEventListener("click", () => {
    if (busy) return;
    cancelDrag();
    draft = null;
    history.push(draft);
    sync();
    say("已选择默认自动排版，点击保存生效；也可以撤销。");
  });
  for (const action of ["undo", "redo"]) get(action).addEventListener("click", () => {
    if (busy) return;
    cancelDrag();
    draft = history[action]();
    sync();
    say(action === "undo" ? "已撤销上一步。" : "已重做上一步。");
  });
  get("save").addEventListener("click", async () => {
    if (busy || !dirty()) return;
    cancelDrag();
    const value = model.copy(draft);
    busy = true;
    sync();
    say("正在保存布局…");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("/api/public/layout", {
        method: value ? "PUT" : "DELETE", headers: { "Content-Type": "application/json", "X-Local-Request": "1" },
        body: value ? JSON.stringify(value) : undefined, signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败");
      window.publicLayout = result.layout;
      saved = model.copy(result.layout);
      busy = false;
      finish("布局已保存，刷新后也会保留。小屏幕使用自动排版。");
    } catch (error) {
      busy = false;
      sync();
      say("布局未确认保存：" + (error.name === "AbortError" ? "请求超时，可重试。" : error.message) + " 调整仍保留在当前编辑中。");
    } finally { clearTimeout(timer); }
  });
  // Intercept navigation only while editing; ordinary links keep their native behavior otherwise.
  document.addEventListener("click", (event) => {
    if (editing && event.target.closest?.("a")) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener("keydown", (event) => {
    if (!editing) return;
    const key = event.key.toLowerCase(), command = event.ctrlKey || event.metaKey;
    if (event.key === "Escape" || (command && ["z", "y", "s"].includes(key))) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (busy) return;
      if (event.key === "Escape") { if (drag) { cancelDrag(); say("已取消这次拖动。"); } else finish("已取消，本次布局调整未保存。"); }
      else get(key === "s" ? "save" : key === "y" || event.shiftKey ? "redo" : "undo").click();
    }
  }, true);
  document.addEventListener("public:rendered", sync);
  wide.addEventListener("change", () => {
    sync();
    if (!editing) return;
    cancelDrag();
    if (!wide.matches) {
      // Keep the draft in memory when the window shrinks, so widening restores it.
      handles.forEach((handle) => { handle.hidden = true; });
      window.renderSpaceLayout(null);
      say("窗口较小，暂用自动排版。拉宽窗口可继续调整，或保存／取消当前草稿。");
    } else { handles.forEach((handle) => { handle.hidden = false; }); sync(); say(hint); }
  });
  const navigated = () => { if (editing && !busy) finish("已退出布局编辑，未保存的调整已取消。"); };
  window.addEventListener("popstate", navigated);
  window.addEventListener("hashchange", navigated);
  window.addEventListener("blur", cancelDrag);
  window.addEventListener("resize", cancelDrag);
  window.addEventListener("beforeunload", (event) => {
    if (editing && (dirty() || busy)) { event.preventDefault(); event.returnValue = ""; }
  });
  sync();
})();
