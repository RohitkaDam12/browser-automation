// src/explorer.ts
import OpenAI from "openai";
import { z } from "zod";
import { config } from "dotenv";
import type { Perception } from "./perception";

config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });


const NavSuggestionLoose = z.union([
  z.object({
    url: z.string(),
    reason: z.string().default("")
  }),
  z.string()
]);

const SuggestedSelectorsLoose = z.record(
  z.union([
    z.array(z.string()).min(1),
    z.string() // allow single string, we’ll wrap
  ])
);

const ExplorerLoose = z.object({
  suggestedSelectors: SuggestedSelectorsLoose,
  navSuggestions: z.array(NavSuggestionLoose).max(5).default([])
});

export type ExplorerOutput = {
  suggestedSelectors: Record<string, string[]>;
  navSuggestions: { url: string; reason: string }[];
};

function normalizeExplorer(loose: z.infer<typeof ExplorerLoose>): ExplorerOutput {
  const out: ExplorerOutput = {
    suggestedSelectors: {},
    navSuggestions: []
  };

  // normalize selector map -> arrays
  for (const [key, val] of Object.entries(loose.suggestedSelectors)) {
    out.suggestedSelectors[key] = Array.isArray(val) ? val : [val];
  }

  // normalize navSuggestions
  out.navSuggestions = loose.navSuggestions.map((item) => {
    if (typeof item === "string") {
      return { url: item, reason: "" };
    }
    return { url: item.url, reason: item.reason ?? "" };
  });

  return out;
}

type ExploreArgs = {
  site: string;
  userPrompt: string;
  perception: Perception;
  requiredKeys: string[];
};

export async function exploreSuggest(args: ExploreArgs): Promise<ExplorerOutput> {
  const { site, userPrompt, perception, requiredKeys } = args;

  const system = `
You are a READ-ONLY web explorer. You do NOT click or type.
Analyze the page perception and propose:
1) suggestedSelectors: map logical keys to an ordered list of robust selector candidates.
   - Prefer labels, roles (role=button[name=/.../i]), placeholders, name/id, data-testid.
   - Avoid nth-child and brittle XPaths.
   - Return candidates as strings like: "label=/Email/i", "role=button[name=/Sign up/i]", "placeholder=Full Name", "css=input[name='email']".
2) navSuggestions: up to 3 same-origin URLs (${site}) with a short reason.
Return STRICT JSON.
`.trim();

  const inputPayload = {
    role: "user",
    content:
      `USER PROMPT:\n${userPrompt}\n\n` +
      `REQUIRED LOGICAL KEYS:\n${requiredKeys.join(", ")}\n\n` +
      `CURRENT PERCEPTION (JSON):\n` +
      JSON.stringify(perception, null, 2)
  } as const;

  const res = await openai.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      inputPayload
    ],
    text: { format: { type: "json_object" } }
  });

  const rawObj = JSON.parse(res.output_text || "{}");

  const loose = ExplorerLoose.parse(rawObj);
  const normalized = normalizeExplorer(loose);

  try {
    const origin = new URL(site).origin;
    normalized.navSuggestions = normalized.navSuggestions.filter(s => {
      try { return new URL(s.url, origin).origin === origin; } catch { return false; }
    });
  } catch {  }

  return normalized;
}