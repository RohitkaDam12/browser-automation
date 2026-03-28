// src/api.ts
import OpenAI from "openai";
import { runPlan } from "../executor";
import {
  chaicodeSelectors,
  mergeSelectorMaps,
  type SelectorMap,
} from "../selectors";
import { verifyWithVision } from "../verifier";
import { screenshotBase64 } from "../vision";
import { generatePlanFromPrompt } from "../llmPlanner";
import { twitterSelectors } from "../x/selectors.twitter";

const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const site = "https://ui.chaicode.com";
const DEFAULT_CDP = process.env.CHROME_CDP || "http://127.0.0.1:9333";

const dataDefault = {
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

export async function apiChaicodeSignup(cdp?: string) {
  const { chromium } = await import("playwright");
  const preBrowser = await chromium.launch({ headless: true });
  const preContext = await preBrowser.newContext({ viewport: { width: 1600, height: 1000 } });
  const prePage = await preContext.newPage();
  await prePage.goto(`${site}/auth/signup`, { waitUntil: "domcontentloaded" });
  const shot = await screenshotBase64(prePage);
  await preContext.close();
  await preBrowser.close();

  const verify = await verifyWithVision({
    site,
    userPrompt: "Verify signup and propose selectors",
    base64Png: shot.b64,
    selectorKeys: [
      "auth_menu","signup_menu","full_name","first_name","last_name",
      "email","password","confirm_password","submit"
    ],
    currentSelectorMap: chaicodeSelectors,
  });

  const merged: SelectorMap = mergeSelectorMaps(
    chaicodeSelectors,
    verify.suggestedSelectors as any
  );

  await runPlan(
    {
      meta: { site, goal: "Signup flow from API" },
      steps: signupSteps as any,
    },
    merged,
    { ...dataDefault },
    {
      headless: false,
      slowMo: 1000,
      stepDelayMs: 800,
      viewport: { width: 1600, height: 1000 },
      keepOpenMs: 15000,
      screenshotMode: "element",
      screenshotSettleMs: 140,
      disableAnimations: true,
      enableTracing: false,
      enableHighlight: true,
      humanTyping: true,
      typingDelayMs: 120,
      connectWsEndpoint: cdp || DEFAULT_CDP,
    }
  );
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
  let text = (resp as any).output_text || "";
  text = text.replace(/#\w+/g, "").replace(/@\w+/g, "").trim();
  return text.slice(0, 240);
}

export async function apiTwitterPost(prompt: string, cdp?: string) {
  const crafted = await generateTweetText(prompt);
  const logicalKeys = ["compose_entry", "tweet_textarea", "tweet_submit"];

  const plan = await generatePlanFromPrompt({
    site: "https://twitter.com",
    userPrompt: `Open composer and publish this tweet: ${crafted}`,
    logicalKeys,
    allowedValueKeys: ["tweet"],
  });

  if (!plan.steps.some((s) => s.type === "navigate")) {
    (plan as any).steps.unshift({ type: "navigate", url: "https://twitter.com/compose/tweet" });
  } else {
    (plan as any).steps = (plan as any).steps.map((s: any) =>
      s.type === "navigate" ? { ...s, url: "https://twitter.com/compose/tweet" } : s
    );
  }

  await runPlan(
    plan as any,
    twitterSelectors,
    { tweet: crafted },
    {
      headless: false,
      slowMo: 800,
      stepDelayMs: 600,
      viewport: { width: 1400, height: 900 },
      keepOpenMs: 12000,
      screenshotMode: "element",
      screenshotSettleMs: 120,
      disableAnimations: true,
      enableTracing: false,
      enableHighlight: true,
      humanTyping: true,
      typingDelayMs: 110,
      connectWsEndpoint: cdp || DEFAULT_CDP,
    }
  );
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

export async function apiGmailSend(
  to: string,
  subject: string,
  body: string,
  cdp?: string
) {
  const plan = {
    meta: { site: "https://mail.google.com", goal: "Compose & send Gmail" },
    steps: [
      { type: "navigate", url: "https://mail.google.com/mail/u/0/#inbox" },
      { type: "waitFor", selector: "compose_button", state: "visible", timeout: 30000 },
      { type: "click", selector: "compose_button" },
      { type: "waitFor", selector: "to_field", state: "visible", timeout: 30000 },
      { type: "fill", selector: "to_field", valueKey: "to" },
      { type: "fill", selector: "subject_field", valueKey: "subject" },
      { type: "fill", selector: "body_area", valueKey: "body" },
      { type: "click", selector: "send_button" },
    ] as any,
  };

  await runPlan(
    plan as any,
    gmailSelectors,
    { to, subject, body },
    {
      headless: false,
      slowMo: 600,
      stepDelayMs: 500,
      viewport: { width: 1400, height: 900 },
      keepOpenMs: 12000,
      screenshotMode: "element",
      screenshotSettleMs: 120,
      disableAnimations: true,
      enableTracing: false,
      enableHighlight: true,
      humanTyping: true,
      typingDelayMs: 90,
      connectWsEndpoint: cdp || DEFAULT_CDP,
    }
  );
}