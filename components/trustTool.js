const get = (selector) => document.querySelector(selector);

let lastTrustResult = null;
let savedTrustReport = "";

export function initTrustTool() {
  const ui = {
    analyzeBtn: get("#trustAnalyzeBtn"),
    status: get("#trustStatus"),

    scoreCard: get("#trustScoreCard"),
    scoreRing: get("#trustScoreRing"),
    score: get("#trustScore"),

    pageTitle: get("#trustPageTitle"),
    pageUrl: get("#trustPageUrl"),
    qualityBadge: get("#trustQualityBadge"),
    issueCount: get("#trustIssueCount"),

    metrics: get("#trustMetrics"),
    topFixes: get("#trustTopFixes"),
    topFixesList: get("#trustTopFixesList"),

    checks: get("#trustChecks"),
    actions: get("#trustActions"),
    copyBtn: get("#trustCopyBtn")
  };

  ui.analyzeBtn?.addEventListener("click", () => runTrustAudit(ui));

  ui.copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(savedTrustReport || "");
      ui.copyBtn.textContent = "Másolva";

      setTimeout(() => {
        ui.copyBtn.textContent = "Riport másolása";
      }, 1200);
    } catch {
      showStatus(ui, "Nem sikerült másolni a riportot.", "error");
    }
  });
}

async function runTrustAudit(ui) {
  try {
    toggleLoading(ui, true);
    hideTrustResult(ui);

    showStatus(ui, "Oldal elemzése…", "loading");

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id) {
      throw new Error("Nincs aktív böngészőfül.");
    }

    if (isRestrictedPage(tab.url)) {
      throw new Error("Ezt az oldalt a böngésző nem engedi elemezni.");
    }

    const response = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readTrustPageData
    });

    const pageData = response?.[0]?.result;

    if (!pageData) {
      throw new Error("Nem sikerült kiolvasni az oldal adatait.");
    }

    lastTrustResult = createTrustAudit(pageData);
    savedTrustReport = makeTrustTextReport(lastTrustResult);

    drawTrustAudit(ui, lastTrustResult);

    showStatus(ui, "Kész.", "idle");
  } catch (err) {
    showStatus(ui, err?.message || "Ismeretlen hiba történt.", "error");
  } finally {
    toggleLoading(ui, false);
  }
}

