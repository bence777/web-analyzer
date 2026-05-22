export async function initImageTool() {
  console.log("Image tool inicializálva");

  const extractImagesBtn = document.querySelector("#extractImagesBtn");
  const imageList = document.querySelector("#imageList");

  if (!extractImagesBtn || !imageList) {
    console.warn("Image tool HTML elemek nem találhatók.");
    return;
  }

  extractImagesBtn.addEventListener("click", async () => {
    imageList.innerHTML = "<p>Képek keresése...</p>";

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        imageList.innerHTML = "<p>Nincs aktív tab.</p>";
        return;
      }

      let images = [];

      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: "EXTRACT_IMAGES",
        });

        images = response?.images || [];
      } catch (error) {
        console.warn("Content script nem válaszolt, direkt scan indul.");
      }

      if (images.length === 0) {
        const result = await chrome.scripting.executeScript({
          target: {
            tabId: tab.id,
            allFrames: true,
          },
          func: scanImagesDirectly,
        });

        images = result.flatMap((item) => item.result || []);
      }

      const uniqueImages = Array.from(
        new Map(images.map((image) => [image.src, image])).values()
      );

      imageList.innerHTML = "";

      if (uniqueImages.length === 0) {
        imageList.innerHTML = "<p>Nem található kép az oldalon.</p>";
        return;
      }

      uniqueImages.forEach((image, index) => {
        const item = document.createElement("div");
        item.style.marginBottom = "14px";

        const img = document.createElement("img");
        img.src = image.src;
        img.alt = image.alt || "Kép";
        img.style.maxWidth = "140px";
        img.style.maxHeight = "140px";
        img.style.display = "block";
        img.style.objectFit = "cover";
        img.style.borderRadius = "8px";
        img.style.marginBottom = "6px";

        const buttonWrap = document.createElement("div");
        buttonWrap.style.display = "flex";
        buttonWrap.style.gap = "8px";
        buttonWrap.style.alignItems = "center";

        const openLink = document.createElement("a");
        openLink.href = image.src;
        openLink.textContent = "Megnyitás";
        openLink.target = "_blank";
        openLink.rel = "noopener noreferrer";

        const downloadBtn = document.createElement("button");
        downloadBtn.textContent = "Letöltés";
        downloadBtn.type = "button";
        downloadBtn.style.cursor = "pointer";

        downloadBtn.addEventListener("click", async () => {
          await downloadImage(image.src, index);
        });

        buttonWrap.appendChild(openLink);
        buttonWrap.appendChild(downloadBtn);

        item.appendChild(img);
        item.appendChild(buttonWrap);
        imageList.appendChild(item);
      });
    } catch (error) {
      console.error("Képek lekérése sikertelen:", error);
      imageList.innerHTML = "<p>Hiba történt a képek lekérésekor.</p>";
    }
  });
}

async function downloadImage(imageUrl, index = 0) {
  try {
    const response = await fetch(imageUrl, {
      mode: "cors",
    });

    if (!response.ok) {
      throw new Error("A kép nem tölthető le fetch-csel.");
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const extension = getImageExtension(imageUrl, blob.type);
    const fileName = `image-${index + 1}.${extension}`;

    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.warn("Fetch alapú letöltés sikertelen, sima linkes letöltés indul:", error);

    const extension = getImageExtension(imageUrl);
    const fileName = `image-${index + 1}.${extension}`;

    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = fileName;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

function getImageExtension(url, mimeType = "") {
  if (mimeType) {
    const mimeMap = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/svg+xml": "svg",
      "image/avif": "avif",
      "image/bmp": "bmp",
      "image/x-icon": "ico",
    };

    if (mimeMap[mimeType]) {
      return mimeMap[mimeType];
    }
  }

  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i);

    if (match) {
      return match[1].toLowerCase().replace("jpeg", "jpg");
    }
  } catch {
    return "jpg";
  }

  return "jpg";
}

