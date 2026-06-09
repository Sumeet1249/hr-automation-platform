const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

/** Well-known LinkedIn company slugs (lowercase query → slug) */
const KNOWN_COMPANY_SLUGS = {
  infosys: "infosys",
  amazon: "amazon",
  "amazon india": "amazon",
  tcs: "tata-consultancy-services",
  "tata consultancy services": "tata-consultancy-services",
  wipro: "wipro",
  hcl: "hcltech",
  "hcl tech": "hcltech",
  accenture: "accenture",
  microsoft: "microsoft",
  google: "google",
  flipkart: "flipkart",
  razorpay: "razorpay",
  "razor pay": "razorpay",
  indigo: "indigo-airlines",
  "indigo airlines": "indigo-airlines",
  deloitte: "deloitte",
  cognizant: "cognizant",
  capgemini: "capgemini",
};

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function metaFromHtml(html) {
  const pick = (prop) => {
    const m =
      html.match(new RegExp(`property=["']${prop}["'][^>]+content=["']([^"']+)`, "i")) ||
      html.match(new RegExp(`content=["']([^"']+)["'][^>]+property=["']${prop}["']`, "i"));
    return m?.[1]?.replace(/&amp;/g, "&").trim() || null;
  };
  return {
    title: pick("og:title"),
    description: pick("og:description"),
  };
}

export function companySlugCandidates(query) {
  const base = query.toLowerCase().trim();
  const known = KNOWN_COMPANY_SLUGS[base];
  const hyphen = base.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const compact = base.replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
  return [
    ...new Set([
      known,
      hyphen,
      compact,
      `${hyphen}-india`,
      `${compact}ltd`,
      `${compact}-careers`,
      `${hyphen}-limited`,
    ]),
  ].filter(Boolean);
}

export async function fetchCompanyBySlug(slug, displayName) {
  const url = `https://www.linkedin.com/company/${slug}/`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (/page not found|doesn't exist|unavailable/i.test(html.slice(0, 4000))) return null;

    const meta = metaFromHtml(html);
    if (!meta.title && !meta.description) return null;
    if (/sign in to linkedin/i.test(meta.title || "") && !meta.description) return null;

    return {
      name:
        meta.title
          ?.replace(/\s*\|.*LinkedIn.*$/i, "")
          .replace(/\s*-\s*LinkedIn.*$/i, "")
          .trim() || displayName,
      linkedinUrl: url,
      snippet: meta.description,
    };
  } catch {
    return null;
  }
}

export function cleanLinkedInCompanyUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("linkedin.com")) return null;
    const m = u.pathname.match(/\/company\/([^/?#]+)/);
    if (!m) return null;
    return `https://www.linkedin.com/company/${m[1]}/`;
  } catch {
    return null;
  }
}

export function cleanLinkedInProfileUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("linkedin.com")) return null;
    const m = u.pathname.match(/\/in\/([^/?#]+)/);
    if (!m) return null;
    return `https://www.linkedin.com/in/${m[1]}/`;
  } catch {
    return null;
  }
}

function parseLinksFromHtml(html, pattern) {
  const results = [];
  const seen = new Set();
  const re = new RegExp(pattern, "gi");
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1] || m[0];
    const decoded = href.replace(/&amp;/g, "&");
    if (seen.has(decoded)) continue;
    seen.add(decoded);
    results.push(decoded);
  }
  return results;
}

let lastDdgAt = 0;

export async function searchDuckDuckGoHtml(query, onLog, { retries = 1 } = {}) {
  const url = "https://html.duckduckgo.com/html/";
  onLog("info", "DuckDuckGo HTML search", query);
  const wait = Math.max(0, 2200 - (Date.now() - lastDdgAt));
  if (wait > 0) await delay(wait);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const body = new URLSearchParams({ q: query, b: "", kl: "", df: "" });
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "text/html",
          Referer: "https://html.duckduckgo.com/",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(25000),
      });
      lastDdgAt = Date.now();
      if (!res.ok) throw new Error(`DDG HTTP ${res.status}`);
      const html = await res.text();
      if (/captcha|anomaly|bots use duckduckgo/i.test(html)) {
        if (attempt < retries) {
          onLog("warn", "DuckDuckGo rate limit — waiting", "5s");
          await delay(5000);
          continue;
        }
        throw new Error("DuckDuckGo CAPTCHA — retry later");
      }
      return html;
    } catch (err) {
      if (attempt < retries) {
        await delay(4000);
        continue;
      }
      onLog("warn", "DuckDuckGo search failed", err.message);
      return "";
    }
  }
  return "";
}

