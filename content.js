console.log("CONTENT SCRIPT BETÖLTVE");

let activeColor = null;
let paintMode = false;
let lastHoveredElement = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Üzenet érkezett a content.js-ben:", message);

  if (!message) return false;

  if (message.type === "PING") {
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "EXTRACT_COLORS") {
    const colors = extractColorsFromPage();
    sendResponse({ colors });
    return true;
  }

  if (message.type === "EXTRACT_IMAGES") {
    const images = extractImagesFromPage();
    sendResponse({ images });
    return true;
  }

  if (message.type === "SET_ACTIVE_COLOR") {
    if (!isValidHex(message.color)) {
      sendResponse({ success: false });
      return true;
    }

    activeColor = normalizeHex(message.color);
    paintMode = true;

    document.documentElement.style.cursor = "crosshair";
    document.body.style.cursor = "crosshair";

    sendResponse({
      success: true,
      color: activeColor,
    });

    return true;
  }

  if (message.type === "DISABLE_PAINT_MODE") {
    disablePaintMode();
    sendResponse({ success: true });
    return true;
  }

  return false;
});

document.addEventListener(
  "mouseover",
  (event) => {
    if (!paintMode || !activeColor) return;

    const target = getPaintTarget(event.target);
    if (!target) return;

    if (lastHoveredElement && lastHoveredElement !== target) {
      lastHoveredElement.style.outline =
        lastHoveredElement.dataset.oldPaintOutline || "";
      delete lastHoveredElement.dataset.oldPaintOutline;
    }

    lastHoveredElement = target;

    if (!target.dataset.oldPaintOutline) {
      target.dataset.oldPaintOutline = target.style.outline || "";
    }

    target.style.outline = `2px solid ${activeColor}`;
    target.style.outlineOffset = "2px";
  },
  true
);

document.addEventListener(
  "mouseout",
  () => {
    if (!lastHoveredElement) return;

    lastHoveredElement.style.outline =
      lastHoveredElement.dataset.oldPaintOutline || "";
    delete lastHoveredElement.dataset.oldPaintOutline;
    lastHoveredElement = null;
  },
  true
);

document.addEventListener(
  "click",
  (event) => {
    if (!paintMode || !activeColor) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const target = getPaintTarget(event.target);
    if (!target) return;

    paintElement(target, activeColor);

    console.log("Elem átszínezve:", target, activeColor);
  },
  true
);

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape") {
      disablePaintMode();
    }
  },
  true
);

function extractImagesFromPage() {
  const found = new Map();

  document.querySelectorAll("img").forEach((img) => {
    const urls = [
      img.currentSrc,
      img.src,
      img.getAttribute("src"),
      img.getAttribute("data-src"),
      img.getAttribute("data-lazy-src"),
      img.getAttribute("data-original"),
      img.getAttribute("data-url"),
      img.getAttribute("data-image"),
      img.getAttribute("data-image-src"),
      img.getAttribute("data-bg"),
    ];

    urls.forEach((url) => {
      addImage(found, url, {
        alt: img.alt || img.title || "Kép",
        width: img.naturalWidth || img.width || null,
        height: img.naturalHeight || img.height || null,
        type: "img",
      });
    });

    const srcsetUrls = extractUrlsFromSrcset(
      img.getAttribute("srcset") || img.getAttribute("data-srcset")
    );

    srcsetUrls.forEach((url) => {
      addImage(found, url, {
        alt: img.alt || img.title || "Srcset kép",
        width: img.naturalWidth || img.width || null,
        height: img.naturalHeight || img.height || null,
        type: "srcset",
      });
    });
  });

  document.querySelectorAll("picture source, source").forEach((source) => {
    const srcsetUrls = extractUrlsFromSrcset(
      source.getAttribute("srcset") || source.getAttribute("data-srcset")
    );

    srcsetUrls.forEach((url) => {
      addImage(found, url, {
        alt: "Source image",
        width: null,
        height: null,
        type: "source",
      });
    });

    addImage(found, source.getAttribute("src"), {
      alt: "Source image",
      width: null,
      height: null,
      type: "source",
    });
  });

  document.querySelectorAll("*").forEach((element) => {
    const style = getComputedStyle(element);

    const backgroundImages = [
      style.backgroundImage,
      element.style.backgroundImage,
      element.getAttribute("data-bg"),
      element.getAttribute("data-background"),
      element.getAttribute("data-background-image"),
      element.getAttribute("data-lazy-bg"),
      element.getAttribute("data-src"),
    ];

    backgroundImages.forEach((value) => {
      if (!value || value === "none") return;

      if (value.includes("url(")) {
        const urls = extractUrlsFromBackground(value);

        urls.forEach((url) => {
          addImage(found, url, {
            alt: "Háttérkép",
            width: null,
            height: null,
            type: "background",
          });
        });
      } else {
        addImage(found, value, {
          alt: "Háttérkép",
          width: null,
          height: null,
          type: "background",
        });
      }
    });
  });

  document.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href");

    if (isImageUrl(href)) {
      addImage(found, href, {
        alt: link.textContent.trim() || "Linkelt kép",
        width: null,
        height: null,
        type: "link",
      });
    }
  });

  return [...found.values()];
}

