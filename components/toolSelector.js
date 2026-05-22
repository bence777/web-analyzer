export function initToolSelector({
  openAnalyzerBtn,
  openPaletteBtn,
  openImageBtn,
  openTrustBtn,
  openSizerBtn,

  onOpenAnalyzer,
  onOpenPalette,
  onOpenImage,
  onOpenTrust,
  onOpenSizer,
}) {
  openAnalyzerBtn?.addEventListener("click", onOpenAnalyzer);

  openPaletteBtn?.addEventListener("click", onOpenPalette);

  openImageBtn?.addEventListener("click", onOpenImage);

  openTrustBtn?.addEventListener("click", onOpenTrust);

  openSizerBtn?.addEventListener("click", onOpenSizer);
}