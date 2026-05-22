export async function initSizeTool() {
  const applySizesBtn = document.querySelector("#applySizesBtn");
  const resetSizesBtn = document.querySelector("#resetSizesBtn");
  const sizePreset = document.querySelector("#sizePreset");
  const sizerStatus = document.querySelector("#sizerStatus");
  const sizePresetRadios = document.querySelectorAll('input[name="sizePresetRadio"]');

  const devicePreset = document.querySelector("#devicePreset");
  const applyDeviceBtn = document.querySelector("#applyDeviceBtn");
  const resetDeviceBtn = document.querySelector("#resetDeviceBtn");

  if (!applySizesBtn || !resetSizesBtn || !sizePreset || !sizerStatus) {
    console.warn("Size tool HTML elemek nem találhatók.");
    return;
  }

  const blockedUrls = [
    "chrome://",
    "edge://",
    "about:",
    "chrome-extension://",
    "moz-extension://",
    "safari-extension://",
  ];

  function syncRadioToSelect() {
    sizePresetRadios.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked) sizePreset.value = radio.value;
      });
    });
  }

  function setStatus(message, type = "idle") {
    sizerStatus.innerHTML = `
      <span class="status-dot"></span>
      <span>${message}</span>
    `;
    sizerStatus.className = `status ${type} sizer-status`;
  }

  function setLoading(isLoading) {
    [
      applySizesBtn,
      resetSizesBtn,
      applyDeviceBtn,
      resetDeviceBtn,
    ].forEach((btn) => {
      if (!btn) return;
      btn.disabled = isLoading;
      btn.classList.toggle("is-loading", isLoading);
    });
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) {
      throw new Error("Nincs aktív tab.");
    }

    if (!tab.url || blockedUrls.some((url) => tab.url.startsWith(url))) {
      throw new Error(
        "Ezen az oldalon nem lehet használni. Nyiss meg egy normál weboldalt."
      );
    }

    return tab;
  }

  syncRadioToSelect();

  applySizesBtn.addEventListener("click", async () => {
    try {
      setLoading(true);
      setStatus("Méretezés alkalmazása folyamatban...", "idle");

      const tab = await getActiveTab();

      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        args: [sizePreset.value],
        func: applyWebsiteSizing,
      });

      setStatus("Méretezés sikeresen alkalmazva.", "success");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Méret módosítás sikertelen.", "error");
    } finally {
      setLoading(false);
    }
  });

  resetSizesBtn.addEventListener("click", async () => {
    try {
      setLoading(true);
      setStatus("Eredeti méretek visszaállítása...", "idle");

      const tab = await getActiveTab();

      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        func: resetWebsiteSizing,
      });

      setStatus("Eredeti méretek visszaállítva.", "success");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Visszaállítás sikertelen.", "error");
    } finally {
      setLoading(false);
    }
  });

  if (applyDeviceBtn && resetDeviceBtn && devicePreset) {
    applyDeviceBtn.addEventListener("click", async () => {
      try {
        setLoading(true);
        setStatus("Telefonos nézet megnyitása új ablakban...", "idle");

        const tab = await getActiveTab();

        const DEVICES = {
          iphoneSE: { width: 375, height: 667 },
          iphone12: { width: 390, height: 844 },
          iphone14ProMax: { width: 430, height: 932 },
          pixel7: { width: 412, height: 915 },
          samsungS21: { width: 360, height: 800 },
          ipadMini: { width: 768, height: 1024 },
        };

        const device = DEVICES[devicePreset.value] || DEVICES.iphone12;

        await chrome.windows.create({
          url: tab.url,
          type: "popup",
          width: device.width,
          height: device.height,
        });

        setStatus("Telefonos méretű ablak megnyitva.", "success");
      } catch (error) {
        console.error(error);
        setStatus(error.message || "Telefonos nézet sikertelen.", "error");
      } finally {
        setLoading(false);
      }
    });

    resetDeviceBtn.addEventListener("click", async () => {
      try {
        setLoading(true);
        setStatus("Telefonos nézet kikapcsolása...", "idle");

        const tab = await getActiveTab();

        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          func: resetPhonePreviewMode,
        });

        setStatus("Telefonos nézet kikapcsolva.", "success");
      } catch (error) {
        console.error(error);
        setStatus(error.message || "Telefonos nézet reset sikertelen.", "error");
      } finally {
        setLoading(false);
      }
    });
  }
}

