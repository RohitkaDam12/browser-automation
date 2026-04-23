// src/whatsapp/whatsappIntentParser.ts
import OpenAI from "openai";

export type WhatsAppIntent = {
  /** Display name of the contact as it appears in WhatsApp, e.g. "Mom", "John Doe" */
  contactName: string;
  /** Phone number with country code if provided, e.g. "+919876543210". Empty string if not given. */
  phoneNumber: string;
  /** The exact message text to send */
  message: string;
  /** Human-readable goal for logging */
  goal: string;
};

const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM = `
You are an intent extractor for a WhatsApp Web automation agent.

Given a natural language instruction, extract a structured JSON object.

Return STRICT JSON only. No prose, no markdown, no code fences.

Output shape:
{
  "contactName": "<name of the person/group to message, as they would appear in WhatsApp contacts>",
  "phoneNumber": "<phone number with country code if mentioned, otherwise empty string>",
  "message": "<the exact message to send — generate a natural, complete message if the user only gave a topic or partial content>",
  "goal": "<short human-readable goal, e.g. 'Send birthday wish to Rahul'>"
}

Rules:
- "contactName": extract the recipient's name from the instruction. If a phone number is given instead of a name, set contactName to the formatted number (e.g. "+919876543210") and also set phoneNumber.
- "phoneNumber": only set if the user explicitly provided a number. Always include country code. Strip spaces and dashes.
- "message": if the user provided the full message text (often in quotes), use it exactly. If the user only described what to say (e.g. "wish him happy birthday"), compose a warm, natural, complete message appropriate to the context. Keep it under 500 characters.
- Never invent a recipient — if no recipient is mentioned, set contactName to "MISSING" so the caller can ask for clarification.
- Today's date: ${new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

Examples:
  "send a message to Rahul saying I'll be late by 30 minutes"
  → { "contactName": "Rahul", "phoneNumber": "", "message": "Hey, I'll be late by 30 minutes. Sorry for the inconvenience!", "goal": "Send delay notification to Rahul" }

  "WhatsApp Mom that I reached safely"
  → { "contactName": "Mom", "phoneNumber": "", "message": "Hi Mom! Just letting you know I've reached safely. 😊", "goal": "Send safe arrival message to Mom" }

  "send a message to +919876543210 asking if they're free tomorrow"
  → { "contactName": "+919876543210", "phoneNumber": "+919876543210", "message": "Hey! Are you free tomorrow?", "goal": "Ask +919876543210 about availability tomorrow" }

  "wish Priya happy birthday on WhatsApp"
  → { "contactName": "Priya", "phoneNumber": "", "message": "Happy Birthday Priya! 🎂 Wishing you a wonderful day filled with joy and happiness!", "goal": "Send birthday wish to Priya" }
`.trim();

export async function parseWhatsAppIntent(userPrompt: string): Promise<WhatsAppIntent> {
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

  const contactName = (parsed.contactName || "").trim();
  const phoneNumber = (parsed.phoneNumber || "").trim().replace(/[\s\-()]/g, "");
  const message = (parsed.message || "").trim();
  const goal = (parsed.goal || `Send WhatsApp message to ${contactName}`).trim();

  if (!contactName || contactName === "MISSING") {
    throw new Error("Could not determine the WhatsApp recipient from your request. Please mention who to message.");
  }
  if (!message) {
    throw new Error("Could not determine what message to send. Please describe the message content.");
  }

  return { contactName, phoneNumber, message, goal };
}

/**
 * Fast heuristic — detects WhatsApp messaging intent without an LLM call.
 * Used by the dispatcher for zero-latency routing.
 */
export function looksLikeWhatsAppRequest(prompt: string): boolean {
  const p = prompt.toLowerCase();
  const waWords = ["whatsapp", "whats app", "wa ", "wp "];
  const msgWords = ["message", "msg", "text", "send", "tell", "inform", "notify", "wish", "ping"];
  const hasWa = waWords.some((w) => p.includes(w));
  const hasMsg = msgWords.some((w) => p.includes(w));
  // "send a WhatsApp to..." or "WhatsApp Mom that..." or "message on WhatsApp..."
  return hasWa || (hasMsg && (p.includes("whatsapp") || p.includes("whats app")));
}