async function readTrustPageData() {
  const MAX_DOC_BYTES = 180000;
  const FETCH_TIMEOUT_MS = 4500;

  const meta = (selector) => {
    return document.querySelector(selector)?.getAttribute("content")?.trim() || "";
  };

  const normalizeText = (value) => {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  };

  const bodyText = normalizeText(document.body?.innerText || "");
  const lowerText = bodyText.toLowerCase();

  const visibleText = (element) => {
    return normalizeText(
      element?.innerText ||
      element?.textContent ||
      element?.getAttribute?.("aria-label") ||
      element?.getAttribute?.("title") ||
      ""
    );
  };

  const links = [...document.querySelectorAll("a")].map((link) => ({
    href: link.getAttribute("href") || "",
    absoluteHref: link.href || "",
    text: visibleText(link),
    target: link.getAttribute("target") || "",
    rel: link.getAttribute("rel") || ""
  }));

  const scripts = [...document.scripts].map((script) => ({
    src: script.src || "",
    async: script.async,
    defer: script.defer,
    type: script.type || "",
    inlineLength: script.src ? 0 : normalizeText(script.textContent).length
  }));

  const forms = [...document.querySelectorAll("form")].map((form) => {
    const inputs = [...form.querySelectorAll("input, textarea, select")];

    return {
      action: form.getAttribute("action") || "",
      absoluteAction: form.action || "",
      method: (form.getAttribute("method") || "get").toLowerCase(),
      inputCount: inputs.length,
      passwordInputs: form.querySelectorAll('input[type="password"]').length,
      emailInputs: form.querySelectorAll('input[type="email"]').length,
      telInputs: form.querySelectorAll('input[type="tel"]').length,
      fileInputs: form.querySelectorAll('input[type="file"]').length,
      hiddenInputs: form.querySelectorAll('input[type="hidden"]').length,
      cardInputs: inputs.filter((input) => {
        const haystack = `${input.name || ""} ${input.id || ""} ${input.placeholder || ""}`.toLowerCase();
        return /card|kártya|bankkartya|bankkártya|cvv|cvc|expiry|lejárat/.test(haystack);
      }).length,
      hasAutocompleteOff: inputs.some((input) => input.getAttribute("autocomplete") === "off")
    };
  });

  const images = [...document.images].map((image) => ({
    src: image.currentSrc || image.src || "",
    alt: image.alt || "",
    width: image.naturalWidth || image.width || 0,
    height: image.naturalHeight || image.height || 0
  }));

  const externalLinks = links.filter((link) => {
    try {
      const url = new URL(link.absoluteHref);
      return url.hostname !== location.hostname;
    } catch {
      return false;
    }
  });

  const sameOriginLinks = links.filter((link) => {
    try {
      const url = new URL(link.absoluteHref);
      return url.origin === location.origin;
    } catch {
      return false;
    }
  });

  const privacyCandidates = findDocumentCandidates(links, [
    "adatvéd",
    "adatkez",
    "privacy",
    "gdpr",
    "data-protection",
    "data protection"
  ]);

  const termsCandidates = findDocumentCandidates(links, [
    "ászf",
    "aszf",
    "feltétel",
    "terms",
    "conditions",
    "tos",
    "legal"
  ]);

  const contactCandidates = findDocumentCandidates(links, [
    "kapcsolat",
    "contact",
    "support",
    "ügyfélszolg",
    "customer-service"
  ]);

  const impressumCandidates = findDocumentCandidates(links, [
    "impresszum",
    "impressum",
    "imprint",
    "company",
    "ceg",
    "cég"
  ]);

  const privacyDocs = await fetchCandidateDocuments(
    privacyCandidates,
    MAX_DOC_BYTES,
    FETCH_TIMEOUT_MS
  );

  const termsDocs = await fetchCandidateDocuments(
    termsCandidates,
    MAX_DOC_BYTES,
    FETCH_TIMEOUT_MS
  );

  const contactDocs = await fetchCandidateDocuments(
    contactCandidates,
    MAX_DOC_BYTES,
    FETCH_TIMEOUT_MS
  );

  const impressumDocs = await fetchCandidateDocuments(
    impressumCandidates,
    MAX_DOC_BYTES,
    FETCH_TIMEOUT_MS
  );

  const suspiciousWords = [
    "nyeremény",
    "azonnal fizess",
    "utolsó esély",
    "garantált pénz",
    "gyors meggazdagodás",
    "100% biztos",
    "ingyen iphone",
    "bankkártya adatok",
    "crypto duplázás",
    "limited offer",
    "act now",
    "winner",
    "guaranteed money",
    "free iphone",
    "verify your account",
    "urgent action required",
    "claim now",
    "risk free",
    "no risk",
    "duplázd meg",
    "csak ma",
    "ne maradj le",
    "ajándékutalvány",
    "nyertél",
    "fiókod zárolva",
    "account suspended",
    "confirm your identity",
    "payment failed",
    "exclusive deal"
  ];

  const foundSuspiciousWords = suspiciousWords.filter((word) => {
    return lowerText.includes(word.toLowerCase());
  });

  return {
    title: document.title || "",
    url: location.href,
    host: location.hostname,
    origin: location.origin,
    protocol: location.protocol,

    description: meta('meta[name="description"]'),
    robots: meta('meta[name="robots"]'),
    author: meta('meta[name="author"]'),
    canonical: document.querySelector('link[rel="canonical"]')?.href || "",

    wordCount: bodyText ? bodyText.split(" ").filter(Boolean).length : 0,
    textLength: bodyText.length,

    mainTextSample: bodyText.slice(0, 3500),

    hasContactKeyword:
      lowerText.includes("kapcsolat") ||
      lowerText.includes("contact") ||
      lowerText.includes("ügyfélszolgálat") ||
      lowerText.includes("support"),

    hasAboutKeyword:
      lowerText.includes("rólunk") ||
      lowerText.includes("about us") ||
      lowerText.includes("about"),

    hasPrivacyKeyword:
      lowerText.includes("adatvédelmi") ||
      lowerText.includes("adatkezelési") ||
      lowerText.includes("privacy policy") ||
      lowerText.includes("privacy") ||
      lowerText.includes("gdpr"),

    hasTermsKeyword:
      lowerText.includes("ászf") ||
      lowerText.includes("aszf") ||
      lowerText.includes("terms") ||
      lowerText.includes("feltételek"),

    hasImpressumKeyword:
      lowerText.includes("impresszum") ||
      lowerText.includes("imprint") ||
      lowerText.includes("impressum"),

    hasCookieKeyword: lowerText.includes("cookie") || lowerText.includes("süti"),

    links,
    sameOriginLinks,
    externalLinks,
    scripts,
    forms,
    images,

    privacyCandidates,
    termsCandidates,
    contactCandidates,
    impressumCandidates,

    privacyDocs,
    termsDocs,
    contactDocs,
    impressumDocs,

    linkCount: links.length,
    externalLinkCount: externalLinks.length,
    sameOriginLinkCount: sameOriginLinks.length,

    scriptCount: scripts.length,
    externalScriptCount: scripts.filter((script) => script.src).length,
    inlineScriptCount: scripts.filter((script) => !script.src && script.inlineLength > 0).length,

    imageCount: images.length,
    imagesWithoutAlt: images.filter((image) => !image.alt).length,

    suspiciousWords: foundSuspiciousWords
  };

  function findDocumentCandidates(allLinks, keywords) {
    const scored = allLinks
      .map((link) => {
        const haystack = `${link.text} ${link.href} ${link.absoluteHref}`.toLowerCase();

        let score = 0;

        keywords.forEach((keyword) => {
          if (haystack.includes(keyword.toLowerCase())) score += 20;
        });

        if (link.absoluteHref) score += 3;
        if (link.text.length >= 3) score += 2;

        try {
          const url = new URL(link.absoluteHref);
          if (url.origin === location.origin) score += 8;
          if (url.protocol === "https:") score += 4;
          if (url.pathname.length <= 80) score += 2;
        } catch {
          score -= 10;
        }

        return {
          ...link,
          candidateScore: score
        };
      })
      .filter((link) => link.candidateScore >= 20)
      .sort((a, b) => b.candidateScore - a.candidateScore);

    const unique = [];
    const seen = new Set();

    scored.forEach((link) => {
      const key = normalizeCandidateUrl(link.absoluteHref);
      if (!key || seen.has(key)) return;

      seen.add(key);
      unique.push(link);
    });

    return unique.slice(0, 5);
  }

  function normalizeCandidateUrl(value) {
    try {
      const url = new URL(value);
      url.hash = "";
      return url.href;
    } catch {
      return "";
    }
  }

  async function fetchCandidateDocuments(candidates, maxBytes, timeoutMs) {
    const docs = [];

    for (const candidate of candidates.slice(0, 3)) {
      try {
        const url = new URL(candidate.absoluteHref);

        if (!["http:", "https:"].includes(url.protocol)) continue;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url.href, {
          method: "GET",
          credentials: "include",
          signal: controller.signal
        });

        clearTimeout(timeout);

        const contentType = response.headers.get("content-type") || "";

        if (!response.ok) {
          docs.push({
            url: url.href,
            linkText: candidate.text,
            ok: false,
            status: response.status,
            contentType,
            wordCount: 0,
            text: "",
            error: `HTTP ${response.status}`
          });
          continue;
        }

        if (
          !contentType.includes("text/html") &&
          !contentType.includes("text/plain") &&
          !contentType.includes("application/xhtml")
        ) {
          docs.push({
            url: url.href,
            linkText: candidate.text,
            ok: false,
            status: response.status,
            contentType,
            wordCount: 0,
            text: "",
            error: "Nem szöveges dokumentum."
          });
          continue;
        }

        const raw = await response.text();
        const clipped = raw.slice(0, maxBytes);
        const parsedText = htmlToText(clipped);

        docs.push({
          url: url.href,
          linkText: candidate.text,
          ok: true,
          status: response.status,
          contentType,
          wordCount: parsedText ? parsedText.split(" ").filter(Boolean).length : 0,
          text: parsedText.slice(0, 22000),
          error: ""
        });
      } catch (err) {
        docs.push({
          url: candidate.absoluteHref,
          linkText: candidate.text,
          ok: false,
          status: 0,
          contentType: "",
          wordCount: 0,
          text: "",
          error: err?.name === "AbortError" ? "Időtúllépés" : "Nem olvasható be"
        });
      }
    }

    return docs;
  }

  function htmlToText(html) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      doc.querySelectorAll("script, style, noscript, svg").forEach((node) => {
        node.remove();
      });

      return normalizeText(doc.body?.innerText || doc.documentElement?.innerText || "");
    } catch {
      return normalizeText(html.replace(/<[^>]+>/g, " "));
    }
  }
}

