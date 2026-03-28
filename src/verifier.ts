import OpenAI from "openai";
import { z } from "zod";
import { config } from "dotenv";
config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/** Tolerant shapes */
const LooseStepObj = z.object({
  type: z.enum(["navigate","waitFor","fill","click","press","waitNetworkIdle"]),
  url: z.string().optional(),
  selector: z.string().optional(),
  state: z.enum(["visible","attached","hidden","detached"]).optional(),
  valueKey: z.string().optional(),
  key: z.string().optional(),
  timeout: z.number().nullable().optional(),
});

const VerifyLoose = z.object({
  onExpectedScreen: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0),
  reason: z.string().default(""),
  
  suggestedSelectors: z
    .record(z.union([z.array(z.string()), z.string(), z.null(), z.undefined()]))
    .default({}),
  
  nextSteps: z.array(z.union([LooseStepObj, z.string()])).default([]),
});

export type VerifyResult = {
  onExpectedScreen: boolean;
  confidence: number;
  reason: string;
  suggestedSelectors: Record<string, string[]>;
  nextSteps: Array<{
    type: "navigate"|"waitFor"|"fill"|"click"|"press"|"waitNetworkIdle";
    url?: string;
    selector?: string;
    state?: "visible"|"attached"|"hidden"|"detached";
    valueKey?: string;
    key?: string;
    timeout?: number|null;
  }>;
};

function tryParseLooseStep(str: string): VerifyResult["nextSteps"][number] | null {
  const s = str.trim().toLowerCase();
  const urlMatch = s.match(/\b(https?:\/\/[^\s'"]+)/);

  if (s.startsWith("nav") || s.includes("navigate") || s.includes("go to") || s.includes("open")) {
    if (urlMatch) return { type: "navigate", url: urlMatch[1] };
  }
  if (s.includes("click") && (s.includes("submit") || s.includes("sign up") || s.includes("register"))) {
    return { type: "click", selector: "submit" };
  }
  if (s.includes("wait") && s.includes("idle")) {
    return { type: "waitNetworkIdle", timeout: null };
  }
  if (s.startsWith("fill") || s.includes("type")) {
    if (s.includes("email")) return { type: "fill", selector: "email", valueKey: "email" };
    if (s.includes("password") && !s.includes("confirm")) return { type: "fill", selector: "password", valueKey: "password" };
    if (s.includes("confirm")) return { type: "fill", selector: "confirm_password", valueKey: "confirm_password" };
    if (s.includes("name")) return { type: "fill", selector: "full_name", valueKey: "full_name" };
  }
  if (s.includes("wait") && s.includes("visible")) {
    if (s.includes("email")) return { type: "waitFor", selector: "email", state: "visible", timeout: null };
    if (s.includes("password") && !s.includes("confirm")) return { type: "waitFor", selector: "password", state: "visible", timeout: null };
    if (s.includes("confirm")) return { type: "waitFor", selector: "confirm_password", state: "visible", timeout: null };
    if (s.includes("name")) return { type: "waitFor", selector: "full_name", state: "visible", timeout: null };
    if (s.includes("submit")) return { type: "waitFor", selector: "submit", state: "visible", timeout: null };
  }
  return null;
}

function normalizeVerify(loose: z.infer<typeof VerifyLoose>): VerifyResult {
  const map: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(loose.suggestedSelectors)) {
    if (Array.isArray(v)) {
      if (v.length > 0) map[k] = v;
    } else if (typeof v === "string") {
      const s = v.trim();
      if (s) map[k] = [s];
    }
    
  }

  const steps: VerifyResult["nextSteps"] = [];
  for (const item of loose.nextSteps) {
    if (typeof item === "string") {
      const parsed = tryParseLooseStep(item);
      if (parsed) steps.push(parsed);
    } else {
      steps.push(item);
    }
  }

  return {
    onExpectedScreen: !!loose.onExpectedScreen,
    confidence: loose.confidence ?? 0,
    reason: loose.reason ?? "",
    suggestedSelectors: map,
    nextSteps: steps,
  };
}

type RunVerifyArgs = {
  site: string;
  userPrompt: string;
  base64Png: string;              // screenshot
  selectorKeys: string[];         // logical keys
  currentSelectorMap?: Record<string,string[]>;
};

export async function verifyWithVision(args: RunVerifyArgs): Promise<VerifyResult> {
  const { site, userPrompt, base64Png, selectorKeys, currentSelectorMap } = args;

  const system = `
You are a READ-ONLY UI verifier and selector proposer.
Given a screenshot (PNG) and context:
1) Say if this is the EXPECTED screen.
2) Propose robust Playwright selector candidates for the given keys.
   Prefer: labels, roles, placeholders, name/id, data-testid. Avoid nth-child/XPath.
3) Optionally propose a few next micro-steps (as structured objects).

Constraints:
- Same-origin only: ${site}
- Return STRICT JSON object only.
`.trim();

  const user = [
    {
      type: "input_text",
      text:
        `PROMPT:\n${userPrompt}\n\n` +
        `RELEVANT KEYS:\n${selectorKeys.join(", ")}\n\n` +
        `CURRENT SELECTORS:\n${JSON.stringify(currentSelectorMap ?? {}, null, 2)}\n`
    },
    {
      type: "input_image",
      image_url: `data:image/png;base64,${base64Png}`,
      detail: "low" as const
    }
  ] as const;

  const res = await openai.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: user as any }
    ],
    text: { format: { type: "json_object" } }
  });

  const raw = JSON.parse(res.output_text || "{}");
  const loose = VerifyLoose.parse(raw);
  return normalizeVerify(loose);
}