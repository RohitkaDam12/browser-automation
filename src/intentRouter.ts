// src/intentRouter.ts
import OpenAI from "openai";

export type TaskIntent = {
  site: string;          // full origin e.g. "https://amazon.in"
  goal: string;          // human readable goal
  prompt: string;        // enriched, fully self-contained prompt for the planner
  dataBag: Record<string, string>; // key-value pairs the executor can fill into forms
};

const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM = `
You are an intent extractor for a generic browser automation agent.

Given a natural language instruction from a user, extract and enrich it into a structured JSON object.

Return STRICT JSON only. No prose, no markdown, no code fences.

Output shape:
{
  "site": "<full origin URL, e.g. https://amazon.in>",
  "goal": "<short human-readable goal>",
  "prompt": "<complete, fully self-contained automation instruction — include every detail: exact URL, all field values, what to click, what to fill, what to submit. Be explicit. The automation engine cannot ask follow-up questions.>",
  "dataBag": {
    "<key>": "<value>"
  }
}

Rules:
- "site" must be a valid URL origin (include https://).
- If user says a website name like "amazon" or "flipkart", resolve it to the correct URL.
- "dataBag" should contain ALL dynamic values the user provided: emails, names, passwords, search queries, OTPs, addresses, messages, etc. Use short snake_case keys.
- "prompt" should be a thorough, step-by-step description of what the agent should do.
- For email tasks: include recipient, subject, and full composed body in prompt and dataBag.
- For search tasks: include the exact search query.
- For form tasks: include all field values.
- For social posts: include the exact post text (generate a good one if user only gave a topic).
- For WhatsApp tasks: extract contact_name, phone_number (if given), and message into dataBag.
- Today's date: ${new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

Site resolution examples:
- "amazon" / "amazon.in" -> "https://www.amazon.in"
- "flipkart" -> "https://www.flipkart.com"
- "twitter" / "x.com" -> "https://twitter.com"
- "gmail" -> "https://mail.google.com"
- "youtube" -> "https://www.youtube.com"
- "github" -> "https://github.com"
- "linkedin" -> "https://www.linkedin.com"
- "whatsapp" / "wa" / "whatsapp web" -> "https://web.whatsapp.com"
`.trim();

export async function routeIntent(userPrompt: string): Promise<TaskIntent> {
  const resp = await oai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
    text: { format: { type: "json_object" } },
    max_output_tokens: 800,
  });

  const parsed = JSON.parse(resp.output_text || "{}");

  if (!parsed.site || !parsed.goal || !parsed.prompt) {
    throw new Error("Intent router returned incomplete data: " + JSON.stringify(parsed));
  }

  return {
    site: parsed.site,
    goal: parsed.goal,
    prompt: parsed.prompt,
    dataBag: parsed.dataBag || {},
  };
}