function createTrustAudit(data) {
  const parsed = toUrl(data.url);
  const host = parsed?.hostname || data.host || "";
  const hostParts = host.split(".").filter(Boolean);

  const subdomainCount = Math.max(hostParts.length - 2, 0);
  const hasIpHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const hasManyHyphens = (host.match(/-/g) || []).length >= 3;
  const hasWeirdTld = /\.(xyz|top|click|loan|work|party|gq|tk|ml|cf|zip|mov)$/i.test(host);
  const hasPunycode = host.includes("xn--");
  const hasVeryLongHost = host.length > 45;

  const hasBrandBait =
    /(paypal|google|facebook|apple|microsoft|netflix|bank|otp|revolut|binance|steam|instagram|tiktok)/i.test(host) &&
    !/(paypal\.com|google\.com|facebook\.com|apple\.com|microsoft\.com|netflix\.com|otpbank\.hu|revolut\.com|binance\.com|steampowered\.com|instagram\.com|tiktok\.com)$/i.test(host);

  const unsafeBlankLinks = data.links.filter((link) => {
    const rel = String(link.rel || "").toLowerCase();
    return link.target === "_blank" && (!rel.includes("noopener") || !rel.includes("noreferrer"));
  });

  const emptyLinks = data.links.filter((link) => {
    const href = String(link.href || "").trim().toLowerCase();
    return !href || href === "#" || href.startsWith("javascript:");
  });

  const passwordForms = data.forms.filter((form) => form.passwordInputs > 0);

  const personalDataForms = data.forms.filter((form) => {
    return (
      form.passwordInputs > 0 ||
      form.emailInputs > 0 ||
      form.telInputs > 0 ||
      form.fileInputs > 0 ||
      form.cardInputs > 0 ||
      form.inputCount >= 4
    );
  });

  const riskyForms = data.forms.filter((form) => {
    return (
      data.protocol !== "https:" &&
      (form.passwordInputs > 0 || form.emailInputs > 0 || form.cardInputs > 0 || form.inputCount >= 2)
    );
  });

  const getForms = data.forms.filter((form) => {
    return (
      form.method === "get" &&
      (form.passwordInputs > 0 || form.emailInputs > 0 || form.telInputs > 0 || form.cardInputs > 0)
    );
  });

  const cardForms = data.forms.filter((form) => form.cardInputs > 0);

  const largeInlineScripts = data.scripts.filter((script) => {
    return !script.src && script.inlineLength > 6000;
  });

  const externalScriptHosts = uniqueHosts(
    data.scripts.map((script) => script.src).filter(Boolean)
  );

  const externalLinkHosts = uniqueHosts(
    data.externalLinks.map((link) => link.absoluteHref).filter(Boolean)
  );

  const privacyAnalysis = analyzePrivacyDocs(data);

  const termsAnalysis = analyzeGenericLegalDocs(data.termsDocs, {
    name: "ÁSZF / feltételek",
    keywords: [
      "általános szerződési feltételek",
      "ászf",
      "aszf",
      "terms",
      "conditions",
      "szolgáltatás",
      "felelősség",
      "elállás",
      "fizetés",
      "panasz",
      "refund",
      "delivery",
      "warranty"
    ],
    minimumWords: 250
  });

  const contactAnalysis = analyzeContactPresence(data);
  const companyAnalysis = analyzeCompanyPresence(data);

  const checks = [
    makeTrustCheck({
      name: "HTTPS kapcsolat",
      value: "Nem HTTPS kapcsolat.",
      score: data.protocol === "https:" ? 100 : 10,
      detail: data.protocol === "https:" ? "" : "Az oldal nem titkosított kapcsolaton fut."
    }),

    makeTrustCheck({
      name: "Domain forma",
      value: host,
      score: rateDomainShape({
        hasIpHost,
        hasManyHyphens,
        hasWeirdTld,
        hasPunycode,
        hasVeryLongHost,
        subdomainCount
      }),
      detail: [
        hasIpHost ? "IP-cím alapú domain." : "",
        hasManyHyphens ? "Szokatlanul sok kötőjel." : "",
        hasWeirdTld ? "Gyanús TLD." : "",
        hasPunycode ? "Punycode domain." : "",
        hasVeryLongHost ? "Szokatlanul hosszú domain." : "",
        subdomainCount >= 2 ? "Sok aldomain." : ""
      ].filter(Boolean).join(" ")
    }),

    makeTrustCheck({
      name: "Márkanév utánzás",
      value: "Lehetséges márkanév-utánzás.",
      score: hasBrandBait ? 15 : 100,
      detail: hasBrandBait
        ? "A domain ismert márkanevet tartalmaz, de nem hivatalos domainnek tűnik."
        : ""
    }),

    makeTrustCheck({
      name: "Adatvédelmi tájékoztató",
      value: privacyAnalysis.value,
      score: privacyAnalysis.score,
      detail: privacyAnalysis.detail,
      evidence: privacyAnalysis.evidence
    }),

    makeTrustCheck({
      name: "ÁSZF / feltételek",
      value: termsAnalysis.value,
      score: termsAnalysis.score,
      detail: termsAnalysis.detail,
      evidence: termsAnalysis.evidence
    }),

    makeTrustCheck({
      name: "Kapcsolati adatok",
      value: contactAnalysis.value,
      score: contactAnalysis.score,
      detail: contactAnalysis.detail,
      evidence: contactAnalysis.evidence
    }),

    makeTrustCheck({
      name: "Cég / üzemeltető",
      value: companyAnalysis.value,
      score: companyAnalysis.score,
      detail: companyAnalysis.detail,
      evidence: companyAnalysis.evidence
    }),

    makeTrustCheck({
      name: "Cookie tájékoztatás",
      value: "Nem látszik cookie tájékoztatás.",
      score: data.hasCookieKeyword ? 78 : 58,
      detail: !data.hasCookieKeyword && data.externalScriptCount > 0
        ? `${data.externalScriptCount} külső script van, de cookie tájékoztatás nem látszik.`
        : ""
    }),

    makeTrustCheck({
      name: "Gyanús marketing / scam szöveg",
      value: `${data.suspiciousWords.length} gyanús kifejezés.`,
      score: data.suspiciousWords.length
        ? Math.max(12, 92 - data.suspiciousWords.length * 17)
        : 96,
      detail: data.suspiciousWords.length
        ? `Talált kifejezések: ${data.suspiciousWords.join(", ")}.`
        : ""
    }),

    makeTrustCheck({
      name: "Űrlapok adatbiztonsága",
      value: riskyForms.length
        ? `${riskyForms.length} kockázatos űrlap.`
        : getForms.length
          ? `${getForms.length} GET metódusú személyes adatot kérő űrlap.`
          : cardForms.length
            ? `${cardForms.length} bankkártyaadatot kérő űrlap.`
            : personalDataForms.length
              ? `${personalDataForms.length} személyes adatot kérő űrlap.`
              : "",
      score: riskyForms.length ? 18 : getForms.length ? 48 : cardForms.length ? 65 : personalDataForms.length ? 78 : 94,
      detail: [
        passwordForms.length ? `${passwordForms.length} jelszavas űrlap.` : "",
        cardForms.length ? `${cardForms.length} kártyaadatos űrlap.` : "",
        getForms.length ? `${getForms.length} GET metódusú érzékeny űrlap.` : "",
        riskyForms.length ? "Nem HTTPS oldalon személyes adatot kér." : ""
      ].filter(Boolean).join(" ")
    }),

    makeTrustCheck({
      name: "Külső scriptek",
      value: `${data.externalScriptCount} külső script, ${externalScriptHosts.length} domain.`,
      score: rateExternalScripts(data.externalScriptCount, externalScriptHosts.length),
      detail: externalScriptHosts.slice(0, 8).join(", ")
    }),

    makeTrustCheck({
      name: "Nagy inline script",
      value: `${largeInlineScripts.length} nagy inline script.`,
      score: largeInlineScripts.length ? 62 : 94,
      detail: largeInlineScripts.length
        ? "Legalább egy 6000 karakternél hosszabb inline script van."
        : ""
    }),

    makeTrustCheck({
      name: "Külső linkek aránya",
      value: `${data.externalLinkCount} külső link / ${data.linkCount} összes link.`,
      score: rateExternalLinks(data.externalLinkCount, data.linkCount),
      detail: externalLinkHosts.slice(0, 10).join(", ")
    }),

    makeTrustCheck({
      name: "Üres vagy javascript linkek",
      value: `${emptyLinks.length} hibás link.`,
      score: emptyLinks.length ? Math.max(45, 90 - emptyLinks.length * 4) : 96,
      detail: emptyLinks.length
        ? "Href nélküli, # vagy javascript: link található."
        : ""
    }),

    makeTrustCheck({
      name: "Új ablak védelem",
      value: `${unsafeBlankLinks.length} hibás új ablakos link.`,
      score: unsafeBlankLinks.length ? Math.max(45, 95 - unsafeBlankLinks.length * 5) : 96,
      detail: unsafeBlankLinks.length
        ? 'target="_blank" link van noopener/noreferrer nélkül.'
        : ""
    }),

    makeTrustCheck({
      name: "Tartalom mennyisége",
      value: `${data.wordCount} szó.`,
      score: rateContentAmount(data.wordCount),
      detail: data.wordCount < 160
        ? "Kevés látható szöveg van az oldalon."
        : ""
    }),

    makeTrustCheck({
      name: "Képek alt szövege",
      value: `${data.imagesWithoutAlt} kép alt nélkül / ${data.imageCount} kép.`,
      score: rateImageAlt(data.imagesWithoutAlt, data.imageCount),
      detail: data.imageCount && data.imagesWithoutAlt / data.imageCount > 0.35
        ? "Sok képnél hiányzik az alt szöveg."
        : ""
    })
  ];

  const score = weightedAverage([
    [getCheckScore(checks, "HTTPS kapcsolat"), 1.55],
    [getCheckScore(checks, "Domain forma"), 1.35],
    [getCheckScore(checks, "Márkanév utánzás"), 1.55],
    [getCheckScore(checks, "Adatvédelmi tájékoztató"), 1.45],
    [getCheckScore(checks, "ÁSZF / feltételek"), 1.05],
    [getCheckScore(checks, "Kapcsolati adatok"), 1.15],
    [getCheckScore(checks, "Cég / üzemeltető"), 1.35],
    [getCheckScore(checks, "Cookie tájékoztatás"), 0.45],
    [getCheckScore(checks, "Gyanús marketing / scam szöveg"), 1.35],
    [getCheckScore(checks, "Űrlapok adatbiztonsága"), 1.45],
    [getCheckScore(checks, "Külső scriptek"), 0.75],
    [getCheckScore(checks, "Nagy inline script"), 0.4],
    [getCheckScore(checks, "Külső linkek aránya"), 0.65],
    [getCheckScore(checks, "Üres vagy javascript linkek"), 0.45],
    [getCheckScore(checks, "Új ablak védelem"), 0.35],
    [getCheckScore(checks, "Tartalom mennyisége"), 0.45],
    [getCheckScore(checks, "Képek alt szövege"), 0.2]
  ]);

  const problems = checks.filter((item) => item.level !== "good");
  const severeProblems = checks.filter((item) => item.level === "bad");

  return {
    title: data.title || "Cím nélküli oldal",
    url: data.url,
    host,
    score,
    quality: getTrustQualityText(score),
    issueCount: problems.length,
    severeIssueCount: severeProblems.length,
    checks,
    problems,
    metrics: {
      words: data.wordCount,
      links: data.linkCount,
      externalLinks: data.externalLinkCount,
      scripts: data.scriptCount,
      externalScripts: data.externalScriptCount,
      forms: data.forms.length,
      privacyDocsChecked: data.privacyDocs.length,
      termsDocsChecked: data.termsDocs.length
    }
  };
}

