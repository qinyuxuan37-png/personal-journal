(() => {
  const model = window.SpaceLayout;
  const canvas = document.getElementById("about");
  const wide = window.matchMedia("(min-width: 1000px) and (min-height: 640px)");
  function render(value = window.publicLayout) {
    value = model.normalize(value);
    const active = wide.matches && model.valid(value);
    canvas.classList.toggle("has-layout", active);
    if (!active) return;
    canvas.querySelectorAll("[data-layout]").forEach((element) => {
      const box = value.items[element.dataset.layout];
      for (const [key, number] of Object.entries(box)) {
        element.style.setProperty("--layout-" + key, (number / (key === "x" || key === "w" ? model.cols : model.rows) * 100) + "%");
      }
    });
  }
  window.renderSpaceLayout = render;
  document.addEventListener("public:rendered", () => {
    if (!document.body.classList.contains("layout-editing")) render();
  });
  wide.addEventListener("change", () => {
    if (!document.body.classList.contains("layout-editing")) render();
  });
  render();
})();
