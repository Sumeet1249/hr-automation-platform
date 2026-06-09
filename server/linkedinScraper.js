import {
  companySlugCandidates,
  cleanLinkedInCompanyUrl,
  searchDuckDuckGoHtml,
  extractCompanyUrlsFromHtml,
  extractProfileUrlsFromHtml,
  extractSnippetsFromDdg,
  fetchCompanyBySlug,
  verifyCompanySlug,
  bingSearch,
  linkedInProfilesFromBingResults,
  braveSearchHtml,
  extractProfileUrlsFromRawHtml,
  googleSearchProfiles,
  cleanLinkedInProfileUrl,
} from "./searchProviders.js";
import {
  delay,
  launchBrowser,
  setupPage,
  safeGoto,
  safePageContent,
  safeEvaluate,
} from "./browserHelper.js";

const HR_KEYWORDS = [
  "human resources", "hr manager", "hr business partner", "hrbp", "talent acquisition",
  "recruiter", "recruitment", "people operations", "people ops", "head of hr", "chro",
  "chief people", "hiring manager", "employee relations", "talent partner", "staffing",
  "workforce", "people & culture", "people and culture", "hr executive", "hr generalist",
  "hr lead", "hr director", "talent manager", "campus hiring", "university relations",
];

function isHrRelated(text, strict = true) {
  const lower = (text ?? "").toLowerCase();
  if (HR_KEYWORDS.some((k) => lower.includes(k))) return true;
  if (!strict) return /\b(hr|recruit|talent|people ops|hiring|staffing)\b/i.test(lower);
  return false;
}

