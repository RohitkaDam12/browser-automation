// src/server.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { routeIntent } from "./intentRouter";
import { dispatch } from "./dispatcher";
import { scrapeJobs, type ScrapeJobsResult } from "./scrapers/jobScraper";
import { parseJobScrapeIntent, looksLikeJobScrapeRequest } from "./scrapers/jobIntentParser";
import { scheduleMeeting, type MeetingResult } from "./meeting/meetingRouter";
import { looksLikeMeetingRequest } from "./meeting/meetingParser";
import { sendWhatsAppMessage } from "./whatsapp/whatsappSender";
import { parseWhatsAppIntent, looksLikeWhatsAppRequest } from "./whatsapp/whatsappIntentParser";

const app = express();
app.use(cors());
app.use(express.json());

// ─── In-memory task store ─────────────────────────────────────────────────────

type TaskStatus = "pending" | "running" | "completed" | "failed";

interface Task {
  taskId: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  resolvedIntent?: any;
  error?: string;
  verificationResult?: {
    taskCompleted: boolean;
    reason: string;
  };
}

const tasks = new Map<string, Task>();

function updateTask(taskId: string, patch: Partial<Task>) {
  const existing = tasks.get(taskId);
  if (!existing) return;
  tasks.set(taskId, { ...existing, ...patch, updatedAt: new Date().toISOString() });
}

// ─── Background runners ───────────────────────────────────────────────────────

