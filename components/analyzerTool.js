const get = (selector) => document.querySelector(selector);

const tabs = [
  "seo",
  "content",
  "ux",
  "links",
  "images",
  "technical",
  "performance",
  "accessibility",
  "security"
];

let selectedCategory = "seo";
let lastResult = null;
let savedReport = "";

export function initAnalyzerTool() {
  const ui = {
    analyzeBtn: get("#analyzeBtn"),
    status: get("#status"),

    scoreCard: get("#scoreCard"),
    scoreRing: get("#scoreRing"),
    score: get("#score"),

    pageTitle: get("#pageTitle"),
    pageUrl: get("#pageUrl"),
    qualityBadge: get("#qualityBadge"),
    issueCount: get("#issueCount"),

    metrics: get("#metrics"),
    topFixes: get("#topFixes"),
    topFixesList: get("#topFixesList"),

    categoryTabs: get("#categoryTabs"),
    categoryPanel: get("#categoryPanel"),
    categoryLabel: get("#categoryLabel"),
    categoryTitle: get("#categoryTitle"),
    categoryScore: get("#categoryScore"),
    categorySummary: get("#categorySummary"),
    categoryContent: get("#categoryContent"),

    actions: get("#actions"),
    copyBtn: get("#copyBtn")
  };

  ui.analyzeBtn?.addEventListener("click", () => runAudit(ui));

  ui.copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(savedReport);

      ui.copyBtn.textContent = "Másolva";

      setTimeout(() => {
        ui.copyBtn.textContent = "Riport másolása";
      }, 1200);
    } catch {
      showStatus(ui, "Nem sikerült másolni a riportot.", "error");
    }
  });
}

async function runAudit(ui) {
  try {
    toggleLoading(ui, true);
    hideAuditResult(ui);

    showStatus(ui, "Oldal adatainak kiolvasása…", "loading");

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab || !tab.id) {
      throw new Error("Nincs aktív böngészőfül.");
    }

    if (isRestrictedPage(tab.url)) {
      throw new Error("Ezt az oldalt a böngésző biztonsági okból nem engedi elemezni.");
    }

    const response = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPageData
    });

    const pageData = response?.[0]?.result;

    if (!pageData) {
      throw new Error("Nem sikerült kiolvasni az oldal adatait.");
    }

    showStatus(ui, "Audit pontszámok számítása…", "loading");

    lastResult = createAudit(pageData);
    savedReport = makeTextReport(lastResult);

    drawAudit(ui, lastResult);

    showStatus(ui, "Kész. A legfontosabb javítások felül vannak.", "idle");
  } catch (err) {
    showStatus(ui, err.message || "Ismeretlen hiba történt.", "error");
  } finally {
    toggleLoading(ui, false);
  }
}