function nameFromProfileSlug(slug) {
  if (!slug) return "Unknown";
  const base = slug.replace(/\/$/, "").replace(/-[a-f0-9]{6,}$/i, "").replace(/-\d{6,}$/, "");
  return base.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function nameFromLinkedInTitle(title) {
  const cleaned = title
    ?.replace(/\s*[-|–].*LinkedIn.*$/i, "")
    .replace(/\s*\|.*$/, "")
    .replace(/\s*-\s*LinkedIn.*$/i, "")
    .replace(/\s+[a-f0-9]{6,}\/?$/i, "")
    .trim();
  if (!cleaned) return "Unknown";
  if (/^[a-z0-9-]+\/?$/i.test(cleaned)) return nameFromProfileSlug(cleaned);
  return cleaned;
}

async function discoverCompanies(page, query, limit, onLog, helpers) {
  const found = [];
  const seen = new Set();
  const add = (company) => {
    const url = cleanLinkedInCompanyUrl(company.linkedinUrl) || company.linkedinUrl;
    if (!url || seen.has(url)) return;
    seen.add(url);
    found.push({ ...company, linkedinUrl: url });
  };

  onLog("info", "Step 1 · Strategy A: Direct LinkedIn URLs (HTTP)", query);
  for (const slug of companySlugCandidates(query)) {
    if (found.length >= limit) break;
    const hit = await fetchCompanyBySlug(slug, query);
    if (hit) {
      add(hit);
      onLog("success", `Direct match: ${hit.name}`, hit.linkedinUrl);
    }
    await delay(200);
  }

  if (found.length < limit && page) {
    onLog("info", "Step 1 · Strategy B: Browser verify slugs", query);
    for (const slug of companySlugCandidates(query)) {
      if (found.length >= limit) break;
      const url = `https://www.linkedin.com/company/${slug}/`;
      if (seen.has(url)) continue;
      const hit = await verifyCompanySlug(page, slug, query);
      if (hit) {
        add(hit);
        onLog("success", `Verified: ${hit.name}`, hit.linkedinUrl);
      }
      await delay(300);
    }
  }

  const ddgQueries = [`site:linkedin.com/company ${query}`, `linkedin company ${query}`];
  for (const q of ddgQueries) {
    if (found.length >= limit) break;
    const html = await searchDuckDuckGoHtml(q, onLog, { retries: 1 });
    if (!html) continue;
    const urls = extractCompanyUrlsFromHtml(html);
    onLog("info", `DDG: ${urls.length} company URL(s)`, q);
    for (const url of urls) {
      if (found.length >= limit) break;
      const slug = url.split("/company/")[1]?.replace(/\/$/, "");
      add({
        name: nameFromLinkedInTitle(slug?.replace(/-/g, " ") || query),
        linkedinUrl: url,
        snippet: null,
      });
    }
    await delay(800);
  }

  if (found.length < limit && page) {
    const bingResults = await bingSearch(page, `site:linkedin.com/company ${query}`, onLog, helpers);
    for (const r of bingResults) {
      if (found.length >= limit) break;
      const url = cleanLinkedInCompanyUrl(r.href);
      if (!url) continue;
      add({ name: nameFromLinkedInTitle(r.title), linkedinUrl: url, snippet: r.snippet });
    }
  }

  onLog(
    found.length ? "success" : "error",
    `Discovered ${found.length} company candidate(s)`,
    found.map((c) => c.name).join(", ") || "Try exact name: Razorpay, Infosys, TCS"
  );
  return found.slice(0, limit);
}

async function scrapeCompanyDetails(page, company, onLog) {
  onLog("info", "Fetching company details", company.linkedinUrl);
  const fallback = {
    name: company.name,
    linkedinUrl: company.linkedinUrl,
    industry: null,
    companySize: null,
    headquarters: null,
    website: null,
    description: company.snippet,
    followerCount: null,
  };

  if (!page) return fallback;

  try {
    await safeGoto(page, company.linkedinUrl, onLog);
    await delay(1500);

    const slug = company.linkedinUrl.split("/company/")[1]?.replace(/\/$/, "");
    const meta = slug ? await fetchCompanyBySlug(slug, company.name) : null;
    if (meta?.snippet) fallback.description = meta.snippet;
    if (meta?.name && !/join linkedin/i.test(meta.name)) fallback.name = meta.name;

    const details = await safeEvaluate(page, () => {
      const getMeta = (prop) =>
        document.querySelector(`meta[property='${prop}'], meta[name='${prop}']`)?.content?.trim();
      const bodyText = document.body?.innerText || "";
      return {
        name: document.querySelector("h1")?.textContent?.trim() || getMeta("og:title"),
        description: getMeta("og:description"),
        industry: bodyText.match(/Industry\s*\n\s*([^\n]+)/i)?.[1] || null,
        companySize: bodyText.match(/Company size\s*\n\s*([^\n]+)/i)?.[1] || null,
        headquarters: bodyText.match(/Headquarters\s*\n\s*([^\n]+)/i)?.[1] || null,
        website: document.querySelector("a[href^='http']:not([href*='linkedin'])")?.href || null,
        followerCount: bodyText.match(/([\d,.]+[KMB]?)\s*followers/i)?.[1] || null,
      };
    });

    let name = nameFromLinkedInTitle(details.name);
    if (!name || /join linkedin/i.test(name)) name = fallback.name || company.name;

    return {
      name,
      linkedinUrl: company.linkedinUrl,
      industry: details.industry,
      companySize: details.companySize,
      headquarters: details.headquarters,
      website: details.website,
      description: details.description || company.snippet,
      followerCount: details.followerCount,
    };
  } catch (err) {
    onLog("warn", "Company details partial", err.message);
    return fallback;
  }
}

function personFromSearchResult(r, companyName) {
  const profileUrl = cleanLinkedInProfileUrl(r.href || r.profileUrl);
  if (!profileUrl) return null;
  const slugName = nameFromProfileSlug(profileUrl.split("/in/")[1]);
  const parsedTitle = nameFromLinkedInTitle(r.title);
  const combined = `${r.title} ${r.snippet}`;
  const titleMatch =
    r.snippet?.match(/(HR[^.]{0,100}|Recruiter[^.]{0,100}|Talent[^.]{0,100}|Human Resources[^.]{0,100})/i) ||
    r.title?.match(/(HR[^|]{0,80}|Recruiter[^|]{0,80})/i);

  return {
    personName: parsedTitle !== "Unknown" ? parsedTitle : slugName,
    jobTitle: titleMatch?.[0]?.trim() || r.title?.split(/[-|–]/)[1]?.trim() || null,
    profileUrl,
    location: r.snippet?.match(/([A-Za-z][A-Za-z\s,.]+,\s*[A-Za-z\s]+)/)?.[0]?.trim() || null,
    snippet: r.snippet,
    matchReason: HR_KEYWORDS.find((k) => combined.toLowerCase().includes(k)) || "Found via HR web search",
    companyName,
  };
}

async function scrapeCompanyPeoplePage(page, companyUrl, companyName, limit, onLog) {
  const peopleUrl = companyUrl.replace(/\/?$/, "/") + "people/";
  onLog("info", "LinkedIn People tab", peopleUrl);
  try {
    await safeGoto(page, peopleUrl, onLog);
    await delay(2000);
    const cards = await safeEvaluate(page, () =>
      [...document.querySelectorAll('a[href*="/in/"]')]
        .map((a) => ({
          title: a.textContent?.trim() || "",
          href: a.href?.split("?")[0],
          snippet: a.closest("li, div")?.textContent?.trim()?.slice(0, 200) || "",
        }))
        .filter((x) => x.href)
        .slice(0, 40)
    );
    const matched = [];
    for (const c of cards) {
      const p = personFromSearchResult(c, companyName);
      if (!p) continue;
      if (isHrRelated(`${p.personName} ${p.jobTitle} ${p.snippet}`, false)) matched.push(p);
    }
    onLog("info", `People tab: ${matched.length} HR profile(s)`, companyName);
    return matched.slice(0, limit);
  } catch (err) {
    onLog("warn", "People tab skipped", err.message);
    return [];
  }
}

async function findHrPeople(page, companyName, companyUrl, limit, onLog, helpers) {
  const people = [];
  const seen = new Set();

  const addPerson = (p, strict) => {
    if (!p || seen.has(p.profileUrl)) return false;
    const combined = `${p.personName} ${p.jobTitle} ${p.snippet}`;
    if (strict && !isHrRelated(combined, true)) return false;
    if (!strict && !isHrRelated(combined, false)) return false;
    seen.add(p.profileUrl);
    people.push(p);
    return true;
  };

  const addFromHrSearch = (r) => {
    const p = personFromSearchResult(r, companyName);
    if (!p || seen.has(p.profileUrl)) return false;
    seen.add(p.profileUrl);
    people.push(p);
    return true;
  };

  for (const p of await scrapeCompanyPeoplePage(page, companyUrl, companyName, limit, onLog)) {
    if (people.length >= limit) break;
    addPerson(p, false);
  }

  const googleQ = `site:linkedin.com/in ${companyName} HR OR recruiter OR "human resources"`;
  for (const r of await googleSearchProfiles(page, googleQ, onLog)) {
    if (people.length >= limit) break;
    addFromHrSearch(r);
  }

  for (const q of [
    `site:linkedin.com/in ${companyName} "human resources"`,
    `site:linkedin.com/in ${companyName} recruiter OR "talent acquisition"`,
  ]) {
    if (people.length >= limit) break;
    const bingResults = linkedInProfilesFromBingResults(await bingSearch(page, q, onLog, helpers));
    for (const r of bingResults) {
      if (people.length >= limit) break;
      addFromHrSearch(r);
    }
    await delay(600);
  }

  if (people.length < limit) {
    const braveHtml = await braveSearchHtml(`site:linkedin.com/in ${companyName} human resources OR recruiter`, onLog);
    for (const url of extractProfileUrlsFromRawHtml(braveHtml)) {
      if (people.length >= limit) break;
      addFromHrSearch({ title: url.split("/in/")[1]?.replace(/-/g, " "), href: url, snippet: `HR at ${companyName}` });
    }
  }

  if (people.length < limit) {
    const html = await searchDuckDuckGoHtml(`site:linkedin.com/in ${companyName} HR OR recruiter`, onLog, { retries: 1 });
    if (html) {
      for (const url of extractProfileUrlsFromHtml(html)) {
        if (people.length >= limit) break;
        addFromHrSearch({ title: url.split("/in/")[1]?.replace(/-/g, " "), href: url, snippet: `HR at ${companyName}` });
      }
    }
  }

  onLog(
    people.length ? "success" : "warn",
    `Found ${people.length} HR contact(s) for ${companyName}`,
    people.map((p) => p.personName).join(", ") || "Add LinkedIn cookie for better results"
  );
  return people.slice(0, limit);
}

/** STEP 1: Find companies only — user selects before HR search */
export async function runCompanyDiscoveryJob({ companyQuery, companyLimit, onLog, onProgress }) {
  let browser;
  try {
    onLog("info", "Step 1 started", `Finding up to ${companyLimit} companies for "${companyQuery}"`);
    browser = await launchBrowser(onLog);
    const page = await setupPage(browser, { onLog });
    const helpers = { safeGoto: (p, u) => safeGoto(p, u, onLog), safePageContent };

    const discovered = await discoverCompanies(page, companyQuery, companyLimit, onLog, helpers);
    if (!discovered.length) {
      throw new Error(`No companies found for "${companyQuery}". Try Razorpay, Infosys, TCS, Amazon.`);
    }

    const companies = [];
    for (const disc of discovered) {
      const details = await scrapeCompanyDetails(page, disc, onLog);
      companies.push(details);
      onProgress?.({ type: "company", company: details });
      await delay(400);
    }

    await browser.close();
    return { status: "awaiting_selection", companies_found: companies.length, companies };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

/** STEP 2: HR search for user-selected companies only */
export async function runHrSearchJob({ selectedCompanies, hrPerCompany, linkedinCookie, onLog, onProgress }) {
  let browser;
  try {
    onLog("info", "Step 2 started", `${selectedCompanies.length} company(s) · ${hrPerCompany} HR each`);
    if (!linkedinCookie && !process.env.LINKEDIN_LI_AT) {
      onLog("warn", "No LinkedIn cookie", "HR results may be limited without li_at cookie");
    }

    browser = await launchBrowser(onLog);
    const page = await setupPage(browser, { linkedinCookie, onLog });
    const helpers = { safeGoto: (p, u) => safeGoto(p, u, onLog), safePageContent };

    let totalHr = 0;
    const results = [];

    for (const company of selectedCompanies) {
      onLog("info", `Searching HR for ${company.name}`, company.linkedin_url || company.linkedinUrl);
      const people = await findHrPeople(
        page,
        company.name,
        company.linkedin_url || company.linkedinUrl,
        hrPerCompany,
        onLog,
        helpers
      );
      totalHr += people.length;
      results.push({ company, people });
      onProgress?.({ type: "hr_batch", companyName: company.name, people });
      await delay(500);
    }

    await browser.close();
    const status = totalHr > 0 ? "completed" : "partial";
    return {
      status,
      hr_contacts_found: totalHr,
      results,
      failure_reason: totalHr === 0 ? "No HR profiles found. Add LinkedIn li_at cookie and retry." : null,
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}
