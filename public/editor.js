(() => {
  if (document.documentElement.hasAttribute("data-export")) return;
  const dialog = document.getElementById("studio-dialog");
  const frame = document.getElementById("studio-frame");
  const loading = document.getElementById("studio-loading");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const exitDuration = 220;
  let ready = false;
  let pendingView = null;
  let trigger = null;
  let closing = false;
  let closeTimer = null;
  let transitionId = 0;

  const send = (type, view) => frame.contentWindow?.postMessage({ type, view }, location.origin);
  function focusEditor() {
    if (!dialog.open || closing) return;
    frame.focus({ preventScroll: true });
    send("studio:focus");
  }
  function clearCloseTimer() {
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = null;
  }
  function finishClose(id) {
    if (id !== transitionId || !closing || !dialog.open) return;
    clearCloseTimer();
    dialog.close();
  }
  function close() {
    if (!dialog.open || closing) return;
    closing = true;
    const id = ++transitionId;
    dialog.classList.add("studio-closing");
    document.body.classList.add("studio-leaving");
    if (reducedMotion.matches) finishClose(id);
    else closeTimer = window.setTimeout(() => finishClose(id), exitDuration);
  }
  function open(link) {
    const url = new URL(link.href, location.origin);
    ++transitionId;
    clearCloseTimer();
    closing = false;
    dialog.classList.remove("studio-closing");
    document.body.classList.remove("studio-leaving");
    trigger = link;
    pendingView = url.searchParams.get("view");
    if (!dialog.open) dialog.showModal();
    document.body.classList.add("studio-open");
    if (!frame.getAttribute("src")) {
      url.searchParams.set("embedded", "1");
      frame.src = url.href;
    } else if (ready) {
      if (pendingView) send("studio:navigate", pendingView);
      focusEditor();
    }
  }

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.("a[data-local-only]");
    if (!link || link.target === "_blank") return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin || url.pathname !== "/studio") return;
    event.preventDefault();
    open(link);
  });
  document.getElementById("studio-close").addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("close", () => {
    // A native close event can arrive after a quick reopen; it belongs to the old visit.
    if (dialog.open) return;
    ++transitionId;
    clearCloseTimer();
    closing = false;
    dialog.classList.remove("studio-closing");
    document.body.classList.remove("studio-open", "studio-leaving");
    if (trigger?.isConnected !== false) trigger?.focus({ preventScroll: true });
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches && closing) finishClose(transitionId);
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === "studio:ready") {
      const firstReady = !ready;
      ready = true;
      frame.hidden = false;
      loading.hidden = true;
      dialog.classList.add("studio-ready");
      if (firstReady && dialog.open && !closing) {
        if (pendingView) send("studio:navigate", pendingView);
        focusEditor();
      }
    } else if (event.data?.type === "studio:close") {
      close();
    } else if (event.data?.type === "studio:public-changed") {
      document.dispatchEvent(new Event("public:refresh"));
    }
  });
})();
