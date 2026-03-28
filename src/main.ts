import "./env";
import OpenAI from "openai";
import { runPlan } from "./executor";
import {
  chaicodeSelectors,
  mergeSelectorMaps,
  type SelectorMap,
} from "./selectors";
import { capturePerception } from "./perception";
import { exploreSuggest } from "./explorer";
import { verifyWithVision } from "./verifier";
import { screenshotBase64 } from "./vision";
import { generatePlanFromPrompt, type LlmPlan } from "./llmPlanner";
import { twitterSelectors } from "./x/selectors.twitter";

const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

const site = "https://ui.chaicode.com";
const DEFAULT_CDP = process.env.CHROME_CDP || "http://127.0.0.1:9333";

const data = {
  full_name: "Shubham Saini",
  first_name: "Shubham",
  last_name: "Saini",
  email: "shubham@example.com",
  password: "SuperSecret123!",
  confirm_password: "SuperSecret123!",
  otp: "234567",
};

const signupSteps = [
  { type: "navigate", url: site },
  { type: "waitFor", selector: "auth_menu", state: "visible", timeout: null },
  { type: "click", selector: "auth_menu" },
  { type: "waitFor", selector: "signup_menu", state: "visible", timeout: null },
  { type: "click", selector: "signup_menu" },
  { type: "waitFor", selector: "first_name", state: "visible", timeout: null },
  { type: "fill", selector: "full_name", valueKey: "full_name" },
  { type: "fill", selector: "email", valueKey: "email" },
  { type: "fill", selector: "password", valueKey: "password" },
  { type: "fill", selector: "confirm_password", valueKey: "confirm_password" },
  { type: "waitFor", selector: "submit", state: "visible", timeout: null },
  { type: "click", selector: "submit" },
  { type: "waitNetworkIdle", timeout: null },
] as const;

function extractOtp(prompt: string): string | undefined {
  const m = prompt.match(/\b(?:otp|code)\D*([0-9]{4,8})\b/i);
  return m?.[1];
}

function wantsTwitter(prompt: string) {
  return /(twitter|x\.com|\btweet\b|\bpost\b)/i.test(prompt);
}

function extractTweetText(prompt: string): string | undefined {
  const quoted = prompt.match(/["“”](.+?)["“”]/);
  if (quoted?.[1]) return quoted[1].trim();
  return undefined;
}

async function generateTweetText(userPrompt: string): Promise<string> {
  const year = new Date().getFullYear();
  const resp = await oai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: "Write ONE concise tweet (<=240 chars). Plain text only. No hashtags, no @mentions, no emojis, no quotes." },
      { role: "user", content: `Topic: ${userPrompt}\nConstraints: <=240 chars, plain text only, current for ${year}.` },
    ],
    max_output_tokens: 180,
  });
  let text = (resp as any).output_text;
  if (!text || !text.trim()) throw new Error("OpenAI returned empty output_text");
  text = text.replace(/#\w+/g, "").replace(/@\w+/g, "").trim();
  if (text.length > 240) text = text.slice(0, 240).trim();
  return text;
}

async function runAutoFlow(autoPrompt: string, cdp?: string) {
  console.log("🤖 Auto (vision) mode ON");
  const wantsSignup = /sign\s*up|create\s*account|register/i.test(autoPrompt);
  const otpFromPrompt = extractOtp(autoPrompt);
  if (otpFromPrompt) data.otp = otpFromPrompt;

  if (wantsSignup) {
    const plan = { meta: { site, goal: "Auto: navigate to Signup via UI and submit form" }, steps: signupSteps as any };
    await runPlan(plan, chaicodeSelectors, data, {
      headless: false,
      slowMo: 1200,
      stepDelayMs: 1000,
      viewport: { width: 1600, height: 1000 },
      keepOpenMs: 20000,
      screenshotMode: "element",
      screenshotSettleMs: 160,
      disableAnimations: true,
      enableTracing: false,
      enableHighlight: true,
      humanTyping: true,
      typingDelayMs: 120,
      connectWsEndpoint: cdp || DEFAULT_CDP,
    });
    return;
  }

  const logicalKeys = [
    "auth_menu",
    "signup_menu",
    "otp_menu",
    "full_name",
    "first_name",
    "last_name",
    "email",
    "password",
    "confirm_password",
    "otp_input",
    "submit",
    "verify_button",
  ];
  const allowedValueKeys = ["full_name", "first_name", "last_name", "email", "password", "confirm_password", "otp"];

  const plan = await generatePlanFromPrompt({ site, userPrompt: autoPrompt, logicalKeys, allowedValueKeys });
  const hasNavigate = plan.steps.some((s) => s.type === "navigate");
  if (!hasNavigate) {
    plan.steps.unshift({ type: "navigate", url: site, selector: null, state: null, valueKey: null, key: null, timeout: null });
  }

  await runPlan(plan as any, chaicodeSelectors, data, {
    headless: false,
    slowMo: 1200,
    stepDelayMs: 1000,
    viewport: { width: 1600, height: 1000 },
    keepOpenMs: 20000,
    screenshotMode: "element",
    screenshotSettleMs: 160,
    disableAnimations: true,
    enableTracing: false,
    enableHighlight: true,
    humanTyping: true,
    typingDelayMs: 120,
    connectWsEndpoint: cdp || DEFAULT_CDP,
  });
}

