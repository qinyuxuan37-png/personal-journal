(() => {
  let embedded = false;
  try {
    embedded = window.parent !== window && window.parent.location.origin === location.origin
      && new URLSearchParams(location.search).get("embedded") === "1";
  } catch {}
  if (!embedded) return;
  // Set before CSS loads so the iframe is transparent from its first paint.
  document.documentElement.classList.add("studio-embedded");
  const send = (type) => window.parent.postMessage({ type }, location.origin);
  document.addEventListener("studio:ready", () => send("studio:ready"));
  document.addEventListener("studio:public-changed", () => send("studio:public-changed"));
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data?.type === "studio:navigate" && typeof event.data.view === "string") {
      document.dispatchEvent(new CustomEvent("studio:navigate", { detail: event.data.view }));
    }
    if (event.data?.type === "studio:focus") document.getElementById("section-title")?.focus({ preventScroll: true });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
    event.preventDefault();
    send("studio:close");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.(".preview-link")) return;
    event.preventDefault();
    send("studio:close");
  });
  document.addEventListener("DOMContentLoaded", () => {
    const link = document.querySelector(".preview-link");
    if (link) link.textContent = "返回展示 ↗";
    document.getElementById("section-title").tabIndex = -1;
  });
})();
