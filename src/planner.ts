// src/planner.ts
import OpenAI from "openai";
import { config } from "dotenv";
import { Plan } from "./actions";

config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type MakePlanArgs = {
  goal: string;
  site: string;
  logicalFields: string[];
  allowedValueKeys: string[];
};

export async function makePlan(args: MakePlanArgs) {
  const { goal, site, logicalFields, allowedValueKeys } = args;

  const system = `
You are a cautious planner. Produce a minimal, safe, deterministic plan as STRICT JSON only.
Rules:
- Use ONLY these logical selectors: ${logicalFields.join(", ")}.
- For filling inputs, NEVER put raw values; use a "valueKey" from: ${allowedValueKeys.join(", ")}.
- Do not invent URLs outside ${site}.
- Keep steps <= 20. Prefer: navigate -> waitFor -> fill -> click -> waitNetworkIdle.
- Output ONLY JSON. No prose.
- For fields like "timeout" that may be unused, set them explicitly to null.
`.trim();

  const example = {
    meta: { site, goal: "Example only" },
    steps: [
      { type: "navigate", url: `${site}` },
      { type: "waitFor", selector: "auth_link", state: "visible", timeout: null },
      { type: "click", selector: "auth_link" },
      { type: "waitFor", selector: "signup_link", state: "visible", timeout: null },
      { type: "click", selector: "signup_link" },
      { type: "waitFor", selector: "full_name", state: "visible", timeout: null },
      { type: "fill", selector: "full_name", valueKey: "full_name" },
      { type: "fill", selector: "email", valueKey: "email" },
      { type: "fill", selector: "password", valueKey: "password" },
      { type: "waitFor", selector: "submit", state: "visible", timeout: null },
      { type: "click", selector: "submit" },
      { type: "waitNetworkIdle", timeout: null }
    ]
  };

  const res = await openai.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `Goal: ${goal}\nSite: ${site}\n` +
          `Return JSON ONLY matching keys shown below. Use "timeout": null when not needed.\n` +
          `Example JSON:\n` + JSON.stringify(example, null, 2)
      }
    ],
    text: { format: { type: "json_object" } }
  });

  const json = res.output_text;
  const parsed = JSON.parse(json);
  return Plan.parse(parsed);
}