function analyzePrivacyDocs(data) {
  const docs = data.privacyDocs || [];
  const bestDoc = docs
    .filter((doc) => doc.ok && doc.text)
    .sort((a, b) => scorePrivacyText(b.text).score - scorePrivacyText(a.text).score)[0];

  if (!data.privacyCandidates?.length && !data.hasPrivacyKeyword) {
    return {
      value: "Nem található adatvédelmi tájékoztató.",
      score: data.forms.length ? 20 : 38,
      detail: "Nincs adatvédelmi link vagy erős adatvédelmi jelzés.",
      evidence: []
    };
  }

  if (!bestDoc) {
    const failed = docs.filter((doc) => !doc.ok);

    return {
      value: data.privacyCandidates?.length
        ? "Van adatvédelmi link, de nem ellenőrizhető."
        : "Csak adatvédelmi kulcsszó látszik.",
      score: data.privacyCandidates?.length ? 48 : 35,
      detail: failed.length
        ? `Nem sikerült beolvasni: ${failed.map((doc) => doc.error).join(", ")}.`
        : "Külön adatvédelmi dokumentum nem bizonyított.",
      evidence: data.privacyCandidates?.slice(0, 3).map((item) => item.absoluteHref) || []
    };
  }

  const result = scorePrivacyText(bestDoc.text);

  let score = result.score;

  if (bestDoc.wordCount < 180) score -= 20;
  if (bestDoc.wordCount < 80) score -= 25;

  score = clamp(score, 10, 100);

  return {
    value: `${result.label} ${bestDoc.wordCount} szó.`,
    score,
    detail: result.detail,
    evidence: [
      bestDoc.url,
      ...result.found.map((item) => `Megvan: ${item}`)
    ].slice(0, 8)
  };
}

