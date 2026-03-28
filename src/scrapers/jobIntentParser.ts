// src/scrapers/jobIntentParser.ts
import OpenAI from "openai";

export type JobScrapeIntent = {
  role: string;                              // e.g. "full stack developer"
  location: string;                          // e.g. "Remote", "Bangalore", "New York"
  sites: Array<"linkedin" | "indeed">;       // which sites to scrape
  maxPerSite: number;                        // how many listings per site
};

const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM = `
You are a job search intent extractor for a web scraping agent.

Given a natural language instruction, extract a structured JSON object.

Return STRICT JSON only. No prose, no markdown, no code fences.

Output shape:
{
  "role": "<job title / role to search for, normalized — e.g. 'Full Stack Developer', 'Backend Engineer', 'Data Scientist'>",
  "location": "<location string — use 'Remote' if user says remote or doesn't specify, otherwise use city/country>",
  "sites": ["linkedin", "indeed"],
  "maxPerSite": <number between 5 and 25, default 10>
}

Rules:
- Always normalize the role to a clean job title. 
  e.g. "full stack" → "Full Stack Developer", "backend" → "Backend Engineer", "ml" → "Machine Learning Engineer"
- "sites": if user mentions only LinkedIn → ["linkedin"], only Indeed → ["indeed"], otherwise both.
- "maxPerSite": if user says "top 5" or "5 jobs" → 5. If they say "20" → 20. Default 10.
- "location": if user says "in Bangalore" → "Bangalore, India". If "remote" → "Remote". If nothing → "Remote".

Examples:
  "scrape full stack jobs" → { "role": "Full Stack Developer", "location": "Remote", "sites": ["linkedin", "indeed"], "maxPerSite": 10 }
  "find me 15 backend engineer jobs in Bangalore on LinkedIn" → { "role": "Backend Engineer", "location": "Bangalore, India", "sites": ["linkedin"], "maxPerSite": 15 }
  "get react developer openings from indeed" → { "role": "React Developer", "location": "Remote", "sites": ["indeed"], "maxPerSite": 10 }
  "scrape top 5 devops jobs in New York" → { "role": "DevOps Engineer", "location": "New York, USA", "sites": ["linkedin", "indeed"], "maxPerSite": 5 }
`.trim();

export async function parseJobScrapeIntent(userPrompt: string): Promise<JobScrapeIntent> {
  const resp = await oai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    text: { format: { type: "json_object" } },
    max_output_tokens: 300,
  });

  const parsed = JSON.parse(resp.output_text || "{}");

  // Validate and apply defaults
  const role = (parsed.role || "Software Developer").trim();
  const location = (parsed.location || "Remote").trim();
  const rawSites: string[] = Array.isArray(parsed.sites) ? parsed.sites : ["linkedin", "indeed"];
  const sites = rawSites.filter((s) =>
    s === "linkedin" || s === "indeed"
  ) as Array<"linkedin" | "indeed">;
  const maxPerSite = Math.min(25, Math.max(3, Number(parsed.maxPerSite) || 10));

  return {
    role,
    location,
    sites: sites.length > 0 ? sites : ["linkedin", "indeed"],
    maxPerSite,
  };
}

/**
 * Quick heuristic to detect if a natural language task is a job scraping request
 * without calling the LLM — used by dispatcher for fast routing.
 */
export function looksLikeJobScrapeRequest(prompt: string): boolean {
  const p = prompt.toLowerCase();
  const scrapeWords = ["scrape", "find jobs", "get jobs", "fetch jobs", "search jobs", "job listings", "job openings", "job search"];
  const jobWords = ["job", "jobs", "opening", "openings", "listing", "listings", "position", "positions", "vacancy", "vacancies", "role", "roles"];
  const hasScrape = scrapeWords.some((w) => p.includes(w));
  const hasJob = jobWords.some((w) => p.includes(w));
  return hasScrape || (hasJob && (p.includes("linkedin") || p.includes("indeed") || p.includes("find") || p.includes("get")));
}