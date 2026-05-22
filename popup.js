import { createViews } from "./views.js";
import { initToolSelector } from "./components/toolSelector.js";
import { initAnalyzerTool } from "./components/analyzerTool.js";
import { initPaletteTool } from "./components/paletteTool.js";
import { initTrustTool } from "./components/trustTool.js";
import { initSizeTool } from "./components/sizerTools.js";
import { initImageTool } from "./components/imageTool.js";

const views = createViews();

initToolSelector({
  openAnalyzerBtn: document.querySelector("#openAnalyzerBtn"),
  openPaletteBtn: document.querySelector("#openPaletteBtn"),
  openImageBtn: document.querySelector("#openImageBtn"),
  openTrustBtn: document.querySelector("#openTrustBtn"),
  openSizerBtn: document.querySelector("#openSizerBtn"),

  onOpenAnalyzer: () => views.showView("analyzer"),
  onOpenPalette: () => views.showView("palette"),
  onOpenImage: () => views.showView("image"),
  onOpenTrust: () => views.showView("trust"),
  onOpenSizer: () => views.showView("sizer"),
});

initAnalyzerTool();
initPaletteTool();
initTrustTool();
initSizeTool();
initImageTool();
