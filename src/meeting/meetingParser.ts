// src/meeting/meetingParser.ts
import OpenAI from "openai";

export type MeetingPlatform = "google_meet" | "zoom";

export type MeetingIntent = {
  title: string;               // e.g. "Team Standup"
  platform: MeetingPlatform;   // google_meet | zoom
  startIso: string;            // ISO 8601, e.g. "2025-04-01T15:00:00"
  durationMinutes: number;     // default 60
  attendees: string[];         // email addresses
  description: string;         // optional agenda / notes
  timezone: string;            // e.g. "Asia/Kolkata"
};

const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM = `
You are a meeting scheduler assistant. Extract meeting details from a natural language instruction and return STRICT JSON only.

Today is: ${new Date().toISOString()}
Default timezone: Asia/Kolkata

Output shape:
{
  "title": "<meeting title, infer a sensible one if not given>",
  "platform": "google_meet" | "zoom",
  "startIso": "<ISO 8601 datetime, e.g. 2025-04-01T15:00:00>",
  "durationMinutes": <number, default 60>,
  "attendees": ["<email>", ...],
  "description": "<agenda or notes, empty string if none>",
  "timezone": "<IANA timezone, e.g. Asia/Kolkata, America/New_York>"
}

Rules:
- "platform": if user says "zoom" → "zoom". Otherwise → "google_meet".
- "startIso": parse relative times like "tomorrow at 3pm", "Friday 10am", "in 2 hours". 
  Use today's date as reference. Output LOCAL time (not UTC).
- "durationMinutes": if user says "30 min meeting" → 30. Default 60.
- "attendees": extract any email addresses mentioned. Empty array if none.
- "timezone": default "Asia/Kolkata" unless user specifies a city/country.
- "title": infer from context. "standup" → "Daily Standup", "sync" → "Team Sync", etc.

Examples:
  "schedule a zoom call tomorrow at 3pm with alice@example.com for 30 mins"
  → { "title": "Zoom Call", "platform": "zoom", "startIso": "2025-04-01T15:00:00", "durationMinutes": 30, "attendees": ["alice@example.com"], "description": "", "timezone": "Asia/Kolkata" }

  "create a google meet for team standup on Friday at 10am"
  → { "title": "Team Standup", "platform": "google_meet", "startIso": "2025-04-04T10:00:00", "durationMinutes": 60, "attendees": [], "description": "", "timezone": "Asia/Kolkata" }
`.trim();

export async function parseMeetingIntent(userPrompt: string): Promise<MeetingIntent> {
  const resp = await oai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    text: { format: { type: "json_object" } },
    max_output_tokens: 400,
  });

  const parsed = JSON.parse(resp.output_text || "{}");

  // Validate & apply defaults
  if (!parsed.startIso) throw new Error("Could not parse a meeting time from your request.");

  return {
    title: parsed.title || "Meeting",
    platform: parsed.platform === "zoom" ? "zoom" : "google_meet",
    startIso: parsed.startIso,
    durationMinutes: Math.max(15, Math.min(480, Number(parsed.durationMinutes) || 60)),
    attendees: Array.isArray(parsed.attendees) ? parsed.attendees.filter((e: any) => typeof e === "string" && e.includes("@")) : [],
    description: parsed.description || "",
    timezone: parsed.timezone || "Asia/Kolkata",
  };
}

/**
 * Fast heuristic to detect meeting scheduling intent without calling LLM.
 */
export function looksLikeMeetingRequest(prompt: string): boolean {
  const p = prompt.toLowerCase();
  const meetingWords = ["meeting", "meet", "call", "standup", "sync", "interview", "zoom", "google meet", "schedule a", "set up a", "create a", "book a"];
  const timeWords = ["at ", "tomorrow", "today", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "am", "pm", "o'clock", "in 1 hour", "in 2 hour", "next week"];
  const hasMeeting = meetingWords.some((w) => p.includes(w));
  const hasTime = timeWords.some((w) => p.includes(w));
  return hasMeeting && hasTime;
}