export function extractCompanyUrlsFromHtml(html) {
  const urls = [
    ...parseLinksFromHtml(html, 'href="(https://[^"]*linkedin\\.com/company/[^"?#]+/?)"'),
    ...parseLinksFromHtml(html, 'uddg=([^&"]+)'),
    ...parseLinksFromHtml(html, 'href="[^"]*uddg=([^&"]+)'),
  ];
  const out = [];
  const seen = new Set();
  for (let raw of urls) {
    try {
      if (raw.startsWith("//")) raw = "https:" + raw;
      const decoded = decodeURIComponent(raw.replace(/&amp;/g, "&"));
      const clean = cleanLinkedInCompanyUrl(decoded);
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        out.push(clean);
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

export function extractProfileUrlsFromHtml(html) {
  const urls = [
    ...parseLinksFromHtml(html, 'href="(https://[^"]*linkedin\\.com/in/[^"?#]+/?)"'),
    ...parseLinksFromHtml(html, 'uddg=([^&"]+)'),
    ...parseLinksFromHtml(html, 'href="[^"]*uddg=([^&"]+)'),
  ];
  const out = [];
  const seen = new Set();
  for (let raw of urls) {
    try {
      const decoded = decodeURIComponent(raw.replace(/&amp;/g, "&"));
      const clean = cleanLinkedInProfileUrl(decoded);
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        out.push(clean);
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

export function extractSnippetsFromDdg(html) {
  const snippets = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]+)</gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    snippets.push({
      href: m[1],
      title: m[2].replace(/<[^>]+>/g, "").trim(),
      snippet: m[3].replace(/<[^>]+>/g, "").trim(),
    });
  }
  return snippets;
}

export async function verifyCompanySlug(page, slug, displayName) {
  const url = `https://www.linkedin.com/company/${slug}/`;
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!res || res.status() === 404) return null;

    const info = await page.evaluate(() => {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim();
      const title = document.querySelector("h1")?.textContent?.trim() || ogTitle;
      const desc =
        document.querySelector('meta[property="og:description"]')?.content?.trim() || "";
      const is404 = /page not found|doesn't exist|unavailable/i.test(
        document.body?.innerText?.slice(0, 800) || ""
      );
      return { title, desc, is404 };
    });

    if (info.is404) return null;
    if (!info.title && !info.desc) return null;

    return {
      name: info.title?.replace(/\s*\|.*LinkedIn.*$/i, "").replace(/\s*-\s*LinkedIn.*$/i, "").trim() || displayName,
      linkedinUrl: url,
      snippet: info.desc,
    };
  } catch {
    return null;
  }
}

/** Parse Bing HTML without page.evaluate — avoids "execution context destroyed" on redirects */
export function parseBingResultsFromHtml(html) {
  const items = [];
  const seen = new Set();
  const push = (title, href, snippet) => {
    if (!href || seen.has(href)) return;
    seen.add(href);
    items.push({ title: title || href, href, snippet: snippet || "" });
  };

  const blockRe = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let block;
  while ((block = blockRe.exec(html)) !== null) {
    const chunk = block[1];
    const href = chunk.match(/<a[^>]+href="(https?:\/\/[^"]+)"/i)?.[1]?.replace(/&amp;/g, "&");
    const title = chunk.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([^<]+)</i)?.[1]?.trim();
    const snippet = chunk.match(/<p[^>]*>([^<]{10,})</i)?.[1]?.trim();
    if (href) push(title, href, snippet);
  }

  const linkRe = /href="(https?:\/\/[^"]*linkedin\.com[^"]*)"/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    push(null, m[1].replace(/&amp;/g, "&"), "");
  }
  return items.slice(0, 40);
}

export function linkedInProfilesFromBingResults(results) {
  const out = [];
  const seen = new Set();
  for (const r of results) {
    const url = cleanLinkedInProfileUrl(r.href);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ ...r, href: url, profileUrl: url });
  }
  return out;
}

export function extractProfileUrlsFromRawHtml(html) {
  const out = [];
  const seen = new Set();
  const re = /https?:\/\/(?:[a-z]+\.)?linkedin\.com\/in\/[a-zA-Z0-9_%-]+/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const clean = cleanLinkedInProfileUrl(m[0].replace(/&amp;/g, "&"));
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

export async function googleSearchProfiles(page, query, onLog) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=20&hl=en`;
  onLog("info", "Google search", query);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await delay(2000);
    const html = await page.content();
    const urls = extractProfileUrlsFromRawHtml(html);
    onLog("info", `Google: ${urls.length} LinkedIn profile URL(s)`, query);
    return urls.map((href) => ({
      title: href.split("/in/")[1]?.replace(/-/g, " "),
      href,
      snippet: query,
    }));
  } catch (err) {
    onLog("warn", "Google search failed", err.message);
    return [];
  }
}

export async function braveSearchHtml(query, onLog) {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
  onLog("info", "Brave search", query);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    onLog("warn", "Brave search failed", err.message);
    return "";
  }
}

export async function bingSearch(page, query, onLog, { safeGoto, safePageContent } = {}) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=30`;
  onLog("info", "Bing search", query);
  try {
    if (safeGoto) await safeGoto(page, url, onLog);
    else {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await delay(1500);
    }
    const html = safePageContent ? await safePageContent(page) : await page.content();
    const structured = parseBingResultsFromHtml(html);
    for (const href of extractProfileUrlsFromRawHtml(html)) {
      if (!structured.some((s) => s.href === href)) {
        structured.push({
          title: href.split("/in/")[1]?.replace(/-/g, " "),
          href,
          snippet: query,
        });
      }
    }
    onLog("info", `Bing parsed ${structured.length} result(s)`, query);
    return structured;
  } catch (err) {
    onLog("warn", "Bing search failed", err.message);
    return [];
  }
}