function addImage(found, url, data = {}) {
  if (!url) return;

  const absoluteSrc = toAbsoluteUrl(url);
  if (!absoluteSrc) return;

  if (absoluteSrc.startsWith("data:")) return;
  if (absoluteSrc.startsWith("blob:")) return;
  if (absoluteSrc.startsWith("chrome-extension:")) return;

  found.set(absoluteSrc, {
    src: absoluteSrc,
    alt: data.alt || "Kép",
    width: data.width || null,
    height: data.height || null,
    type: data.type || "image",
  });
}

function extractUrlsFromSrcset(srcset) {
  if (!srcset) return [];

  return srcset
    .split(",")
    .map((item) => item.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function extractUrlsFromBackground(backgroundImage) {
  const urls = [];
  const regex = /url\(["']?(.*?)["']?\)/g;

  let match;

  while ((match = regex.exec(backgroundImage)) !== null) {
    if (match[1]) {
      urls.push(match[1]);
    }
  }

  return urls;
}

function isImageUrl(url) {
  if (!url) return false;

  return /\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i.test(url);
}

function toAbsoluteUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return null;
  }
}

function paintElement(element, color) {
  if (!element || !(element instanceof HTMLElement)) return;

  const computed = getComputedStyle(element);

  if (isTextLikeElement(element)) {
    element.style.setProperty("color", color, "important");
    return;
  }

  if (
    computed.backgroundColor === "rgba(0, 0, 0, 0)" ||
    computed.backgroundColor === "transparent"
  ) {
    element.style.setProperty("background-color", color, "important");
    return;
  }

  element.style.setProperty("background-color", color, "important");
}

function getPaintTarget(target) {
  if (!target) return null;

  if (target.nodeType === Node.TEXT_NODE) {
    target = target.parentElement;
  }

  if (!(target instanceof HTMLElement)) return null;

  if (target === document.documentElement) {
    return document.body;
  }

  return target;
}

function disablePaintMode() {
  paintMode = false;
  activeColor = null;

  document.documentElement.style.cursor = "";
  document.body.style.cursor = "";

  if (lastHoveredElement) {
    lastHoveredElement.style.outline =
      lastHoveredElement.dataset.oldPaintOutline || "";
    delete lastHoveredElement.dataset.oldPaintOutline;
    lastHoveredElement = null;
  }
}

function extractColorsFromPage() {
  const found = new Set();

  document.querySelectorAll("*").forEach((el) => {
    const style = getComputedStyle(el);

    [
      style.color,
      style.backgroundColor,
      style.borderColor,
      style.borderTopColor,
      style.borderRightColor,
      style.borderBottomColor,
      style.borderLeftColor,
    ].forEach((color) => {
      const hex = rgbToHex(color);
      if (hex) found.add(hex);
    });
  });

  return [...found].slice(0, 50);
}

function rgbToHex(color) {
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") {
    return null;
  }

  const match = color.match(/\d+/g);
  if (!match || match.length < 3) return null;

  const [r, g, b] = match.map(Number);

  if ([r, g, b].some((n) => Number.isNaN(n))) return null;

  return (
    "#" +
    [r, g, b]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function isValidHex(value) {
  return (
    typeof value === "string" &&
    /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
  );
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

function isTextLikeElement(element) {
  const textTags = [
    "P",
    "SPAN",
    "A",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LABEL",
    "BUTTON",
    "LI",
    "TD",
    "TH",
    "STRONG",
    "EM",
    "SMALL",
  ];

  return textTags.includes(element.tagName);
}