async function runExploreFlow(explorePrompt: string, cdp?: string) {
  console.log("🔎 Explore mode ON");

  const { chromium } = await import("playwright");
  const preBrowser = await chromium.launch({ headless: true, slowMo: 0 });
  const preContext = await preBrowser.newContext({ viewport: { width: 1600, height: 1000 } });
  const prePage = await preContext.newPage();
  await prePage.goto(`${site}/auth/signup`, { waitUntil: "domcontentloaded" });
  const perception = await capturePerception(prePage);
  await preContext.close();
  await preBrowser.close();

  const requiredKeys = [
    "auth_menu",
    "signup_menu",
    "full_name",
    "first_name",
    "last_name",
    "email",
    "password",
    "confirm_password",
    "submit",
    "otp_menu",
    "otp_input",
    "verify_button",
  ];
  const suggestions = await exploreSuggest({ site, userPrompt: explorePrompt, perception, requiredKeys });
  const suggestedMap: SelectorMap = {};
  for (const [k, v] of Object.entries(suggestions.suggestedSelectors)) suggestedMap[k] = v;
  const merged = mergeSelectorMaps(chaicodeSelectors, suggestedMap);

  const plan = { meta: { site, goal: "Explore: navigate to Signup via UI and submit form" }, steps: signupSteps as any };

  await runPlan(plan, merged, data, {
    headless: false,
    slowMo: 1200,
    stepDelayMs: 1000,
    viewport: { width: 1600, height: 1000 },
    keepOpenMs: 20000,
    screenshotMode: "both",
    screenshotSettleMs: 120,
    disableAnimations: true,
    enableTracing: false,
    enableHighlight: true,
    humanTyping: true,
    typingDelayMs: 120,
    connectWsEndpoint: cdp || DEFAULT_CDP,
  });
}

async function runFixedFlow(cdp?: string) {
  const plan = { meta: { site, goal: "Deterministic: navigate to Signup via UI and submit form" }, steps: signupSteps as any };
  await runPlan(plan, chaicodeSelectors, data, {
    headless: false,
    slowMo: 1200,
    stepDelayMs: 1000,
    viewport: { width: 1600, height: 1000 },
    keepOpenMs: 20000,
    screenshotMode: "both",
    screenshotSettleMs: 120,
    disableAnimations: true,
    enableTracing: false,
    enableHighlight: true,
    humanTyping: true,
    typingDelayMs: 120,
    connectWsEndpoint: cdp || DEFAULT_CDP,
  });
}

const gmailSelectors: SelectorMap = {
  compose_button: [
    'role=button[name=/compose/i]',
    'css=div[gh="cm"]',
    'text=/compose/i',
    'css=button[aria-label*="compose" i]',
  ],
  to_field: [
    'css=input[aria-label="To recipients"]',
    'role=combobox[name=/to/i]',
    'css=div[aria-label^="To"] input',
    'css=div[aria-label^="To"]',
    'css=input[aria-label="To"]',
    'css=textarea[name="to"]',
  ],
  subject_field: [
    'css=input[name="subjectbox"]',
    'role=textbox[name=/subject/i]',
  ],
  body_area: [
    'css=div[aria-label="Message Body"]',
    'css=div[role="textbox"][aria-label*="message body" i]',
  ],
  send_button: [
    'role=button[name=/send/i]',
    'css=div[role="button"][data-tooltip*="send" i]',
    'css=div[aria-label="Send ‪(⌘Enter)‬"]',
  ],
};

