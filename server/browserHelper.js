import puppeteer from "puppeteer";

export function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function launchBrowser(onLog) {
  const headless = process.env.HEADLESS !== "false";
  onLog("info", "Launching browser", headless ? "headless" : "visible");
  const browser = await puppeteer.launch({
    headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  return browser;
}

export async function setupPage(browser, { linkedinCookie, onLog } = {}) {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  );
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  await page.setViewport({ width: 1400, height: 900 });

  const liAt = (linkedinCookie || process.env.LINKEDIN_LI_AT || "").trim();
  if (liAt) {
    await page.setCookie({
      name: "li_at",
      value: liAt,
      domain: ".linkedin.com",
      path: "/",
      httpOnly: true,
      secure: true,
    });
    onLog?.("info", "LinkedIn session cookie loaded", "People tab & search unlocked");
  }
  return page;
}

/** Navigate without crashing when Bing/LinkedIn redirect mid-load */
export async function safeGoto(page, url, onLog) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await delay(1200);
    return true;
  } catch (err) {
    onLog?.("warn", "Navigation issue (continuing)", err.message);
    await delay(1500);
    return false;
  }
}

export async function safePageContent(page) {
  for (let i = 0; i < 3; i++) {
    try {
      return await page.content();
    } catch (err) {
      if (!/Execution context was destroyed|detached/i.test(err.message) || i === 2) throw err;
      await delay(1200);
    }
  }
  return "";
}

export async function safeEvaluate(page, fn, arg) {
  for (let i = 0; i < 3; i++) {
    try {
      return arg !== undefined ? await page.evaluate(fn, arg) : await page.evaluate(fn);
    } catch (err) {
      if (!/Execution context was destroyed|detached/i.test(err.message) || i === 2) throw err;
      await delay(1200);
    }
  }
}