function scorePrivacyText(text) {
  const lower = String(text || "").toLowerCase();

  const checks = [
    {
      label: "adatkezelő neve",
      weight: 14,
      patterns: ["adatkezelő", "data controller", "controller"]
    },
    {
      label: "kapcsolat / e-mail",
      weight: 12,
      patterns: ["@", "e-mail", "email", "kapcsolat", "contact"]
    },
    {
      label: "adatkezelés célja",
      weight: 13,
      patterns: ["adatkezelés célja", "purpose", "célból", "felhasználás célja"]
    },
    {
      label: "jogalap",
      weight: 13,
      patterns: ["jogalap", "legal basis", "hozzájárulás", "szerződés teljesítése", "jogos érdek"]
    },
    {
      label: "kezelt adatok köre",
      weight: 11,
      patterns: ["kezelt adatok", "personal data", "személyes adat", "adatok köre"]
    },
    {
      label: "megőrzési idő",
      weight: 11,
      patterns: ["megőrzési idő", "retention", "tárolási idő", "meddig"]
    },
    {
      label: "érintetti jogok",
      weight: 14,
      patterns: ["hozzáférés", "helyesbítés", "törlés", "tiltakozás", "adathordozhatóság", "rights"]
    },
    {
      label: "panasz / hatóság",
      weight: 8,
      patterns: ["naih", "hatóság", "complaint", "supervisory authority"]
    },
    {
      label: "adattovábbítás / feldolgozó",
      weight: 8,
      patterns: ["adatfeldolgozó", "processor", "third party", "harmadik fél", "adattovábbítás"]
    },
    {
      label: "cookie / követés",
      weight: 6,
      patterns: ["cookie", "süti", "tracking", "analytics"]
    }
  ];

  const found = [];
  let score = 0;

  checks.forEach((item) => {
    const has = item.patterns.some((pattern) => lower.includes(pattern));
    if (has) {
      score += item.weight;
      found.push(item.label);
    }
  });

  if (lower.length < 800) score -= 18;
  if (lower.includes("lorem ipsum")) score -= 35;
  if (lower.includes("coming soon")) score -= 25;

  const finalScore = clamp(score, 5, 100);

  if (finalScore >= 85) {
    return {
      score: finalScore,
      label: "Részletes adatvédelmi tájékoztatónak tűnik.",
      detail: "",
      found
    };
  }

  if (finalScore >= 62) {
    return {
      score: finalScore,
      label: "Részben megfelelő adatvédelmi oldal.",
      detail: `Hiányos vagy nem teljes. Talált elemek: ${found.join(", ") || "nincs"}.`,
      found
    };
  }

  if (finalScore >= 38) {
    return {
      score: finalScore,
      label: "Gyenge vagy hiányos adatvédelmi oldal.",
      detail: `Kevés fontos elem látszik. Talált elemek: ${found.join(", ") || "nincs"}.`,
      found
    };
  }

  return {
    score: finalScore,
    label: "Nem tűnik valódi adatvédelmi tájékoztatónak.",
    detail: `Nagyon kevés adatvédelmi elem látszik. Talált elemek: ${found.join(", ") || "nincs"}.`,
    found
  };
}

