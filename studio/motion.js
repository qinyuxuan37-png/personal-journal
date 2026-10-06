/* Animation owns presentation only. Database operations remain in app.js. */
(() => {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const running = new Map();
  const dialogEpochs = new WeakMap();
  const origins = new WeakMap();
  let viewEpoch = 0, switching = false, activeButton = null;
  function stop(node) { running.get(node)?.finish(); }
  function play(node, frames, duration = 220) {
    if (!node) return Promise.resolve();
    stop(node);
    if (preference.matches || document.hidden || typeof node.animate !== "function") return Promise.resolve();
    return new Promise((resolve) => {
      let animation, timer, ended = false;
      const entry = { finish() {
        if (ended) return;
        ended = true;
        window.clearTimeout(timer);
        animation?.cancel();
        if (running.get(node) === entry) running.delete(node);
        resolve();
      } };
      try {
        animation = node.animate(frames, { duration, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
        running.set(node, entry);
        timer = window.setTimeout(entry.finish, duration + 120);
        animation.finished.then(entry.finish, entry.finish);
      } catch { entry.finish(); }
    });
  }
  const arrive = (node, distance = 8) => play(node, [
    { opacity: 0, transform: `translateY(${distance}px)` },
    { opacity: 1, transform: "translateY(0)" }
  ]);
  async function swap(commit) {
    const stage = document.getElementById("view-stage");
    const epoch = ++viewEpoch;
    switching = true;
    stage.inert = true;
    stage.setAttribute("aria-busy", "true");
    try {
      await play(stage, [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-4px)" }], 90);
      if (epoch !== viewEpoch) return;
      commit();
      stage.inert = false;
      await arrive(stage);
    } finally {
      if (epoch === viewEpoch) {
        switching = false;
        stage.inert = false;
        stage.removeAttribute("aria-busy");
      }
    }
  }
  function syncNav(button) {
    activeButton = button || activeButton;
    const indicator = document.getElementById("nav-indicator");
    if (!indicator || !activeButton) return;
    indicator.style.transform = `translateY(${activeButton.offsetTop}px)`;
    indicator.style.height = activeButton.offsetHeight + "px";
    indicator.hidden = false;
    activeButton.parentElement.classList.add("has-indicator");
  }
  function openDialog(dialog) {
    dialogEpochs.set(dialog, (dialogEpochs.get(dialog) || 0) + 1);
    stop(dialog);
    dialog.classList.remove("is-closing");
    dialog.inert = false;
    const form = dialog.querySelector("form");
    if (form) form.inert = false;
    if (!dialog.open) { origins.set(dialog, document.activeElement); dialog.showModal(); }
    return play(dialog, [
      { opacity: 0, transform: "translateY(12px) scale(.985)" },
      { opacity: 1, transform: "translateY(0) scale(1)" }
    ], 240);
  }
  async function closeDialog(dialog) {
    if (!dialog.open || dialog.classList.contains("is-closing")) return;
    const epoch = (dialogEpochs.get(dialog) || 0) + 1;
    dialogEpochs.set(dialog, epoch);
    dialog.classList.add("is-closing");
    // Keep the modal's focus trap until close; only its form becomes inert.
    const form = dialog.querySelector("form");
    if (form) form.inert = true;
    await play(dialog, [
      { opacity: 1, transform: "translateY(0) scale(1)" },
      { opacity: 0, transform: "translateY(7px) scale(.99)" }
    ], 150);
    if (epoch !== dialogEpochs.get(dialog)) return;
    dialog.close();
    dialog.classList.remove("is-closing");
    if (form) form.inert = false;
    const origin = origins.get(dialog);
    if (origin?.isConnected) origin.focus({ preventScroll: true });
    else document.getElementById("add-button")?.focus({ preventScroll: true });
  }
  function resize(node, mutate) {
    stop(node);
    const before = node.getBoundingClientRect().height;
    mutate();
    const after = node.getBoundingClientRect().height;
    return play(node, [{ height: before + "px", overflow: "hidden" }, { height: after + "px", overflow: "hidden" }], 180);
  }
  function settle() { [...running.values()].forEach((entry) => entry.finish()); }
  preference.addEventListener("change", () => { if (preference.matches) settle(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) settle(); });
  window.addEventListener("resize", () => syncNav());
  window.StudioMotion = { play, arrive, swap, syncNav, openDialog, closeDialog, resize, get switching() { return switching; } };
})();