async function runGmailFlow(to: string, subject: string, body: string, cdp?: string) {
  const plan = {
    meta: { site: "https://mail.google.com", goal: "Compose & send Gmail" },
    steps: [
      { type: "navigate", url: "https://mail.google.com/mail/u/0/#inbox" },
      { type: "waitFor", selector: "compose_button", state: "visible", timeout: 20000 },
      { type: "click", selector: "compose_button" },
      { type: "waitFor", selector: "to_field", state: "visible", timeout: 30000 },
      { type: "fill", selector: "to_field", valueKey: "to" },
      { type: "fill", selector: "subject_field", valueKey: "subject" },
      { type: "fill", selector: "body_area", valueKey: "body" },
      { type: "click", selector: "send_button" },
    ] as any,
  };
  const bag = { to, subject, body };
  const opts: any = {
    headless: false,
    slowMo: 600,
    stepDelayMs: 500,
    viewport: { width: 1400, height: 900 },
    keepOpenMs: 12000,
    screenshotMode: "element",
    screenshotSettleMs: 140,
    disableAnimations: true,
    enableTracing: false,
    enableHighlight: true,
    humanTyping: true,
    typingDelayMs: 90,
    connectWsEndpoint: cdp || DEFAULT_CDP,
  };
  await runPlan(plan as any, gmailSelectors, bag, opts);
}

async function runAutoTwitterFlow(userPrompt: string, cdpOverride?: string) {
  const quoted = extractTweetText(userPrompt);
  const crafted = quoted ?? (await generateTweetText(userPrompt));
  const logicalKeys = ["compose_entry", "tweet_textarea", "tweet_submit"];
  const allowedValueKeys = ["tweet"];
  const plan = await generatePlanFromPrompt({
    site: "https://twitter.com",
    userPrompt: `Open composer and publish this tweet: ${crafted}`,
    logicalKeys,
    allowedValueKeys,
  });
  if (!plan.steps.some((s) => s.type === "navigate")) {
    plan.steps.unshift({ type: "navigate", url: "https://twitter.com/compose/tweet", selector: null, state: null, valueKey: null, key: null, timeout: null });
  } else {
    plan.steps = plan.steps.map((s) => (s.type === "navigate" && s.url ? { ...s, url: "https://twitter.com/compose/tweet" } : s));
  }
  const bag = { tweet: crafted };
  const opts: any = {
    headless: false,
    slowMo: 900,
    stepDelayMs: 600,
    viewport: { width: 1400, height: 900 },
    keepOpenMs: 15000,
    screenshotMode: "element",
    screenshotSettleMs: 140,
    disableAnimations: true,
    enableTracing: false,
    enableHighlight: true,
    humanTyping: true,
    typingDelayMs: 110,
    connectWsEndpoint: cdpOverride || DEFAULT_CDP,
  };
  await runPlan(plan as any, twitterSelectors, bag, opts);
}

async function main() {
  const autoPrompt = readArg("--auto");
  const explorePrompt = readArg("--explore");
  const twitterText = readArg("--twitter");
  const gmailTo = readArg("--gmail-to");
  const gmailSubject = readArg("--gmail-subject");
  const gmailBody = readArg("--gmail-body");
  const cdp = readArg("--cdp");

  if (gmailTo && gmailSubject && gmailBody) {
    await runGmailFlow(gmailTo, gmailSubject, gmailBody, cdp);
    return;
  }
  if (twitterText) {
    await runAutoTwitterFlow(twitterText, cdp);
    return;
  }
  if (autoPrompt && wantsTwitter(autoPrompt)) {
    await runAutoTwitterFlow(autoPrompt, cdp);
    return;
  }
  if (autoPrompt) {
    await runAutoFlow(autoPrompt, cdp);
    return;
  }
  if (explorePrompt) {
    await runExploreFlow(explorePrompt, cdp);
    return;
  }
  await runFixedFlow(cdp);
}

main().catch((err) => {
  console.error("Run failed:", err);
  process.exit(1);
});