async function runTask(taskId: string, prompt: string, cdpUrl?: string) {
  updateTask(taskId, { status: "running" });

  try {
    const intent = await routeIntent(prompt);
    updateTask(taskId, { resolvedIntent: intent });

    await dispatch(intent, cdpUrl);

    updateTask(taskId, {
      status: "completed",
      verificationResult: {
        taskCompleted: true,
        reason: `Successfully completed: ${intent.goal}`,
      },
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    updateTask(taskId, {
      status: "failed",
      error: msg,
      verificationResult: { taskCompleted: false, reason: msg },
    });
  }
}

async function runWhatsAppTask(taskId: string, prompt: string, cdpUrl?: string) {
  updateTask(taskId, { status: "running" });
  try {
    const intent = await parseWhatsAppIntent(prompt);
    updateTask(taskId, {
      resolvedIntent: {
        contactName: intent.contactName,
        phoneNumber: intent.phoneNumber,
        goal: intent.goal,
      },
    });

    const result = await sendWhatsAppMessage(intent, cdpUrl);

    updateTask(taskId, {
      status: "completed",
      verificationResult: {
        taskCompleted: true,
        reason: `Message sent to "${result.contactName}" at ${result.sentAt}`,
      },
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    updateTask(taskId, {
      status: "failed",
      error: msg,
      verificationResult: { taskCompleted: false, reason: msg },
    });
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.post("/api/tasks", async (req, res) => {
  const { task, cdpUrl } = req.body || {};

  if (!task || typeof task !== "string" || task.trim().length < 5) {
    return res.status(400).json({ ok: false, error: "task must be at least 5 characters" });
  }

  const trimmed = task.trim();

  // Auto-detect meeting scheduling requests
  if (looksLikeMeetingRequest(trimmed)) {
    try {
      const result = await scheduleMeeting(trimmed);
      return res.json({ ok: true, taskId: randomUUID(), type: "meeting", result });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "Meeting creation failed" });
    }
  }

  // Auto-detect WhatsApp messaging requests
  if (looksLikeWhatsAppRequest(trimmed)) {
    const taskId = randomUUID();
    const now = new Date().toISOString();
    tasks.set(taskId, {
      taskId,
      prompt: trimmed,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    console.log(`\n💬 WhatsApp task queued [${taskId}]: "${trimmed}"\n`);
    runWhatsAppTask(taskId, trimmed, cdpUrl).catch(() => {});
    return res.json({ ok: true, taskId, type: "whatsapp" });
  }

  // Auto-detect job scrape requests and route to the dedicated scraper
  if (looksLikeJobScrapeRequest(trimmed)) {
    const scrapeId = randomUUID();
    const now = new Date().toISOString();
    scrapeJobs_store.set(scrapeId, {
      scrapeId,
      prompt: trimmed,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    console.log(`\n🕵️  Job scrape queued via /api/tasks [${scrapeId}]: "${trimmed}"\n`);
    runJobScrape(scrapeId, trimmed, cdpUrl).catch(() => {});
    return res.json({ ok: true, taskId: scrapeId, type: "job_scrape", pollUrl: `/api/scrape/jobs/${scrapeId}` });
  }

  const taskId = randomUUID();
  const now = new Date().toISOString();

  tasks.set(taskId, {
    taskId,
    prompt: trimmed,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  console.log(`\n📥 Task queued [${taskId}]: "${task}"\n`);
  runTask(taskId, trimmed, cdpUrl).catch(() => {});

  return res.json({ ok: true, taskId });
});

app.get("/api/tasks/:taskId", (req, res) => {
  const { taskId } = req.params;
  const slim = req.query.slim === "true";
  const task = tasks.get(taskId);

  if (!task) return res.status(404).json({ ok: false, error: "Task not found" });

  if (slim) {
    return res.json({
      taskId: task.taskId,
      status: task.status,
      error: task.error,
      verificationResult: task.verificationResult,
      updatedAt: task.updatedAt,
    });
  }

  return res.json(task);
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ─── WhatsApp Routes ──────────────────────────────────────────────────────────

/**
 * POST /api/whatsapp
 * Body (natural language):  { "prompt": "send a message to Rahul saying I'll be 10 mins late" }
 * Body (structured):        { "contactName": "Rahul", "message": "I'll be 10 mins late", "cdpUrl": "..." }
 * Body (with phone number): { "contactName": "+919876543210", "phoneNumber": "+919876543210", "message": "Hey!" }
 */
app.post("/api/whatsapp", async (req, res) => {
  const { prompt, contactName, phoneNumber, message, cdpUrl } = req.body || {};

  if (!prompt && !(contactName && message)) {
    return res.status(400).json({
      ok: false,
      error: 'Provide either "prompt" (natural language) or both "contactName" and "message"',
    });
  }

  try {
    const intent = prompt
      ? await parseWhatsAppIntent(prompt.trim())
      : {
          contactName: contactName.trim(),
          phoneNumber: (phoneNumber || "").trim(),
          message: message.trim(),
          goal: `Send WhatsApp message to ${contactName}`,
        };

    console.log(`\n💬 WhatsApp API: sending to "${intent.contactName}"`);
    const result = await sendWhatsAppMessage(intent, cdpUrl);

    return res.json({ ok: true, result });
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(`\n❌ WhatsApp send failed: ${msg}`);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// ─── Job Scrape Store ─────────────────────────────────────────────────────────

type ScrapeStatus = "pending" | "running" | "completed" | "failed";

interface ScrapeTask {
  scrapeId: string;
  prompt: string;
  status: ScrapeStatus;
  createdAt: string;
  updatedAt: string;
  intent?: { role: string; location: string; sites: string[] };
  result?: ScrapeJobsResult;
  error?: string;
}

const scrapeJobs_store = new Map<string, ScrapeTask>();

function updateScrapeTask(scrapeId: string, patch: Partial<ScrapeTask>) {
  const existing = scrapeJobs_store.get(scrapeId);
  if (!existing) return;
  scrapeJobs_store.set(scrapeId, { ...existing, ...patch, updatedAt: new Date().toISOString() });
}

async function runJobScrape(scrapeId: string, prompt: string, cdpUrl?: string) {
  updateScrapeTask(scrapeId, { status: "running" });
  try {
    const intent = await parseJobScrapeIntent(prompt);
    updateScrapeTask(scrapeId, { intent: { role: intent.role, location: intent.location, sites: intent.sites } });
    console.log(`\n🕵️  Scraping: "${intent.role}" | ${intent.location} | ${intent.sites.join(", ")} | max ${intent.maxPerSite}/site`);

    const result = await scrapeJobs({
      role: intent.role,
      location: intent.location,
      sites: intent.sites,
      maxPerSite: intent.maxPerSite,
      cdp: cdpUrl,
    });

    updateScrapeTask(scrapeId, { status: "completed", result });
    console.log(`\n✅ Job scrape [${scrapeId}] done — ${result.totalFound} listings found.`);
  } catch (err: any) {
    const msg = err?.message || String(err);
    updateScrapeTask(scrapeId, { status: "failed", error: msg });
    console.error(`\n❌ Job scrape [${scrapeId}] failed: ${msg}`);
  }
}

// ─── Job Scrape Routes ────────────────────────────────────────────────────────

/**
 * POST /api/scrape/jobs
 * Body: { "role": "Full Stack Developer", "location": "Remote", "sites": ["linkedin","indeed"], "maxPerSite": 10, "cdpUrl": "..." }
 *   OR: { "prompt": "scrape full stack jobs in Bangalore" }
 */
app.post("/api/scrape/jobs", (req, res) => {
  const { prompt, role, location, sites, maxPerSite, cdpUrl } = req.body || {};

  if (!prompt && !role) {
    return res.status(400).json({
      ok: false,
      error: 'Provide either "prompt" (natural language) or "role" (job title)',
    });
  }

  const scrapeId = randomUUID();
  const now = new Date().toISOString();
  const userPrompt = prompt || `scrape ${role} jobs${location ? " in " + location : ""}`;

  scrapeJobs_store.set(scrapeId, {
    scrapeId,
    prompt: userPrompt,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  console.log(`\n📥 Job scrape queued [${scrapeId}]: "${userPrompt}"\n`);
  runJobScrape(scrapeId, userPrompt, cdpUrl).catch(() => {});

  return res.json({ ok: true, scrapeId, pollUrl: `/api/scrape/jobs/${scrapeId}` });
});

/**
 * GET /api/scrape/jobs/:scrapeId
 * Returns status + results when complete.
 * Add ?slim=true for status-only (no job listings).
 */
app.get("/api/scrape/jobs/:scrapeId", (req, res) => {
  const { scrapeId } = req.params;
  const slim = req.query.slim === "true";
  const task = scrapeJobs_store.get(scrapeId);

  if (!task) return res.status(404).json({ ok: false, error: "Scrape job not found" });

  if (slim) {
    return res.json({
      scrapeId: task.scrapeId,
      status: task.status,
      intent: task.intent,
      totalFound: task.result?.totalFound ?? 0,
      error: task.error,
      updatedAt: task.updatedAt,
    });
  }

  return res.json({
    ok: true,
    scrapeId: task.scrapeId,
    status: task.status,
    prompt: task.prompt,
    intent: task.intent,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    error: task.error,
    result: task.result ?? null,
  });
});

/**
 * GET /api/scrape/jobs
 * List all scrape jobs (most recent first).
 */
app.get("/api/scrape/jobs", (_req, res) => {
  const list = Array.from(scrapeJobs_store.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((t) => ({
      scrapeId: t.scrapeId,
      status: t.status,
      prompt: t.prompt,
      intent: t.intent,
      totalFound: t.result?.totalFound ?? 0,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  return res.json({ ok: true, total: list.length, scrapes: list });
});

// ─── Meeting Routes ───────────────────────────────────────────────────────────

/**
 * POST /api/meetings
 * Body: { "prompt": "schedule a zoom call tomorrow at 3pm with bob@example.com" }
 *   OR: { "prompt": "create a google meet standup Friday 10am", "cdpUrl": "..." }
 */
app.post("/api/meetings", async (req, res) => {
  const { prompt } = req.body || {};

  if (!prompt || typeof prompt !== "string" || prompt.trim().length < 5) {
    return res.status(400).json({ ok: false, error: "prompt must be at least 5 characters" });
  }

  try {
    const result = await scheduleMeeting(prompt.trim());
    console.log(`\n✅ Meeting created: ${result.meetUrl}`);
    return res.json({ ok: true, result });
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(`\n❌ Meeting creation failed: ${msg}`);
    return res.status(500).json({ ok: false, error: msg });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`\n✅ Generic Agent API on http://localhost:${PORT}`);
  console.log(`   WhatsApp    : POST /api/whatsapp`);
  console.log(`   Meetings    : POST /api/meetings`);
  console.log(`   Job scraping: POST /api/scrape/jobs | GET /api/scrape/jobs/:id`);
  console.log(`   Tasks       : POST /api/tasks | GET /api/tasks/:id`);
  console.log(`   Supports any website — Amazon, Flipkart, Gmail, Twitter, WhatsApp, GitHub, LinkedIn, etc.\n`);
});