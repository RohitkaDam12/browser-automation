// src/scrapers/jobScraper.ts
import { chromium, type Page } from "playwright";

const DEFAULT_CDP = process.env.CHROME_CDP || "http://127.0.0.1:9333";

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobListing = {
  title: string;
  company: string;
  location: string;
  salary?: string;
  jobType?: string;       // Full-time, Part-time, Contract, etc.
  postedAt?: string;      // "2 days ago", "Just now", etc.
  description?: string;   // first ~300 chars of job description
  applyUrl: string;
  source: "linkedin" | "indeed";
};

export type ScrapeJobsInput = {
  role: string;            // e.g. "full stack developer"
  location?: string;       // e.g. "Remote", "Bangalore", "New York"
  sites?: Array<"linkedin" | "indeed">;
  maxPerSite?: number;     // default 10
  cdp?: string;
};

export type ScrapeJobsResult = {
  query: { role: string; location: string; sites: string[] };
  totalFound: number;
  jobs: JobListing[];
  scrapedAt: string;
  errors: string[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildLinkedInUrl(role: string, location: string): string {
  const q = encodeURIComponent(role);
  const loc = encodeURIComponent(location || "Worldwide");
  return `https://www.linkedin.com/jobs/search/?keywords=${q}&location=${loc}&f_TPR=r86400&sortBy=DD`;
}

function buildIndeedUrl(role: string, location: string): string {
  const q = encodeURIComponent(role);
  const loc = encodeURIComponent(location || "");
  return `https://www.indeed.com/jobs?q=${q}&l=${loc}&sort=date&fromage=7`;
}

function truncate(text: string, max = 300): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

// ─── LinkedIn scraper ─────────────────────────────────────────────────────────

async function scrapeLinkedIn(
  page: Page,
  role: string,
  location: string,
  max: number
): Promise<JobListing[]> {
  const url = buildLinkedInUrl(role, location);
  console.log(`  🔗 LinkedIn → ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(2500);

  // Accept cookies if prompted
  try {
    const cookieBtn = page.locator('button[action-type="ACCEPT"]').first();
    if (await cookieBtn.isVisible({ timeout: 3000 })) {
      await cookieBtn.click();
      await sleep(1000);
    }
  } catch {}

  // Wait for job cards
  try {
    await page.waitForSelector(
      '.jobs-search__results-list li, .job-search-card, ul.jobs-search__results-list > li',
      { timeout: 15000 }
    );
  } catch {
    console.warn("  ⚠️  LinkedIn: job card selector timed out, trying anyway...");
  }

  await sleep(1500);

  const jobs = await page.evaluate((maxJobs: number) => {
    const results: any[] = [];

    // Public (logged-out) LinkedIn job cards
    const cards = Array.from(
      document.querySelectorAll(
        "ul.jobs-search__results-list > li, .job-search-card"
      )
    ).slice(0, maxJobs);

    for (const card of cards) {
      try {
        const title =
          card.querySelector(".base-search-card__title, h3.base-search-card__title")
            ?.textContent?.trim() || "";
        const company =
          card.querySelector(".base-search-card__subtitle a, h4.base-search-card__subtitle")
            ?.textContent?.trim() || "";
        const loc =
          card.querySelector(".job-search-card__location, .base-search-card__metadata span")
            ?.textContent?.trim() || "";
        const postedAt =
          card.querySelector("time")?.getAttribute("datetime") ||
          card.querySelector(".job-search-card__listdate, time")?.textContent?.trim() ||
          "";
        const applyUrl =
          (card.querySelector("a.base-card__full-link, a[href*='/jobs/view/']") as HTMLAnchorElement)
            ?.href || "";
        const salary =
          card.querySelector(".job-search-card__salary-info")?.textContent?.trim() || undefined;

        if (title && applyUrl) {
          results.push({ title, company, location: loc, postedAt, applyUrl, salary });
        }
      } catch {}
    }
    return results;
  }, max);

  return jobs.map((j) => ({ ...j, source: "linkedin" as const }));
}

// ─── Indeed scraper ───────────────────────────────────────────────────────────

async function scrapeIndeed(
  page: Page,
  role: string,
  location: string,
  max: number
): Promise<JobListing[]> {
  const url = buildIndeedUrl(role, location);
  console.log(`  🔗 Indeed → ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(2500);

  // Dismiss cookie/consent banner if present
  try {
    const cookieBtn = page
      .locator('button[id*="onetrust-accept"], button:has-text("Accept")')
      .first();
    if (await cookieBtn.isVisible({ timeout: 3000 })) {
      await cookieBtn.click();
      await sleep(1000);
    }
  } catch {}

  // Wait for job cards
  try {
    await page.waitForSelector(
      '.job_seen_beacon, .jobCard_mainContent, [data-testid="slider_item"]',
      { timeout: 15000 }
    );
  } catch {
    console.warn("  ⚠️  Indeed: job card selector timed out, trying anyway...");
  }

  await sleep(1500);

  const jobs = await page.evaluate((maxJobs: number) => {
    const results: any[] = [];

    const cards = Array.from(
      document.querySelectorAll(
        '.job_seen_beacon, [data-testid="slider_item"], .resultContent'
      )
    ).slice(0, maxJobs);

    for (const card of cards) {
      try {
        const title =
          card.querySelector('[data-testid="jobTitle"] span, h2.jobTitle span, .jcs-JobTitle span')
            ?.textContent?.trim() || "";
        const company =
          card.querySelector('[data-testid="company-name"], .companyName, span[class*="companyName"]')
            ?.textContent?.trim() || "";
        const loc =
          card.querySelector('[data-testid="text-location"], .companyLocation, div[class*="companyLocation"]')
            ?.textContent?.trim() || "";
        const salary =
          card.querySelector('[data-testid="attribute_snippet_testid"], .salary-snippet-container, div[class*="salary"]')
            ?.textContent?.trim() || undefined;
        const jobType =
          card.querySelector('.jobMetaDataGroup li, div[class*="jobType"]')
            ?.textContent?.trim() || undefined;
        const postedAt =
          card.querySelector('[data-testid="myJobsStateDate"], span[class*="date"]')
            ?.textContent?.trim() || "";

        // Build apply URL — Indeed uses relative paths
        const linkEl = card.querySelector(
          'a[data-jk], a[id*="job_"], a[href*="/rc/clk"], a[href*="/pagead/clk"]'
        ) as HTMLAnchorElement | null;
        const href = linkEl?.href || linkEl?.getAttribute("href") || "";
        const applyUrl = href.startsWith("http") ? href : `https://www.indeed.com${href}`;

        if (title && applyUrl && applyUrl !== "https://www.indeed.com") {
          results.push({ title, company, location: loc, salary, jobType, postedAt, applyUrl });
        }
      } catch {}
    }
    return results;
  }, max);

  return jobs.map((j) => ({ ...j, source: "indeed" as const }));
}

// ─── Fetch job description (optional enrichment) ──────────────────────────────

async function fetchDescription(page: Page, job: JobListing): Promise<string> {
  try {
    await page.goto(job.applyUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(1500);

    const desc = await page.evaluate(() => {
      const sel = [
        ".show-more-less-html__markup",       // LinkedIn
        "#jobDescriptionText",                  // Indeed
        '[data-testid="jobDescriptionText"]',  // Indeed alt
        ".job-description",
        "section.description",
      ];
      for (const s of sel) {
        const el = document.querySelector(s);
        if (el?.textContent?.trim()) return el.textContent.trim();
      }
      return "";
    });

    return truncate(desc, 400);
  } catch {
    return "";
  }
}

// ─── Main exported scraper ────────────────────────────────────────────────────

export async function scrapeJobs(input: ScrapeJobsInput): Promise<ScrapeJobsResult> {
  const {
    role,
    location = "Remote",
    sites = ["linkedin", "indeed"],
    maxPerSite = 10,
    cdp,
  } = input;

  console.log(`\n🕵️  Scraping jobs: "${role}" | Location: "${location}" | Sites: ${sites.join(", ")}`);

  const result: ScrapeJobsResult = {
    query: { role, location, sites },
    totalFound: 0,
    jobs: [],
    scrapedAt: new Date().toISOString(),
    errors: [],
  };

  // ── Connect to browser ────────────────────────────────────────────────────
  let browser: any = null;
  let context: any = null;
  let page: Page | null = null;

  try {
    const wsEndpoint = cdp || DEFAULT_CDP;
    console.log(`  🌐 Connecting via CDP: ${wsEndpoint}`);
    browser = await chromium.connectOverCDP(wsEndpoint);
    const contexts = browser.contexts();
    context = contexts[0] || (await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    }));
    page = await context.newPage();
  } catch (err: any) {
    // Fallback: launch a new headless browser if CDP fails
    console.warn(`  ⚠️  CDP connect failed (${err?.message}), launching fresh browser...`);
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    page = await context.newPage();
  }

  try {
    // ── Scrape each site sequentially ────────────────────────────────────────
    for (const site of sites) {
      try {
        console.log(`\n📋 Scraping ${site}...`);

        let jobs: JobListing[] = [];

        if (site === "linkedin") {
          jobs = await scrapeLinkedIn(page!, role, location, maxPerSite);
        } else if (site === "indeed") {
          jobs = await scrapeIndeed(page!, role, location, maxPerSite);
        }

        console.log(`  ✅ ${site}: found ${jobs.length} listings`);
        result.jobs.push(...jobs);
      } catch (err: any) {
        const msg = `${site} scraping failed: ${err?.message}`;
        console.error(`  ❌ ${msg}`);
        result.errors.push(msg);
      }
    }

    result.totalFound = result.jobs.length;

    // Deduplicate by title+company
    const seen = new Set<string>();
    result.jobs = result.jobs.filter((j) => {
      const key = `${j.title.toLowerCase()}|${j.company.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`\n✅ Scrape complete. Total unique listings: ${result.jobs.length}`);
    return result;

  } finally {
    try { await page?.close(); } catch {}
    // Don't close the shared CDP context — only close if we launched our own browser
    try {
      if (!cdp || browser.contexts().length === 0) {
        await context?.close();
      }
    } catch {}
  }
}