function analyzeGenericLegalDocs(docs, options) {
  const okDocs = (docs || []).filter((doc) => doc.ok && doc.text);

  if (!okDocs.length) {
    return {
      value: "Nem ellenőrizhető vagy nem található.",
      score: 45,
      detail: "Nem sikerült tartalmilag ellenőrizhető dokumentumot találni.",
      evidence: []
    };
  }

  const best = okDocs
    .map((doc) => {
      const lower = doc.text.toLowerCase();
      const hits = options.keywords.filter((keyword) => {
        return lower.includes(keyword.toLowerCase());
      });

      let score = 45 + hits.length * 8;

      if (doc.wordCount >= options.minimumWords) score += 15;
      if (doc.wordCount < 120) score -= 20;

      return {
        doc,
        hits,
        score: clamp(score, 10, 100)
      };
    })
    .sort((a, b) => b.score - a.score)[0];

  return {
    value: best.score >= 75
      ? `Részletesnek tűnik. ${best.doc.wordCount} szó.`
      : `Hiányosnak tűnik. ${best.doc.wordCount} szó.`,
    score: best.score,
    detail: best.score >= 75
      ? ""
      : best.hits.length
        ? `Talált elemek: ${best.hits.join(", ")}.`
        : "Kevés releváns jogi kifejezést találtam.",
    evidence: [best.doc.url]
  };
}

function analyzeContactPresence(data) {
  const text = `${data.mainTextSample || ""} ${(data.contactDocs || []).map((doc) => doc.text).join(" ")}`;
  const lower = text.toLowerCase();

  const email = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text);
  const phone = /(\+?\d{1,3}[\s.-]?)?(\(?\d{1,4}\)?[\s.-]?)?\d{3}[\s.-]?\d{3,}/.test(text);
  const address = /(utca|út|tér|krt|körút|street|road|avenue|postcode|irányítószám|székhely)/i.test(text);
  const form = data.forms.length > 0 && data.hasContactKeyword;

  let score = 35;

  if (data.contactCandidates?.length) score += 15;
  if (email) score += 20;
  if (phone) score += 14;
  if (address) score += 16;
  if (form) score += 10;

  score = clamp(score, 20, 100);

  return {
    value: score >= 80
      ? "Konkrét kapcsolat látszik."
      : score >= 60
        ? "Részleges kapcsolat látszik."
        : "Gyenge kapcsolati háttér.",
    score,
    detail: score >= 80
      ? ""
      : [
          email ? "E-mail van." : "E-mail nem látszik.",
          phone ? "Telefonszám van." : "Telefonszám nem látszik.",
          address ? "Cím/székhely van." : "Cím/székhely nem látszik.",
          form ? "Kapcsolati űrlap van." : "",
          lower.includes("support") || lower.includes("ügyfélszolgálat") ? "Support/ügyfélszolgálat említve." : ""
        ].filter(Boolean).join(" "),
    evidence: [
      ...(data.contactCandidates || []).slice(0, 2).map((item) => item.absoluteHref)
    ]
  };
}

