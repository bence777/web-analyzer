export function createViews() {
  const views = {
    menu: document.querySelector("#menuView"),
    analyzer: document.querySelector("#analyzerView"),
    palette: document.querySelector("#paletteView"),
    image: document.querySelector("#imageView"),
    trust: document.querySelector("#trustView"),
    sizer: document.querySelector("#sizerView"),
  };

  function hideAllViews() {
    Object.values(views).forEach((view) => {
      if (view) {
        view.classList.add("hidden");
      }
    });
  }

  function showView(viewName) {
    hideAllViews();

    const selectedView = views[viewName];

    if (!selectedView) {
      console.warn(`Nem található view: ${viewName}`);
      views.menu?.classList.remove("hidden");
      return;
    }

    selectedView.classList.remove("hidden");
  }

  document.querySelectorAll("[data-back-menu]").forEach((button) => {
    button.addEventListener("click", () => {
      showView("menu");
    });
  });

  return {
    showView,
  };
}