function applyWebsiteSizing(preset) {
  const CONFIGS = {
    compact: {
      text: "14px",
      textLine: "1.45",
      h1: "40px",
      h2: "32px",
      h3: "24px",
      sectionY: "48px",
      cardPadding: "18px",
      buttonPadding: "10px 18px",
      inputPadding: "10px 14px",
      radius: "14px",
      container: "1080px",
    },
    normal: {
      text: "16px",
      textLine: "1.6",
      h1: "52px",
      h2: "40px",
      h3: "30px",
      sectionY: "80px",
      cardPadding: "28px",
      buttonPadding: "14px 24px",
      inputPadding: "14px 16px",
      radius: "20px",
      container: "1200px",
    },
    large: {
      text: "18px",
      textLine: "1.7",
      h1: "64px",
      h2: "48px",
      h3: "36px",
      sectionY: "96px",
      cardPadding: "36px",
      buttonPadding: "16px 28px",
      inputPadding: "16px 18px",
      radius: "24px",
      container: "1280px",
    },
    huge: {
      text: "20px",
      textLine: "1.8",
      h1: "76px",
      h2: "58px",
      h3: "42px",
      sectionY: "120px",
      cardPadding: "44px",
      buttonPadding: "18px 32px",
      inputPadding: "18px 20px",
      radius: "28px",
      container: "1360px",
    },
  };

  const config = CONFIGS[preset] || CONFIGS.normal;

  document.querySelector("#web-tools-size-style")?.remove();

  const style = document.createElement("style");
  style.id = "web-tools-size-style";

  style.textContent = `
    html { scroll-behavior: smooth !important; }
    body { overflow-x: hidden !important; }

    *, *::before, *::after {
      box-sizing: border-box !important;
    }

    p, span, li, a, button, label, input, textarea, select {
      font-size: ${config.text} !important;
      line-height: ${config.textLine} !important;
    }

    h1 {
      font-size: clamp(34px, 6vw, ${config.h1}) !important;
      line-height: 1.08 !important;
      letter-spacing: -0.04em !important;
    }

    h2 {
      font-size: clamp(28px, 4.5vw, ${config.h2}) !important;
      line-height: 1.12 !important;
      letter-spacing: -0.035em !important;
    }

    h3 {
      font-size: clamp(22px, 3vw, ${config.h3}) !important;
      line-height: 1.2 !important;
    }

    img, picture, video, canvas, svg {
      max-width: 100% !important;
      height: auto !important;
    }

    section {
      padding-top: ${config.sectionY} !important;
      padding-bottom: ${config.sectionY} !important;
    }

    main, .container, [class*="container"], [class*="Container"] {
      max-width: ${config.container} !important;
      width: 100% !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    .card, [class*="card"], [class*="Card"], article {
      padding: ${config.cardPadding} !important;
      border-radius: ${config.radius} !important;
    }

    button, a[role="button"], .btn, [class*="button"], [class*="Button"] {
      padding: ${config.buttonPadding} !important;
      border-radius: 999px !important;
      min-height: 44px !important;
      cursor: pointer !important;
    }

    input, textarea, select {
      padding: ${config.inputPadding} !important;
      border-radius: 12px !important;
      min-height: 44px !important;
    }

    @media (max-width: 768px) {
      section {
        padding-top: 48px !important;
        padding-bottom: 48px !important;
      }

      main, .container, [class*="container"], [class*="Container"] {
        max-width: 100% !important;
        padding-left: 16px !important;
        padding-right: 16px !important;
      }
    }
  `;

  document.head.appendChild(style);
}

function resetWebsiteSizing() {
  document.querySelector("#web-tools-size-style")?.remove();
}

function applyPhonePreviewMode(deviceKey) {
  const DEVICES = {
    iphoneSE: { width: 375, height: 667, label: "iPhone SE" },
    iphone12: { width: 390, height: 844, label: "iPhone 12 / 13 / 14" },
    iphone14ProMax: { width: 430, height: 932, label: "iPhone 14 Pro Max" },
    pixel7: { width: 412, height: 915, label: "Google Pixel 7" },
    samsungS21: { width: 360, height: 800, label: "Samsung Galaxy S21" },
    ipadMini: { width: 768, height: 1024, label: "iPad Mini" },
  };

  const device = DEVICES[deviceKey] || DEVICES.iphone12;

  document.querySelector("#web-tools-phone-preview-style")?.remove();

  const style = document.createElement("style");
  style.id = "web-tools-phone-preview-style";

  style.textContent = `
    html {
      background: #111827 !important;
      min-height: 100% !important;
      overflow-x: hidden !important;
    }

    body {
      width: ${device.width}px !important;
      min-height: ${device.height}px !important;
      max-width: ${device.width}px !important;
      margin: 40px auto !important;
      overflow-x: hidden !important;
      background: #ffffff !important;
      border-radius: 34px !important;
      box-shadow:
        0 0 0 12px #020617,
        0 0 0 14px rgba(255,255,255,0.12),
        0 30px 90px rgba(0,0,0,0.55) !important;
      position: relative !important;
    }

    body::before {
      content: "${device.label} — ${device.width}×${device.height}";
      position: fixed !important;
      top: 10px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      z-index: 2147483647 !important;
      background: #020617 !important;
      color: white !important;
      padding: 8px 14px !important;
      border-radius: 999px !important;
      font: 600 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      letter-spacing: 0.02em !important;
      box-shadow: 0 12px 30px rgba(0,0,0,0.35) !important;
      pointer-events: none !important;
    }

    *, *::before, *::after {
      box-sizing: border-box !important;
    }

    img, video, canvas, svg, iframe {
      max-width: 100% !important;
    }

    main, section, header, footer, nav, div {
      max-width: 100% !important;
    }

    @media (min-width: 1px) {
      body {
        width: ${device.width}px !important;
        max-width: ${device.width}px !important;
      }
    }
  `;

  document.head.appendChild(style);

  window.dispatchEvent(new Event("resize"));
}

function resetPhonePreviewMode() {
  document.querySelector("#web-tools-phone-preview-style")?.remove();

  document.documentElement.style.background = "";
  document.body.style.width = "";
  document.body.style.maxWidth = "";
  document.body.style.minHeight = "";
  document.body.style.margin = "";
  document.body.style.overflowX = "";
  document.body.style.background = "";
  document.body.style.borderRadius = "";
  document.body.style.boxShadow = "";

  window.dispatchEvent(new Event("resize"));
}