function analyzeCompanyPresence(data) {
  const text = [
    data.mainTextSample || "",
    ...(data.impressumDocs || []).map((doc) => doc.text),
    ...(data.privacyDocs || []).map((doc) => doc.text)
  ].join(" ");

  const hasCompanyName = /(kft\.|zrt\.|bt\.|nyrt\.|ltd\.|llc|inc\.|gmbh|company|vállalkozó|egyéni vállalkozó)/i.test(text);
  const hasTaxNumber = /(adószám|tax number|vat|vat id|eu tax|cégjegyzékszám|company registration)/i.test(text);
  const hasAddress = /(székhely|telephely|utca|út|tér|körút|street|road|avenue|registered office)/i.test(text);
  const hasImpressumDoc = (data.impressumDocs || []).some((doc) => doc.ok && doc.wordCount > 60);

  let score = 30;

  if (data.hasImpressumKeyword || data.impressumCandidates?.length) score += 15;
  if (hasImpressumDoc) score += 18;
  if (hasCompanyName) score += 18;
  if (hasTaxNumber) score += 14;
  if (hasAddress) score += 14;

  score = clamp(score, 15, 100);

  return {
    value: score >= 80
      ? "Az üzemeltető jól azonosíthatónak tűnik."
      : score >= 60
        ? "Részben azonosítható üzemeltető."
        : "Nem egyértelmű az üzemeltető.",
    score,
    detail: score >= 80
      ? ""
      : [
          hasCompanyName ? "Cégnév látszik." : "Cégnév nem látszik.",
          hasTaxNumber ? "Adószám/cégjegyzékszám látszik." : "Adószám/cégjegyzékszám nem látszik.",
          hasAddress ? "Cím/székhely látszik." : "Cím/székhely nem látszik.",
          hasImpressumDoc ? "Impresszum beolvasható." : "Impresszum nem bizonyított."
        ].filter(Boolean).join(" "),
    evidence: [
      ...(data.impressumCandidates || []).slice(0, 2).map((item) => item.absoluteHref)
    ]
  };
}

function makeTrustCheck({ name, value, score, detail = "", evidence = [] }) {
  const finalScore = clamp(Math.round(score), 0, 100);

  let level = "good";
  let status = "Rendben";

  if (finalScore < 50) {
    level = "bad";
    status = "Súlyos";
  } else if (finalScore < 70) {
    level = "medium";
    status = "Közepes";
  } else if (finalScore < 80) {
    level = "low";
    status = "Enyhe";
  }

  return {
    name,
    value,
    score: finalScore,
    detail,
    evidence,
    level,
    status
  };
}

function drawTrustAudit(ui, result) {
  if (ui.score) ui.score.textContent = result.score;

  if (ui.scoreRing) {
    ui.scoreRing.style.setProperty("--angle", `${result.score * 3.6}deg`);
    ui.scoreRing.style.setProperty("--ring-color", getScoreColor(result.score));
  }

  if (ui.pageTitle) ui.pageTitle.textContent = result.title;
  if (ui.pageUrl) ui.pageUrl.textContent = result.url;

  if (ui.qualityBadge) {
    ui.qualityBadge.textContent = result.quality;
    ui.qualityBadge.className = `quality-badge ${getScoreLevel(result.score)}`;
  }

  if (ui.issueCount) {
    ui.issueCount.textContent = `${result.issueCount} probléma · ${result.severeIssueCount} súlyos`;
  }

  drawTrustMetrics(ui, result);
  drawTrustProblemsBySeverity(ui, result.checks);

  if (ui.topFixes) ui.topFixes.classList.add("hidden");

  showTrustResult(ui);
}

function drawTrustMetrics(ui, result) {
  if (!ui.metrics) return;

  const metrics = [
    ["Pontszám", `${result.score}/100`],
    ["Probléma", result.issueCount],
    ["Súlyos", result.severeIssueCount]
  ];

  ui.metrics.innerHTML = metrics
    .map(([label, value]) => {
      return `
        <article class="trust-metric">
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(label)}</span>
        </article>
      `;
    })
    .join("");

  ui.metrics.classList.remove("hidden");
}

function drawTrustProblemsBySeverity(ui, checks) {
  if (!ui.checks) return;

  const groups = [
    {
      title: "Súlyos problémák",
      items: checks.filter((item) => item.level === "bad")
    },
    {
      title: "Közepes problémák",
      items: checks.filter((item) => item.level === "medium")
    },
    {
      title: "Enyhe problémák",
      items: checks.filter((item) => item.level === "low")
    }
  ];

  const visibleGroups = groups.filter((group) => group.items.length);

  if (!visibleGroups.length) {
    ui.checks.innerHTML = "";
    ui.checks.classList.add("hidden");
    return;
  }

  ui.checks.innerHTML = visibleGroups
    .map((group) => {
      return `
        <section class="problem-group">
          <h3>${escapeHtml(group.title)}</h3>

          ${group.items
            .map((item) => {
              return `
                <article class="check-card ${escapeHtml(item.level)}">
                  <div class="check-top">
                    <div class="check-name">${escapeHtml(item.name)}</div>
                    <span class="badge ${escapeHtml(item.level)}">
                      ${escapeHtml(item.score)}/100
                    </span>
                  </div>

                  ${item.value ? `<div class="check-value">${escapeHtml(item.value)}</div>` : ""}
                  ${item.detail ? `<p class="check-detail">${escapeHtml(item.detail)}</p>` : ""}

                  ${item.evidence?.length
                    ? `
                      <details class="check-evidence">
                        <summary>Bizonyíték</summary>
                        <ul>
                          ${item.evidence
                            .map((evidence) => `<li>${escapeHtml(evidence)}</li>`)
                            .join("")}
                        </ul>
                      </details>
                    `
                    : ""}
                </article>
              `;
            })
            .join("")}
        </section>
      `;
    })
    .join("");

  ui.checks.classList.remove("hidden");
}