function readPageData() {
  const start = performance.now();

  const meta = (selector) => {
    return document.querySelector(selector)?.getAttribute("content")?.trim() || "";
  };

  const pageText = (document.body?.innerText || "")
    .replace(/\s+/g, " ")
    .trim();

  const words = pageText
    ? pageText.split(" ").map((word) => word.trim()).filter(Boolean)
    : [];

  const sentences = pageText
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((heading) => {
    const level = Number(heading.tagName.slice(1));

    return {
      tag: heading.tagName.toLowerCase(),
      level,
      text: heading.innerText.trim()
    };
  });

  const links = [...document.querySelectorAll("a")].map((link) => ({
    href: link.getAttribute("href") || "",
    absoluteHref: link.href || "",
    text: link.innerText.trim() || link.getAttribute("aria-label") || link.title || "",
    target: link.getAttribute("target") || "",
    rel: link.getAttribute("rel") || "",
    download: link.hasAttribute("download")
  }));

  const images = [...document.querySelectorAll("img")].map((img) => ({
    src: img.currentSrc || img.src || "",
    alt: img.getAttribute("alt"),
    role: img.getAttribute("role") || "",
    ariaHidden: img.getAttribute("aria-hidden") || "",
    loading: img.getAttribute("loading") || "",
    decoding: img.getAttribute("decoding") || "",
    widthAttr: img.getAttribute("width"),
    heightAttr: img.getAttribute("height"),
    naturalWidth: img.naturalWidth || 0,
    naturalHeight: img.naturalHeight || 0
  }));

  const buttons = [...document.querySelectorAll("button")].map((button) => ({
    text: button.innerText.trim(),
    ariaLabel: button.getAttribute("aria-label") || "",
    title: button.getAttribute("title") || "",
    disabled: button.disabled
  }));

  const inputs = [...document.querySelectorAll("input, textarea, select")].map((input) => {
    const id = input.id;

    const hasLabel =
      Boolean(id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
      Boolean(input.closest("label"));

    return {
      tag: input.tagName.toLowerCase(),
      type: input.getAttribute("type") || input.tagName.toLowerCase(),
      ariaLabel: input.getAttribute("aria-label") || "",
      ariaLabelledby: input.getAttribute("aria-labelledby") || "",
      placeholder: input.getAttribute("placeholder") || "",
      required: input.hasAttribute("required"),
      autocomplete: input.getAttribute("autocomplete") || "",
      hasLabel
    };
  });

  const iframes = [...document.querySelectorAll("iframe")].map((iframe) => ({
    title: iframe.getAttribute("title") || "",
    loading: iframe.getAttribute("loading") || "",
    src: iframe.src || ""
  }));

  const scripts = [...document.scripts].map((script) => ({
    src: script.src || "",
    async: script.async,
    defer: script.defer,
    type: script.type || "",
    textLength: script.src ? 0 : script.textContent.trim().length
  }));

  const stylesheets = [...document.querySelectorAll('link[rel~="stylesheet"]')].map((link) => ({
    href: link.href || "",
    media: link.getAttribute("media") || ""
  }));

  const forms = [...document.querySelectorAll("form")].map((form) => ({
    action: form.getAttribute("action") || "",
    method: form.getAttribute("method") || "get",
    inputCount: form.querySelectorAll("input, textarea, select").length
  }));

  const landmarks = {
    header: document.querySelectorAll("header").length,
    nav: document.querySelectorAll("nav").length,
    main: document.querySelectorAll("main").length,
    footer: document.querySelectorAll("footer").length,
    aside: document.querySelectorAll("aside").length
  };

  const resourceEntries = performance.getEntriesByType("resource") || [];

  const resources = resourceEntries.map((entry) => ({
    name: entry.name,
    initiatorType: entry.initiatorType,
    duration: Math.round(entry.duration || 0),
    transferSize: entry.transferSize || 0,
    encodedBodySize: entry.encodedBodySize || 0
  }));

  const navigation = performance.getEntriesByType("navigation")?.[0];

  const resourceSummary = {
    total: resources.length,
    scripts: resources.filter((item) => item.initiatorType === "script").length,
    css: resources.filter((item) => item.initiatorType === "css" || item.initiatorType === "link").length,
    images: resources.filter((item) => item.initiatorType === "img").length,
    fonts: resources.filter((item) => item.initiatorType === "font").length,
    totalTransferKb: Math.round(
      resources.reduce((sum, item) => {
        return sum + (item.transferSize || item.encodedBodySize || 0);
      }, 0) / 1024
    )
  };

  const navTiming = navigation
    ? {
        domContentLoaded: Math.round(navigation.domContentLoadedEventEnd),
        loadEventEnd: Math.round(navigation.loadEventEnd),
        responseEnd: Math.round(navigation.responseEnd),
        transferSize: navigation.transferSize || 0,
        encodedBodySize: navigation.encodedBodySize || 0
      }
    : null;

  return {
    collectedInMs: Math.round(performance.now() - start),

    title: document.title || "",
    url: location.href,
    host: location.hostname,
    protocol: location.protocol,
    path: location.pathname,

    description: meta('meta[name="description"]'),
    viewport: meta('meta[name="viewport"]'),
    robots: meta('meta[name="robots"]'),
    themeColor: meta('meta[name="theme-color"]'),

    charset: document.characterSet || "",
    canonical: document.querySelector('link[rel="canonical"]')?.href || "",
    favicon: Boolean(
      document.querySelector(
        'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
      )
    ),

    lang: document.documentElement.getAttribute("lang") || "",
    direction: document.documentElement.getAttribute("dir") || "",

    ogCount: document.querySelectorAll('meta[property^="og:"]').length,
    twitterCount: document.querySelectorAll('meta[name^="twitter:"]').length,
    jsonLdCount: document.querySelectorAll('script[type="application/ld+json"]').length,
    noscriptCount: document.querySelectorAll("noscript").length,

    headings,
    h1: headings.filter((item) => item.tag === "h1").map((item) => item.text),
    h2: headings.filter((item) => item.tag === "h2").map((item) => item.text),
    h3: headings.filter((item) => item.tag === "h3").map((item) => item.text),

    paragraphCount: document.querySelectorAll("p").length,
    wordCount: words.length,
    uniqueWordCount: new Set(words.map((word) => word.toLowerCase())).size,
    sentenceCount: sentences.length,
    averageSentenceLength: sentences.length ? Math.round(words.length / sentences.length) : 0,

    links,
    images,
    buttons,
    inputs,
    iframes,
    scripts,
    stylesheets,
    forms,
    landmarks,

    domElements: document.getElementsByTagName("*").length,

    scriptCount: scripts.length,
    externalScriptCount: scripts.filter((script) => script.src).length,
    inlineScriptCount: scripts.filter((script) => !script.src && script.textLength > 0).length,
    stylesheetCount: stylesheets.length,
    inlineStyleCount:
      document.querySelectorAll("[style]").length + document.querySelectorAll("style").length,

    resources,
    resourceSummary,
    navTiming
  };
}

function createAudit(data) {
  const parsedUrl = toUrl(data.url);
  const currentHost = parsedUrl?.hostname || data.host;

  const internalLinks = data.links.filter((link) => {
    const parsed = toUrl(link.absoluteHref);
    return parsed && parsed.hostname === currentHost && !isSpecialLink(link.href);
  });

  const externalLinks = data.links.filter((link) => {
    const parsed = toUrl(link.absoluteHref);
    return parsed && parsed.hostname !== currentHost && !isSpecialLink(link.href);
  });

  const badLinks = data.links.filter((link) => {
    return !link.href || link.href === "#" || link.href.toLowerCase().startsWith("javascript:");
  });

  const linksWithoutText = data.links.filter((link) => !link.text);

  const unsafeBlankLinks = data.links.filter((link) => {
    const rel = link.rel.toLowerCase();
    return link.target === "_blank" && (!rel.includes("noopener") || !rel.includes("noreferrer"));
  });

  const decorativeImages = data.images.filter((img) => {
    return img.alt === "" || img.role === "presentation" || img.ariaHidden === "true";
  });

  const imagesWithoutAlt = data.images.filter((img) => img.alt === null);
  const imagesWithEmptyAlt = data.images.filter((img) => img.alt === "");
  const lazyImages = data.images.filter((img) => img.loading === "lazy");
  const asyncDecodedImages = data.images.filter((img) => img.decoding === "async");
  const imagesWithoutSize = data.images.filter((img) => !img.widthAttr || !img.heightAttr);
  const oversizedImages = data.images.filter((img) => img.naturalWidth * img.naturalHeight > 1600000);

  const repeatedHeadings = getDuplicates(data.headings.map((heading) => heading.text).filter(Boolean));
  const headingOrderErrors = getHeadingOrderErrors(data.headings);

  const buttonsWithoutName = data.buttons.filter((button) => {
    return !button.text && !button.ariaLabel && !button.title;
  });

  const inputsWithoutLabel = data.inputs.filter((input) => {
    return !input.hasLabel && !input.ariaLabel && !input.ariaLabelledby;
  });

  const inputsWithoutAutocomplete = data.inputs.filter((input) => {
    const type = input.type.toLowerCase();
    return ["email", "password", "tel", "name", "text"].includes(type) && !input.autocomplete;
  });

  const iframesWithoutTitle = data.iframes.filter((iframe) => !iframe.title);
  const iframesWithoutLazy = data.iframes.filter((iframe) => !iframe.loading);

  const blockingScripts = data.scripts.filter((script) => {
    return script.src && !script.async && !script.defer;
  });

  const largeInlineScripts = data.scripts.filter((script) => {
    return !script.src && script.textLength > 5000;
  });

  const hasOneMain = data.landmarks.main === 1;
  const hasNavigation = data.landmarks.nav >= 1;

  const categories = {
    seo: makeCategory("SEO", "SEO elemzés", [
      makeCheck("Title", data.title ? `${data.title.length} karakter` : "Hiányzik", rateTitle(data.title), "Adj 30–60 karakteres, egyedi, kulcsszavas címet."),
      makeCheck("Meta leírás", data.description ? `${data.description.length} karakter` : "Hiányzik", rateDescription(data.description), "Írj 80–160 karakteres, konkrét meta leírást."),
      makeCheck("H1", `${data.h1.length} db`, rateH1(data.h1), "Legyen pontosan egy erős, beszédes H1 cím."),
      makeCheck("Alcím struktúra", `${data.h2.length} H2, ${data.h3.length} H3`, rateHeadings(data), "Tagold az oldalt logikus H2/H3 részekre."),
      makeCheck("Canonical", data.canonical ? "Van" : "Nincs", data.canonical ? 100 : 62, "Adj meg canonical URL-t a duplikációk elkerülésére."),
      makeCheck("Indexelés", data.robots || "Nincs robots tiltás", data.robots.toLowerCase().includes("noindex") ? 20 : 100, "Vedd ki a noindex értéket, ha az oldalnak meg kell jelennie Google-ben."),
      makeCheck("Social preview", `${data.ogCount} OG, ${data.twitterCount} Twitter`, rateSocial(data), "Adj meg Open Graph és Twitter Card meta tageket."),
      makeCheck("Structured data", `${data.jsonLdCount} JSON-LD blokk`, data.jsonLdCount ? 100 : 64, "Adj releváns Schema.org JSON-LD markupot."),
      makeCheck("Favicon", data.favicon ? "Van" : "Hiányzik", data.favicon ? 100 : 55, "Adj hozzá favicon vagy apple-touch-icon linket."),
      makeCheck("URL minőség", `${data.url.length} karakter`, rateUrl(data.url), "Legyen rövid, olvasható és beszédes az URL.")
    ]),

    content: makeCategory("Tartalom", "Tartalmi minőség", [
      makeCheck("Szöveg mennyisége", `${data.wordCount} szó`, rateWordCount(data.wordCount), "Bővítsd hasznos, keresési szándékhoz illő tartalommal."),
      makeCheck("Egyedi szókincs", `${data.uniqueWordCount} egyedi szó`, rateVocabulary(data), "Kerüld a túl ismétlődő, vékony tartalmat."),
      makeCheck("Bekezdések", `${data.paragraphCount} db`, data.paragraphCount >= 3 ? 100 : data.paragraphCount > 0 ? 70 : 35, "Használj rövid, jól tagolt bekezdéseket."),
      makeCheck("Mondathossz", `${data.averageSentenceLength} szó átlag`, rateSentenceLength(data.averageSentenceLength), "Rövidítsd a túl hosszú mondatokat."),
      makeCheck("Nyelv", data.lang || "Hiányzik", data.lang ? 100 : 40, 'Állítsd be: <html lang="hu"> vagy az oldal valós nyelve.'),
      makeCheck("Duplikált címek", `${repeatedHeadings.length} db`, repeatedHeadings.length ? 55 : 100, "Legyenek egyediek a headingek."),
      makeCheck("Heading sorrend", `${headingOrderErrors} hiba`, headingOrderErrors ? 55 : 100, "Ne ugorj például H2-ről H4-re.")
    ]),

    ux: makeCategory("UX", "Felhasználói élmény", [
      makeCheck("Viewport", data.viewport ? "Van" : "Hiányzik", data.viewport ? 100 : 30, "Mobil UX-hez kötelező a viewport meta tag."),
      makeCheck("Fő tartalmi landmark", hasOneMain ? "Rendben" : `${data.landmarks.main} main`, hasOneMain ? 100 : 55, "Legyen pontosan egy <main> elem."),
      makeCheck("Navigáció", hasNavigation ? `${data.landmarks.nav} nav` : "Nincs nav", hasNavigation ? 100 : 70, "Adj szemantikus <nav> elemet, ha van navigáció."),
      makeCheck("Űrlapmezők", `${inputsWithoutLabel.length} label hiba`, inputsWithoutLabel.length ? 45 : 100, "Minden input legyen egyértelműen címkézve."),
      makeCheck("Autocomplete", `${inputsWithoutAutocomplete.length} hiányzik`, inputsWithoutAutocomplete.length ? 72 : 100, "Bejelentkezésnél és űrlapoknál használj autocomplete attribútumot."),
      makeCheck("Theme color", data.themeColor || "Hiányzik", data.themeColor ? 90 : 72, "Mobil böngészőkhöz adhatsz theme-color meta taget.")
    ]),

    links: makeCategory("Linkek", "Link audit", [
      makeCheck("Összes link", `${data.links.length} db`, data.links.length ? 100 : 35, "Adj releváns belső linkeket."),
      makeCheck("Belső linkek", `${internalLinks.length} db`, internalLinks.length ? 100 : 55, "Linkelj fontos aloldalakra."),
      makeCheck("Külső linkek", `${externalLinks.length} db`, externalLinks.length ? 92 : 76, "Használj megbízható külső forrásokat, ahol indokolt."),
      makeCheck("Hibás href", `${badLinks.length} db`, badLinks.length ? 40 : 100, "Cseréld az üres vagy javascript linkeket valódi URL-re vagy gombra."),
      makeCheck("Üres link szöveg", `${linksWithoutText.length} db`, linksWithoutText.length ? 45 : 100, "Adj beszédes szöveget vagy aria-labelt."),
      makeCheck("Új ablak biztonság", `${unsafeBlankLinks.length} hiba`, unsafeBlankLinks.length ? 35 : 100, 'target="_blank" mellé kell rel="noopener noreferrer".')
    ]),

    images: makeCategory("Képek", "Kép optimalizálás", [
      makeCheck("Képek száma", `${data.images.length} db`, data.images.length ? 90 : 76, "Csak szükséges, optimalizált képeket használj."),
      makeCheck("Hiányzó alt", `${imagesWithoutAlt.length} db`, imagesWithoutAlt.length ? 35 : 100, "Minden tartalmi kép kapjon alt szöveget."),
      makeCheck("Üres alt", `${imagesWithEmptyAlt.length} db`, imagesWithEmptyAlt.length && imagesWithEmptyAlt.length !== decorativeImages.length ? 65 : 95, 'Dekoratív képnél oké az alt="", tartalmi képnél nem.'),
      makeCheck("Lazy loading", `${lazyImages.length}/${data.images.length}`, rateRatio(lazyImages.length, data.images.length, 0.5), 'Hajtás alatti képeknél használj loading="lazy"-t.'),
      makeCheck("Async decoding", `${asyncDecodedImages.length}/${data.images.length}`, rateRatio(asyncDecodedImages.length, data.images.length, 0.35), 'Adj decoding="async" attribútumot több képhez.'),
      makeCheck("Képméret attribútum", `${imagesWithoutSize.length} hiányzik`, imagesWithoutSize.length ? 60 : 100, "Adj width és height attribútumot a CLS csökkentésére."),
      makeCheck("Nagy képek", `${oversizedImages.length} db`, oversizedImages.length ? 55 : 100, "Használj WebP/AVIF formátumot és kisebb méretet.")
    ]),

    technical: makeCategory("Tech", "Technikai audit", [
      makeCheck("HTTPS", data.protocol === "https:" ? "Aktív" : "Nem HTTPS", data.protocol === "https:" ? 100 : 25, "Állíts be SSL-t és HTTPS átirányítást."),
      makeCheck("Viewport", data.viewport ? "Van" : "Hiányzik", data.viewport ? 100 : 35, "Adj hozzá responsive viewport meta taget."),
      makeCheck("Charset", data.charset || "Hiányzik", data.charset ? 100 : 60, "Használj UTF-8 karakterkódolást."),
      makeCheck("Script mennyiség", `${data.scriptCount} db`, data.scriptCount <= 25 ? 90 : 60, "Halaszd vagy töröld a nem kritikus scripteket."),
      makeCheck("Blokkoló script", `${blockingScripts.length} db`, blockingScripts.length ? 64 : 100, "Használj defer vagy async attribútumot a külső scripteken."),
      makeCheck("CSS fájlok", `${data.stylesheetCount} db`, data.stylesheetCount <= 10 ? 90 : 65, "Optimalizáld vagy vond össze a CSS-t."),
      makeCheck("Inline kód", `${data.inlineScriptCount + data.inlineStyleCount} db`, data.inlineScriptCount + data.inlineStyleCount > 20 ? 60 : 90, "Amit lehet, vigyél külön fájlba."),
      makeCheck("Noscript fallback", `${data.noscriptCount} db`, data.noscriptCount ? 90 : 70, "Fontos JS appnál hasznos lehet noscript üzenet.")
    ]),

    performance: makeCategory("Sebesség", "Performance becslés", [
      makeCheck("DOM méret", `${data.domElements} elem`, rateDomSize(data.domElements), "Egyszerűsítsd a markupot."),
      makeCheck("Erőforrások", `${data.resourceSummary.total} request`, rateResourceCount(data.resourceSummary.total), "Csökkentsd a külső requestek számát."),
      makeCheck("Átviteli méret", `${data.resourceSummary.totalTransferKb} KB`, rateTransferSize(data.resourceSummary.totalTransferKb), "Tömöríts, optimalizálj képeket és JS/CSS fájlokat."),
      makeCheck("Képterhelés", `${data.images.length} kép`, data.images.length <= 30 ? 90 : 60, "Optimalizáld és lazy loadold a képeket."),
      makeCheck("Nagy képek", `${oversizedImages.length} db`, oversizedImages.length ? 55 : 100, "Használj kisebb, reszponzív képeket."),
      makeCheck("JavaScript", `${data.scriptCount} script`, data.scriptCount <= 20 ? 90 : 58, "Használj defer/async betöltést és code splittinget."),
      makeCheck("CSS", `${data.stylesheetCount} fájl`, data.stylesheetCount <= 8 ? 90 : 65, "Csökkentsd a render blocking CSS-t."),
      makeCheck("Oldal load event", data.navTiming ? `${data.navTiming.loadEventEnd} ms` : "Nincs adat", data.navTiming ? rateLoadTime(data.navTiming.loadEventEnd) : 70, "Javítsd a szerverválaszt, képeket, JS-t és CSS-t.")
    ]),

    accessibility: makeCategory("A11y", "Akadálymentesítés", [
      makeCheck("Kép alt", `${imagesWithoutAlt.length} hiányzik`, imagesWithoutAlt.length ? 35 : 100, "Minden tartalmi kép kapjon altot."),
      makeCheck("Gomb nevek", `${buttonsWithoutName.length} hiba`, buttonsWithoutName.length ? 35 : 100, "Ikon gombhoz adj aria-labelt."),
      makeCheck("Link szövegek", `${linksWithoutText.length} hiba`, linksWithoutText.length ? 40 : 100, "Ne legyen üres vagy érthetetlen link."),
      makeCheck("Input label", `${inputsWithoutLabel.length} hiba`, inputsWithoutLabel.length ? 45 : 100, "Kapcsolj labelt az inputhoz."),
      makeCheck("Oldal nyelve", data.lang || "Hiányzik", data.lang ? 100 : 40, "Állítsd be a html lang attribútumot."),
      makeCheck("Heading sorrend", `${headingOrderErrors} hiba`, headingOrderErrors ? 55 : 100, "Tarts logikus H1 → H2 → H3 sorrendet."),
      makeCheck("Iframe title", `${iframesWithoutTitle.length} hiba`, iframesWithoutTitle.length ? 45 : 100, "Adj title attribútumot az iframe-ekhez."),
      makeCheck("Iframe lazy loading", `${iframesWithoutLazy.length} hiányzik`, iframesWithoutLazy.length ? 75 : 100, 'Nem kritikus iframe-ekhez adj loading="lazy"-t.')
    ]),

    security: makeCategory("Biztonság", "Alap biztonsági audit", [
      makeCheck("HTTPS", data.protocol === "https:" ? "Aktív" : "Nem HTTPS", data.protocol === "https:" ? 100 : 20, "Használj HTTPS-t minden oldalon."),
      makeCheck("Blank link védelem", `${unsafeBlankLinks.length} hiba`, unsafeBlankLinks.length ? 35 : 100, 'target="_blank" mellé kell rel="noopener noreferrer".'),
      makeCheck("Inline script méret", `${largeInlineScripts.length} nagy inline script`, largeInlineScripts.length ? 65 : 100, "Csökkentsd a nagy inline script blokkokat."),
      makeCheck("Űrlap method", `${data.forms.length} form`, rateForms(data.forms, data.protocol), "Érzékeny adatnál használj POST-ot és HTTPS-t."),
      makeCheck("Külső scriptek", `${data.externalScriptCount} db`, data.externalScriptCount <= 20 ? 88 : 62, "Csak megbízható, szükséges külső scripteket használj.")
    ])
  };

  const finalScore = weightedAverage([
    [categories.seo.score, 1.25],
    [categories.content.score, 1],
    [categories.ux.score, 1],
    [categories.links.score, 0.9],
    [categories.images.score, 0.9],
    [categories.technical.score, 1.1],
    [categories.performance.score, 1.2],
    [categories.accessibility.score, 1.15],
    [categories.security.score, 1]
  ]);

  const allChecks = Object.values(categories).flatMap((category) => {
    return category.checks.map((item) => ({
      ...item,
      category: category.label
    }));
  });

  const topFixes = uniqueBy(
    allChecks
      .filter((item) => item.score < 80)
      .sort((a, b) => {
        const order = {
          bad: 0,
          warn: 1,
          good: 2
        };

        return order[a.level] - order[b.level] || a.score - b.score;
      }),
    (item) => item.name + item.fix
  ).slice(0, 5);

  return {
    title: data.title || "Cím nélküli oldal",
    url: data.url,
    score: finalScore,
    quality: getQualityText(finalScore),
    issueCount: allChecks.filter((item) => item.score < 80).length,
    categories,
    topFixes,
    metrics: [
      { label: "SEO", value: `${categories.seo.score}%` },
      { label: "UX", value: `${categories.ux.score}%` },
      { label: "A11y", value: `${categories.accessibility.score}%` },
      { label: "Seb.", value: `${categories.performance.score}%` },
      { label: "Link", value: data.links.length },
      { label: "Kép", value: data.images.length },
      { label: "DOM", value: data.domElements },
      { label: "KB", value: data.resourceSummary.totalTransferKb }
    ]
  };
}

function makeCategory(label, title, checks) {
  return {
    label,
    title,
    checks,
    score: average(checks.map((item) => item.score))
  };
}

function makeCheck(name, value, score, fix) {
  const finalScore = clamp(Math.round(score), 0, 100);

  let level = "good";
  let status = "Rendben";

  if (finalScore < 50) {
    level = "bad";
    status = "Kritikus";
  } else if (finalScore < 80) {
    level = "warn";
    status = "Javítandó";
  }

  return {
    name,
    value,
    score: finalScore,
    fix,
    level,
    status
  };
}

function drawAudit(ui, result) {
  ui.score.textContent = result.score;
  ui.scoreRing.style.setProperty("--angle", `${result.score * 3.6}deg`);
  ui.scoreRing.style.setProperty("--ring-color", getScoreColor(result.score));

  ui.pageTitle.textContent = result.title;
  ui.pageUrl.textContent = result.url;

  ui.qualityBadge.textContent = result.quality;
  ui.issueCount.textContent = `${result.issueCount} javítás`;

  ui.metrics.innerHTML = result.metrics
    .map((metric) => {
      return `
        <article class="metric">
          <strong>${escapeHtml(metric.value)}</strong>
          <span>${escapeHtml(metric.label)}</span>
        </article>
      `;
    })
    .join("");

  drawTopFixes(ui, result.topFixes);
  drawTabs(ui, result.categories);
  drawCategory(ui, selectedCategory);

  showAuditResult(ui);
}

function drawTopFixes(ui, items) {
  if (!items.length) {
    ui.topFixesList.innerHTML = `
      <article class="fix-item">
        <strong>Nincs sürgős javítás</strong>
        <span>Az oldal alapállapota rendben van.</span>
      </article>
    `;
    return;
  }

  ui.topFixesList.innerHTML = items
    .map((item) => {
      return `
        <article class="fix-item">
          <strong>${escapeHtml(item.category)} · ${escapeHtml(item.name)} · ${item.score}/100</strong>
          <span>${escapeHtml(item.fix)}</span>
        </article>
      `;
    })
    .join("");
}

function drawTabs(ui, categories) {
  ui.categoryTabs.innerHTML = tabs
    .map((key) => {
      const category = categories[key];

      return `
        <button
          class="tab-btn ${key === selectedCategory ? "active" : ""}"
          data-category="${key}"
          type="button"
        >
          ${escapeHtml(category.label)} · ${category.score}
        </button>
      `;
    })
    .join("");

  ui.categoryTabs.querySelectorAll(".tab-btn").forEach((button) => {
    button.addEventListener("click", () => {
      selectedCategory = button.dataset.category;

      drawTabs(ui, lastResult.categories);
      drawCategory(ui, selectedCategory);
    });
  });
}

function drawCategory(ui, key) {
  const category = lastResult.categories[key];

  ui.categoryLabel.textContent = category.label;
  ui.categoryTitle.textContent = category.title;
  ui.categoryScore.textContent = `${category.score}/100`;
  ui.categorySummary.textContent = getCategorySummary(category);

  ui.categoryContent.innerHTML = category.checks
    .map((item) => {
      const fixHtml =
        item.level !== "good"
          ? `<p class="check-fix">${escapeHtml(item.fix)}</p>`
          : "";

      return `
        <article class="check-card">
          <div class="check-top">
            <div class="check-name">${escapeHtml(item.name)}</div>
            <span class="badge ${item.level}">${escapeHtml(item.status)} · ${item.score}</span>
          </div>

          <div class="check-value">${escapeHtml(item.value)}</div>

          ${fixHtml}
        </article>
      `;
    })
    .join("");
}

function makeTextReport(result) {
  let text = "";

  text += "========================\n";
  text += "Web Audit riport\n";
  text += "========================\n\n";

  text += `Oldal: ${result.title}\n`;
  text += `URL: ${result.url}\n`;
  text += `Pontszám: ${result.score}/100\n`;
  text += `Állapot: ${result.quality}\n`;
  text += `Javítandó pontok: ${result.issueCount}\n\n`;

  text += "Gyors összefoglaló\n";
  text += "------------------\n";

  result.metrics.forEach((metric) => {
    text += `${metric.label}: ${metric.value}\n`;
  });

  text += "\nLegfontosabb javítások\n";
  text += "----------------------\n";

  if (result.topFixes.length) {
    result.topFixes.forEach((item, index) => {
      text += `${index + 1}. [${item.category}] ${item.name} (${item.score}/100)\n`;
      text += `   ${item.fix}\n\n`;
    });
  } else {
    text += "Nincs sürgős javítás.\n\n";
  }

  Object.values(result.categories).forEach((category) => {
    text += `\n${category.title} – ${category.score}/100\n`;
    text += "-".repeat(category.title.length + 10) + "\n";

    category.checks.forEach((item) => {
      text += `• ${item.name}: ${item.value} — ${item.status} (${item.score}/100)\n`;

      if (item.level !== "good") {
        text += `  Javaslat: ${item.fix}\n`;
      }
    });
  });

  return text;
}

function showAuditResult(ui) {
  [
    ui.scoreCard,
    ui.metrics,
    ui.topFixes,
    ui.categoryTabs,
    ui.categoryPanel,
    ui.actions
  ].forEach((element) => {
    element?.classList.remove("hidden");
  });
}

function hideAuditResult(ui) {
  [
    ui.scoreCard,
    ui.metrics,
    ui.topFixes,
    ui.categoryTabs,
    ui.categoryPanel,
    ui.actions
  ].forEach((element) => {
    element?.classList.add("hidden");
  });
}

function toggleLoading(ui, isLoading) {
  if (!ui.analyzeBtn) return;

  ui.analyzeBtn.disabled = isLoading;
  ui.analyzeBtn.textContent = isLoading ? "Elemzés…" : "Elemzés";
}

function showStatus(ui, message, type = "idle") {
  if (!ui.status) return;

  ui.status.textContent = message;
  ui.status.className = `status ${type}`;
}

function isRestrictedPage(url = "") {
  return /^(chrome|edge|about|chrome-extension|moz-extension|brave|opera):/i.test(url);
}

function toUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isSpecialLink(href = "") {
  return href.startsWith("mailto:") || href.startsWith("tel:");
}

function rateTitle(title) {
  if (!title) return 20;
  if (title.length >= 30 && title.length <= 60) return 100;
  if (title.length >= 15 && title.length <= 75) return 75;

  return 50;
}

function rateDescription(description) {
  if (!description) return 25;
  if (description.length >= 80 && description.length <= 160) return 100;
  if (description.length >= 50 && description.length <= 180) return 75;

  return 55;
}

function rateH1(h1List) {
  if (h1List.length === 1 && h1List[0].length >= 8) return 100;
  if (h1List.length === 1) return 75;
  if (h1List.length === 0) return 25;

  return 50;
}

function rateHeadings(data) {
  if (data.h2.length >= 2 && data.h3.length >= 1) return 100;
  if (data.h2.length >= 1) return 75;

  return 45;
}

function rateWordCount(count) {
  if (count >= 900) return 100;
  if (count >= 500) return 88;
  if (count >= 250) return 68;
  if (count >= 100) return 48;

  return 30;
}

function rateVocabulary(data) {
  if (!data.wordCount) return 35;

  const ratio = data.uniqueWordCount / data.wordCount;

  if (data.wordCount >= 500 && ratio >= 0.35) return 100;
  if (ratio >= 0.28) return 82;
  if (ratio >= 0.18) return 65;

  return 45;
}

function rateSentenceLength(avg) {
  if (!avg) return 45;
  if (avg >= 10 && avg <= 22) return 100;
  if (avg >= 7 && avg <= 28) return 75;

  return 55;
}

function rateUrl(url) {
  const parsed = toUrl(url);

  if (!parsed) return 40;

  const path = parsed.pathname;
  const hasBadCharacters = /[_A-Z\s]|%[0-9A-F]{2}/.test(path);

  if (url.length <= 90 && !hasBadCharacters) return 100;
  if (url.length <= 130) return 75;

  return 55;
}

function rateDomSize(count) {
  if (count <= 800) return 100;
  if (count <= 1500) return 80;
  if (count <= 2500) return 60;

  return 40;
}

function rateResourceCount(count) {
  if (count <= 45) return 100;
  if (count <= 80) return 82;
  if (count <= 130) return 62;

  return 42;
}

function rateTransferSize(kb) {
  if (!kb) return 70;
  if (kb <= 1200) return 100;
  if (kb <= 2500) return 82;
  if (kb <= 5000) return 60;

  return 38;
}

function rateLoadTime(ms) {
  if (!ms) return 70;
  if (ms <= 1500) return 100;
  if (ms <= 3000) return 82;
  if (ms <= 5000) return 62;

  return 40;
}

function rateRatio(part, total, targetRatio) {
  if (!total) return 85;

  const ratio = part / total;

  if (ratio >= targetRatio) return 100;
  if (ratio >= targetRatio / 2) return 75;

  return 55;
}

function rateSocial(data) {
  const og = data.ogCount >= 4 ? 50 : data.ogCount > 0 ? 35 : 15;
  const twitter = data.twitterCount >= 3 ? 50 : data.twitterCount > 0 ? 35 : 15;

  return og + twitter;
}

function rateForms(forms, protocol) {
  if (!forms.length) return 85;
  if (protocol !== "https:") return 30;

  const riskyForms = forms.filter((form) => {
    return form.method.toLowerCase() === "get" && form.inputCount >= 2;
  });

  return riskyForms.length ? 70 : 95;
}

function getHeadingOrderErrors(headings) {
  let errors = 0;
  let previousLevel = 0;

  headings.forEach((heading) => {
    if (previousLevel && heading.level > previousLevel + 1) {
      errors++;
    }

    previousLevel = heading.level;
  });

  return errors;
}

function getDuplicates(items) {
  const seen = new Set();
  const duplicates = new Set();

  items
    .map((item) => item.toLowerCase().trim())
    .filter(Boolean)
    .forEach((item) => {
      if (seen.has(item)) {
        duplicates.add(item);
        return;
      }

      seen.add(item);
    });

  return [...duplicates];
}

function getQualityText(score) {
  if (score >= 92) return "Kiváló";
  if (score >= 82) return "Erős";
  if (score >= 68) return "Javítható";
  if (score >= 48) return "Gyenge";

  return "Kritikus";
}

function getScoreColor(score) {
  if (score >= 82) return "#22c55e";
  if (score >= 68) return "#f59e0b";

  return "#ef4444";
}

function getCategorySummary(category) {
  const critical = category.checks.filter((item) => item.level === "bad").length;
  const warning = category.checks.filter((item) => item.level === "warn").length;

  if (!critical && !warning) {
    return "Ebben a részben nincs sürgős teendő.";
  }

  if (critical && warning) {
    return `${critical} kritikus és ${warning} kisebb javítás található.`;
  }

  if (critical) {
    return `${critical} kritikus pontot érdemes elsőként javítani.`;
  }

  return `${warning} javítandó pont van.`;
}

function average(numbers) {
  if (!numbers.length) return 0;

  const sum = numbers.reduce((total, number) => total + number, 0);
  return Math.round(sum / numbers.length);
}

function weightedAverage(items) {
  const totalWeight = items.reduce((sum, [, weight]) => sum + weight, 0);
  const total = items.reduce((sum, [score, weight]) => sum + score * weight, 0);

  return Math.round(total / totalWeight);
}

function clamp(number, min, max) {
  return Math.min(Math.max(number, min), max);
}

function uniqueBy(items, getKey) {
  const used = new Set();

  return items.filter((item) => {
    const key = getKey(item);

    if (used.has(key)) {
      return false;
    }

    used.add(key);
    return true;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}