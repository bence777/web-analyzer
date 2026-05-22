export async function initPaletteTool() {
  const extractBtn = document.querySelector("#extractPaletteBtn");
  const resetBtn = document.querySelector("#resetPaletteBtn");
  const statusText = document.querySelector("#paletteStatus");
  const colorsList = document.querySelector("#paletteColors");
  const activeColorText = document.querySelector("#activePaletteColor");
  const selectedPreview = document.querySelector("#selectedColorPreview");

  let colors = [];
  let activeColor = null;
  let copiedColor = null;

  const MAX_PALETTE_COLORS = 3;

  if (!extractBtn || !statusText || !colorsList) {
    console.warn("Palette tool elemek hiányoznak a popup HTML-ből.");
    return;
  }

  await loadSavedState();

  extractBtn.addEventListener("click", async () => {
    setStatus("Színek kinyerése...");
    extractBtn.disabled = true;

    try {
      const tab = await getActiveTab();

      if (!tab?.id) {
        setStatus("Nem található aktív tab.");
        return;
      }

      await ensureContentScript(tab.id);

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "EXTRACT_COLORS",
      });

      colors = Array.isArray(response?.colors)
        ? [...new Set(response.colors.filter(isValidHex))].slice(0, MAX_PALETTE_COLORS)
        : [];

      activeColor = colors.includes(activeColor) ? activeColor : null;

      await saveState();
      renderColors();
      renderActiveColor();

      setStatus(
        colors.length
          ? `${colors.length} szín találva a palettában.`
          : "Nem találtam színeket."
      );
    } catch (error) {
      console.error(error);
      setStatus("Hiba történt a paletta kinyerése közben.");
    } finally {
      extractBtn.disabled = false;
    }
  });

  resetBtn?.addEventListener("click", async () => {
    colors = [];
    activeColor = null;
    copiedColor = null;

    await chrome.storage.local.remove([
      "paletteColors",
      "activePaletteColor",
    ]);

    try {
      const tab = await getActiveTab();

      if (tab?.id) {
        await ensureContentScript(tab.id);

        await chrome.tabs.sendMessage(tab.id, {
          type: "DISABLE_PAINT_MODE",
        });
      }
    } catch (error) {
      console.warn(error);
    }

    renderColors();
    renderActiveColor();
    setStatus("Paletta törölve.");
  });

  async function selectColor(hex) {
    if (!isValidHex(hex)) return;

    activeColor = normalizeHex(hex);
    copiedColor = activeColor;

    await copyToClipboard(activeColor);
    await saveState();

    renderColors();
    renderActiveColor();

    try {
      const tab = await getActiveTab();

      if (!tab?.id) {
        setStatus("Nincs aktív tab.");
        return;
      }

      await ensureContentScript(tab.id);

      await chrome.tabs.sendMessage(tab.id, {
        type: "SET_ACTIVE_COLOR",
        color: activeColor,
      });

      setStatus(`Aktív szín: ${activeColor}. Kattints bármelyik elemre az oldalon.`);
    } catch (error) {
      console.error(error);
      setStatus("Nem sikerült bekapcsolni a festő módot.");
    }

    setTimeout(() => {
      if (copiedColor === activeColor) {
        copiedColor = null;
        renderColors();
      }
    }, 900);
  }

  function renderColors() {
    colorsList.innerHTML = "";

    if (!colors.length) {
      colorsList.innerHTML = `
        <div class="empty-state">
          Még nincs kinyert paletta.
        </div>
      `;
      return;
    }

    const palette = document.createElement("div");
    palette.className = "real-palette";

    colors.slice(0, MAX_PALETTE_COLORS).forEach((hex) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "palette-color";

      if (hex === activeColor) {
        item.classList.add("active");
      }

      item.style.background = hex;
      item.title = hex;

      const code = document.createElement("span");
      code.className = "palette-color-code";
      code.textContent = hex;

      const feedback = document.createElement("span");
      feedback.className = "copy-feedback";
      feedback.textContent = copiedColor === hex ? "Másolva" : "";

      item.append(code, feedback);
      item.addEventListener("click", () => selectColor(hex));

      palette.appendChild(item);
    });

    colorsList.appendChild(palette);
  }

  function renderActiveColor() {
    if (activeColorText) {
      activeColorText.textContent = activeColor
        ? `Aktív szín: ${activeColor}`
        : "Nincs aktív szín";
    }

    if (selectedPreview) {
      selectedPreview.style.background = activeColor || "transparent";
    }
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    return tab;
  }

  async function ensureContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: "PING",
      });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
    }
  }

  function setStatus(message) {
    statusText.textContent = message;
  }

  async function saveState() {
    await chrome.storage.local.set({
      paletteColors: colors.slice(0, MAX_PALETTE_COLORS),
      activePaletteColor: activeColor,
    });
  }

  async function loadSavedState() {
    try {
      const data = await chrome.storage.local.get([
        "paletteColors",
        "activePaletteColor",
      ]);

      colors = Array.isArray(data.paletteColors)
        ? data.paletteColors.filter(isValidHex).map(normalizeHex).slice(0, MAX_PALETTE_COLORS)
        : [];

      activeColor =
        isValidHex(data.activePaletteColor) &&
        colors.includes(normalizeHex(data.activePaletteColor))
          ? normalizeHex(data.activePaletteColor)
          : null;

      renderColors();
      renderActiveColor();

      if (activeColor) {
        setStatus(`Aktív szín betöltve: ${activeColor}`);
      } else {
        setStatus("Paletta készen áll.");
      }
    } catch (error) {
      console.error(error);
      setStatus("Mentett paletta betöltése sikertelen.");
    }
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  }

  function isValidHex(value) {
    return typeof value === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
  }

  function normalizeHex(hex) {
    if (!isValidHex(hex)) return null;

    let value = hex.toUpperCase();

    if (value.length === 4) {
      value =
        "#" +
        value[1] +
        value[1] +
        value[2] +
        value[2] +
        value[3] +
        value[3];
    }

    return value;
  }
}