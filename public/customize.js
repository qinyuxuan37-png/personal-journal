(() => {
  if (document.documentElement.hasAttribute("data-export")) return;
  const get = (id) => document.getElementById(id);
  const dialog = get("wallpaper-dialog"), trigger = get("wallpaper-diy");
  const names = ["background", "layout", "opening"];
  const tabs = names.map((name) => get("diy-tab-" + name));
  let selected = 0;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let sizeAnimation = null, contentAnimation = null, revision = 0;
  function settle() {
    revision++;
    sizeAnimation?.cancel(); contentAnimation?.cancel();
    sizeAnimation = null; contentAnimation = null;
    if (dialog.style) dialog.style.height = "";
  }
  function fit(animate = true, fromHeight) {
    if (!dialog.open || !dialog.getBoundingClientRect) return;
    const before = fromHeight ?? dialog.getBoundingClientRect().height;
    const token = ++revision;
    sizeAnimation?.cancel();
    dialog.style.height = "auto";
    const after = dialog.getBoundingClientRect().height;
    dialog.style.height = `${after}px`;
    if (!animate || reduced?.matches || !dialog.animate || Math.abs(after - before) < 1) return;
    sizeAnimation = dialog.animate([{ height: `${before}px` }, { height: `${after}px` }], {
      duration: 300, easing: "cubic-bezier(.22,1,.36,1)", fill: "both"
    });
    const running = sizeAnimation;
    const finish = () => {
      if (token !== revision) return;
      running.cancel(); sizeAnimation = null;
    };
    running.finished.then(finish, finish);
    window.setTimeout(finish, 380);
  }
  function select(index, focus = true) {
    const changed = index !== selected;
    const before = dialog.open ? dialog.getBoundingClientRect?.().height : undefined;
    selected = index;
    contentAnimation?.cancel();
    names.forEach((name, i) => {
      tabs[i].setAttribute("aria-selected", String(i === index));
      tabs[i].tabIndex = i === index ? 0 : -1;
      get("diy-" + name).hidden = i !== index;
    });
    const panel = get("diy-" + names[index]);
    dialog.scrollTop = 0;
    panel.scrollTop = 0;
    fit(changed, before);
    if (changed && dialog.open && panel.animate && !reduced?.matches) {
      contentAnimation = panel.animate([{ opacity: 0, transform: "translateY(7px)" }, { opacity: 1, transform: "translateY(0)" }], {
        duration: 240, easing: "cubic-bezier(.22,1,.36,1)"
      });
    }
    if (focus) tabs[index].focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index));
    tab.addEventListener("keydown", (event) => {
      const destinations = { ArrowLeft: (index + 2) % 3, ArrowRight: (index + 1) % 3, Home: 0, End: 2 };
      if (!(event.key in destinations)) return;
      event.preventDefault();
      select(destinations[event.key]);
    });
  });
  trigger.addEventListener("click", () => {
    settle();
    get("opening-frequency").value = window.OpeningControls.getPreference();
    dialog.showModal();
    select(selected);
  });
  get("wallpaper-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    settle();
    if (!document.body.classList.contains("layout-editing") && !document.body.classList.contains("intro-active")) trigger.focus({ preventScroll: true });
  });
  reduced?.addEventListener?.("change", () => { settle(); fit(false); });
  window.addEventListener?.("resize", () => { settle(); fit(false); });
  if (window.ResizeObserver) {
    const observer = new window.ResizeObserver((entries) => {
      if (dialog.open && entries.some((entry) => entry.target === get("diy-" + names[selected]))) fit(true);
    });
    names.forEach((name) => observer.observe(get("diy-" + name)));
  }
  get("opening-frequency").addEventListener("change", (event) => {
    const saved = window.OpeningControls.setPreference(event.target.value);
    get("opening-preference-status").textContent = saved ? "已保存，下次打开时生效。" : "浏览器无法保存偏好，本次页面仍可重播预览。";
  });
  get("opening-preview").addEventListener("click", () => {
    dialog.close();
    document.dispatchEvent(new Event("intro:preview"));
  });
})();