function makeTrustTextReport(result) {
  let text = "";

  text += "Weboldal megbízhatósági riport\n";
  text += "==============================\n\n";

  text += `Oldal: ${result.title}\n`;
  text += `URL: ${result.url}\n`;
  text += `Domain: ${result.host}\n`;
  text += `Pontszám: ${result.score}/100\n`;
  text += `Állapot: ${result.quality}\n`;
  text += `Problémák: ${result.issueCount}\n`;
  text += `Súlyos problémák: ${result.severeIssueCount}\n\n`;

  const groups = [
    {
      title: "Súlyos problémák",
      items: result.checks.filter((item) => item.level === "bad")
    },
    {
      title: "Közepes problémák",
      items: result.checks.filter((item) => item.level === "medium")
    },
    {
      title: "Enyhe problémák",
      items: result.checks.filter((item) => item.level === "low")
    }
  ];

  groups.forEach((group) => {
    if (!group.items.length) return;

    text += `${group.title}\n`;
    text += "----------------------\n";

    group.items.forEach((item, index) => {
      text += `${index + 1}. ${item.name}: ${item.score}/100\n`;

      if (item.value) {
        text += `   ${item.value}\n`;
      }

      if (item.detail) {
        text += `   ${item.detail}\n`;
      }

      if (item.evidence?.length) {
        text += "   Bizonyíték:\n";
        item.evidence.forEach((evidence) => {
          text += `   - ${evidence}\n`;
        });
      }

      text += "\n";
    });
  });

  return text.trim();
}

function showTrustResult(ui) {
  [
    ui.scoreCard,
    ui.metrics,
    ui.checks,
    ui.actions
  ].forEach((element) => {
    element?.classList.remove("hidden");
  });

  ui.topFixes?.classList.add("hidden");
}

function hideTrustResult(ui) {
  [
    ui.scoreCard,
    ui.metrics,
    ui.topFixes,
    ui.checks,
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

function rateDomainShape({
  hasIpHost,
  hasManyHyphens,
  hasWeirdTld,
  hasPunycode,
  hasVeryLongHost,
  subdomainCount
}) {
  let score = 100;

  if (hasIpHost) score -= 45;
  if (hasManyHyphens) score -= 20;
  if (hasWeirdTld) score -= 18;
  if (hasPunycode) score -= 18;
  if (hasVeryLongHost) score -= 12;

  if (subdomainCount >= 4) score -= 30;
  else if (subdomainCount >= 3) score -= 22;
  else if (subdomainCount >= 2) score -= 10;

  return clamp(score, 15, 100);
}

function rateExternalScripts(count, hostCount) {
  let score = 96;

  if (count > 8) score -= 10;
  if (count > 18) score -= 16;
  if (count > 35) score -= 22;

  if (hostCount > 5) score -= 8;
  if (hostCount > 10) score -= 12;

  return clamp(score, 30, 100);
}

function rateExternalLinks(external, total) {
  if (!total) return 85;

  const ratio = external / total;

  if (external <= 10 && ratio <= 0.45) return 95;
  if (external <= 25 && ratio <= 0.65) return 78;
  if (external <= 50) return 62;

  return 42;
}

function rateContentAmount(words) {
  if (words >= 700) return 96;
  if (words >= 350) return 88;
  if (words >= 160) return 72;
  if (words >= 60) return 55;

  return 35;
}

function rateImageAlt(missing, total) {
  if (!total) return 90;

  const ratio = missing / total;

  if (ratio <= 0.1) return 95;
  if (ratio <= 0.35) return 82;
  if (ratio <= 0.65) return 68;

  return 52;
}

function getCheckScore(checks, name) {
  return checks.find((item) => item.name === name)?.score || 0;
}

function getTrustQualityText(score) {
  if (score >= 90) return "Megbízhatónak tűnik";
  if (score >= 76) return "Alapvetően rendben";
  if (score >= 60) return "Óvatosan kezeld";
  if (score >= 40) return "Kockázatos";

  return "Nagyon gyanús";
}

function getScoreLevel(score) {
  if (score >= 76) return "good";
  if (score >= 60) return "warn";
  return "bad";
}

function getScoreColor(score) {
  if (score >= 76) return "#22c55e";
  if (score >= 60) return "#f59e0b";
  return "#ef4444";
}

function weightedAverage(items) {
  const valid = items.filter(([score, weight]) => {
    return Number.isFinite(score) && Number.isFinite(weight) && weight > 0;
  });

  const totalWeight = valid.reduce((sum, [, weight]) => sum + weight, 0);
  const total = valid.reduce((sum, [score, weight]) => sum + score * weight, 0);

  return Math.round(total / totalWeight);
}

function uniqueHosts(urls) {
  const hosts = new Set();

  urls.forEach((value) => {
    try {
      const url = new URL(value);
      hosts.add(url.hostname);
    } catch {
      // ignore
    }
  });

  return [...hosts];
}

function clamp(number, min, max) {
  return Math.min(Math.max(number, min), max);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}