function scanImagesDirectly() {
  const found = new Map();

  function addImage(url, data = {}) {
    if (!url) return;

    try {
      const absoluteUrl = new URL(url, window.location.href).href;

      if (absoluteUrl.startsWith("data:")) return;
      if (absoluteUrl.startsWith("blob:")) return;
      if (absoluteUrl.startsWith("chrome-extension:")) return;

      found.set(absoluteUrl, {
        src: absoluteUrl,
        alt: data.alt || "Kép",
        width: data.width || null,
        height: data.height || null,
        type: data.type || "image",
      });
    } catch {
      return;
    }
  }

  function getSrcsetUrls(srcset) {
    if (!srcset) return [];

    return srcset
      .split(",")
      .map((item) => item.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function getBackgroundUrls(value) {
    if (!value || value === "none") return [];

    const urls = [];
    const regex = /url\(["']?(.*?)["']?\)/g;
    let match;

    while ((match = regex.exec(value)) !== null) {
      if (match[1]) urls.push(match[1]);
    }

    return urls;
  }

  function isImageUrl(url) {
    return /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)(\?.*)?$/i.test(url || "");
  }

  function scanRoot(root) {
    root.querySelectorAll("img").forEach((img) => {
      [
        img.currentSrc,
        img.src,
        img.getAttribute("src"),
        img.getAttribute("data-src"),
        img.getAttribute("data-lazy-src"),
        img.getAttribute("data-original"),
        img.getAttribute("data-url"),
        img.getAttribute("data-image"),
        img.getAttribute("data-image-src"),
      ].forEach((url) => {
        addImage(url, {
          alt: img.alt || img.title || "Kép",
          width: img.naturalWidth || img.width || null,
          height: img.naturalHeight || img.height || null,
          type: "img",
        });
      });

      [
        img.getAttribute("srcset"),
        img.getAttribute("data-srcset"),
        img.getAttribute("data-lazy-srcset"),
      ].forEach((srcset) => {
        getSrcsetUrls(srcset).forEach((url) => {
          addImage(url, {
            alt: img.alt || "Srcset kép",
            type: "srcset",
          });
        });
      });
    });

    root.querySelectorAll("picture source, source").forEach((source) => {
      [
        source.getAttribute("src"),
        source.getAttribute("srcset"),
        source.getAttribute("data-srcset"),
      ].forEach((value) => {
        if (!value) return;

        if (value.includes(",")) {
          getSrcsetUrls(value).forEach((url) => {
            addImage(url, {
              alt: "Source kép",
              type: "source",
            });
          });
        } else {
          addImage(value, {
            alt: "Source kép",
            type: "source",
          });
        }
      });
    });

    root.querySelectorAll("[style], *").forEach((el) => {
      const style = getComputedStyle(el);

      [
        style.backgroundImage,
        el.style.backgroundImage,
        el.getAttribute("data-bg"),
        el.getAttribute("data-background"),
        el.getAttribute("data-background-image"),
        el.getAttribute("data-lazy-bg"),
      ].forEach((value) => {
        if (!value) return;

        if (value.includes("url(")) {
          getBackgroundUrls(value).forEach((url) => {
            addImage(url, {
              alt: "Háttérkép",
              type: "background",
            });
          });
        } else {
          addImage(value, {
            alt: "Háttérkép",
            type: "background",
          });
        }
      });
    });

    root.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");

      if (isImageUrl(href)) {
        addImage(href, {
          alt: a.textContent.trim() || "Linkelt kép",
          type: "link",
        });
      }
    });

    root
      .querySelectorAll("meta[property='og:image'], meta[name='twitter:image']")
      .forEach((meta) => {
        addImage(meta.getAttribute("content"), {
          alt: "Meta kép",
          type: "meta",
        });
      });

    root.querySelectorAll("svg image").forEach((image) => {
      addImage(
        image.getAttribute("href") || image.getAttribute("xlink:href"),
        {
          alt: "SVG kép",
          type: "svg",
        }
      );
    });

    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) {
        scanRoot(el.shadowRoot);
      }
    });
  }

  scanRoot(document);

  return [...found.values()];
}