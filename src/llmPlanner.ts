// src/llmPlanner.ts
import OpenAI from "openai";

export type FlatStep = {
  type: "navigate" | "waitFor" | "fill" | "click" | "press" | "waitNetworkIdle";
  url: string | null;
  selector: string | null;     
  state: "visible" | "attached" | "hidden" | "detached" | null;
  valueKey: string | null;     
  key: string | null;          
  timeout: number | null;     
};

export type LlmPlan = {
  meta: { site: string; goal: string };
  steps: FlatStep[];
};

const stepSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: {
      type: "string",
      enum: ["navigate","waitFor","fill","click","press","waitNetworkIdle"]
    },
    url: { type: ["string","null"] },
    selector: { type: ["string","null"] },
    state: {
      type: ["string","null"],
      enum: ["visible","attached","hidden","detached", null]
    },
    valueKey: { type: ["string","null"] },
    key: { type: ["string","null"] },
    timeout: { type: ["number","null"] }
  },
  required: ["type","url","selector","state","valueKey","key","timeout"]
} as const;

const planSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    meta: {
      type: "object",
      additionalProperties: false,
      properties: {
        site: { type: "string" },
        goal: { type: "string" }
      },
      required: ["site","goal"]
    },
    steps: {
      type: "array",
      items: stepSchema,
      minItems: 1
    }
  },
  required: ["meta","steps"]
} as const;

export async function generatePlanFromPrompt(opts: {
  apiKey?: string;
  model?: string;
  site: string;
  userPrompt: string;
  logicalKeys: string[];   
  allowedValueKeys: string[]; 
}): Promise<LlmPlan> {
  const client = new OpenAI({ apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY! });
  const model = opts.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  const system = `
You are a browser automation planner. Output a JSON plan that a deterministic executor can run.

Rules:
- All steps must be safe for origin: ${opts.site}
- Use only these logical selector keys when a selector is needed:
  ${opts.logicalKeys.map(k => `- ${k}`).join("\n")}
- Use only these value keys for fills/presses:
  ${opts.allowedValueKeys.map(k => `- ${k}`).join("\n")}
- Shape for each step is FIXED (all fields present; use null when not applicable):
  {
    "type": "navigate" | "waitFor" | "fill" | "click" | "press" | "waitNetworkIdle",
    "url": string|null,
    "selector": string|null,
    "state": "visible"|"attached"|"hidden"|"detached"|null,
    "valueKey": string|null,
    "key": string|null,
    "timeout": number|null
  }
Examples:
- navigate: {"type":"navigate","url":"https://example.com","selector":null,"state":null,"valueKey":null,"key":null,"timeout":null}
- wait for visible: {"type":"waitFor","url":null,"selector":"otp_input","state":"visible","valueKey":null,"key":null,"timeout":15000}
- fill: {"type":"fill","url":null,"selector":"otp_input","state":null,"valueKey":"otp","key":null,"timeout":null}
- click: {"type":"click","url":null,"selector":"verify_button","state":null,"valueKey":null,"key":null,"timeout":null}
- press: {"type":"press","url":null,"selector":"otp_input","state":null,"valueKey":null,"key":"Enter","timeout":null}
- waitNetworkIdle: {"type":"waitNetworkIdle","url":null,"selector":null,"state":null,"valueKey":null,"key":null,"timeout":null}
`.trim();

  const user = `
Site: ${opts.site}
Instruction: ${opts.userPrompt}

Important:
- Do NOT invent new selector keys beyond the provided list.
- Prefer minimal, robust steps.
- If the path requires opening the sidebar item "Authentication" to reveal a sublink (like "Verify OTP"), add an idempotent sequence:
  waitFor "auth_menu" visible -> click "auth_menu" -> waitFor target item visible -> click target item.
`.trim();

  const res = await client.responses.create({
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "browser_plan",
        schema: planSchema as any
      }
    }
  });

  const raw = JSON.parse(res.output_text || "{}");
  
  if (!raw?.meta || !Array.isArray(raw?.steps)) {
    throw new Error("Planner returned invalid structure.");
  }
  
  raw.steps = raw.steps.map((s: any) => ({
    type: s.type,
    url: s.url ?? null,
    selector: s.selector ?? null,
    state: s.state ?? null,
    valueKey: s.valueKey ?? null,
    key: s.key ?? null,
    timeout: s.timeout ?? null
  }));
  return raw as LlmPlan;
}