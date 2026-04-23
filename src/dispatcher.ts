// src/dispatcher.ts
import OpenAI from "openai";
import { chromium } from "playwright";
import { runPlan } from "./executor";
import { capturePerception } from "./perception";
import { exploreSuggest } from "./explorer";
import { verifyWithVision } from "./verifier";
import { screenshotBase64 } from "./vision";
import { generatePlanFromPrompt } from "./llmPlanner";
import { mergeSelectorMaps, type SelectorMap } from "./selectors";
import { twitterSelectors } from "./x/selectors.twitter";
import { sendWhatsAppMessage } from "./whatsapp/whatsappSender";
import { parseWhatsAppIntent, looksLikeWhatsAppRequest } from "./whatsapp/whatsappIntentParser";
import type { TaskIntent } from "./intentRouter";

const DEFAULT_CDP = process.env.CHROME_CDP || "http://127.0.0.1:9333";
const MAX_REPLAN_ATTEMPTS = 3;

// ─── Twitter / X detection ────────────────────────────────────────────────────

function isTwitterIntent(intent: TaskIntent): boolean {
  return /twitter\.com|x\.com/i.test(intent.site);
}

async function dispatchTwitter(intent: TaskIntent, cdp?: string): Promise<void> {
  console.log("🐦 Twitter/X intent detected — using dedicated Twitter flow");

  const runOpts = buildRunOpts(cdp);

  // Grab tweet text from dataBag (intentRouter puts it under various keys)
  const tweetText =
    intent.dataBag["tweet_text"] ||
    intent.dataBag["tweet"] ||
    intent.dataBag["post_text"] ||
    intent.dataBag["content"] ||
    // Fallback: ask LLM to generate one from the goal
    (await generateTweetTextFromGoal(intent.goal));

  console.log(`📝 Tweet text: "${tweetText}"`);

  const logicalKeys = ["compose_entry", "tweet_textarea", "tweet_submit"];
  const allowedValueKeys = ["tweet"];

  const plan = await generatePlanFromPrompt({
    site: "https://twitter.com",
    userPrompt: `Open the tweet composer and publish this exact tweet: ${tweetText}`,
    logicalKeys,
    allowedValueKeys,
  });

  // Always force navigate to compose URL directly — avoids login-wall timing issues
  if (!plan.steps.some((s) => s.type === "navigate")) {
    plan.steps.unshift({
      type: "navigate",
      url: "https://twitter.com/compose/tweet",
      selector: null,
      state: null,
      valueKey: null,
      key: null,
      timeout: null,
    });
  } else {
    plan.steps = plan.steps.map((s) =>
      s.type === "navigate" ? { ...s, url: "https://twitter.com/compose/tweet" } : s
    );
  }

  await runPlan(plan as any, twitterSelectors, { tweet: tweetText }, runOpts);
  console.log("✅ Tweet posted successfully.");
}

async function generateTweetTextFromGoal(goal: string): Promise<string> {
  const OpenAI = (await import("openai")).default;
  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resp = await oai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "Write ONE concise tweet (<=240 chars). Plain text only. No hashtags, no @mentions, no emojis, no quotes.",
      },
      {
        role: "user",
        content: `Topic: ${goal}\nConstraints: <=240 chars, plain text only.`,
      },
    ],
    max_output_tokens: 180,
  });
  let text = (resp as any).output_text || goal;
  text = text.replace(/#\w+/g, "").replace(/@\w+/g, "").trim();
  return text.slice(0, 240);
}

// ─── WhatsApp detection ───────────────────────────────────────────────────────

function isWhatsAppIntent(intent: TaskIntent): boolean {
  return (
    /web\.whatsapp\.com|whatsapp\.com/i.test(intent.site) ||
    looksLikeWhatsAppRequest(intent.prompt)
  );
}

async function dispatchWhatsApp(intent: TaskIntent, cdp?: string): Promise<void> {
  console.log("💬 WhatsApp intent detected — using dedicated WhatsApp flow");

  // Re-parse with the WhatsApp-specific intent parser for richer extraction
  // (intentRouter gives us a generic TaskIntent; whatsappIntentParser extracts
  //  contactName, phoneNumber, and message more precisely)
  const waIntent = await parseWhatsAppIntent(intent.prompt);

  // Merge any dataBag values the intentRouter already extracted
  if (!waIntent.phoneNumber && intent.dataBag["phone_number"]) {
    waIntent.phoneNumber = intent.dataBag["phone_number"];
  }
  if (intent.dataBag["contact_name"] && waIntent.contactName === "MISSING") {
    waIntent.contactName = intent.dataBag["contact_name"];
  }
  if (intent.dataBag["message"] && !waIntent.message) {
    waIntent.message = intent.dataBag["message"];
  }

  await sendWhatsAppMessage(waIntent, cdp);
  console.log("✅ WhatsApp message sent successfully.");
}

// ─── Shared run options ───────────────────────────────────────────────────────

function buildRunOpts(cdp?: string) {
  return {
    headless: false,
    slowMo: 800,
    stepDelayMs: 600,
    viewport: { width: 1600, height: 900 } as const,
    keepOpenMs: 12000,
    screenshotMode: "element" as const,
    screenshotSettleMs: 140,
    disableAnimations: true,
    enableTracing: false,
    enableHighlight: true,
    humanTyping: true,
    typingDelayMs: 100,
    connectWsEndpoint: cdp || DEFAULT_CDP,
  };
}

// ─── Step 1: Explore the page to discover selectors ──────────────────────────

async function discoverSelectors(
  site: string,
  startUrl: string,
  userPrompt: string,
  requiredKeys: string[]
): Promise<SelectorMap> {
  console.log("🔍 Exploring page to discover selectors...");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    const perception = await capturePerception(page);
    const shot = await screenshotBase64(page);
    await context.close();
    await browser.close();

    // Get selector suggestions from explorer LLM
    const explorerResult = await exploreSuggest({
      site,
      userPrompt,
      perception,
      requiredKeys,
    });

    // Also get vision-based selector suggestions
    const visionResult = await verifyWithVision({
      site,
      userPrompt,
      base64Png: shot.b64,
      selectorKeys: requiredKeys,
      currentSelectorMap: explorerResult.suggestedSelectors,
    });

    // Merge both sources — vision selectors take priority
    const merged = mergeSelectorMaps(
      explorerResult.suggestedSelectors,
      visionResult.suggestedSelectors as SelectorMap
    );

    console.log(`✅ Discovered selectors for keys: ${Object.keys(merged).join(", ")}`);
    return merged;

  } catch (err) {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    console.warn("⚠️  Selector discovery failed, will proceed with empty map:", err);
    return {};
  }
}

// ─── Step 2: LLM generates a plan using discovered selectors ─────────────────

async function buildPlan(intent: TaskIntent, selectorMap: SelectorMap) {
  console.log("🧠 Generating execution plan...");

  const logicalKeys = Object.keys(selectorMap).length > 0
    ? Object.keys(selectorMap)
    : inferLogicalKeys(intent.prompt); // fallback: infer from prompt

  const allowedValueKeys = Object.keys(intent.dataBag);

  const plan = await generatePlanFromPrompt({
    site: intent.site,
    userPrompt: intent.prompt,
    logicalKeys,
    allowedValueKeys,
  });

  // Always ensure we start with a navigate step
  if (!plan.steps.some((s) => s.type === "navigate")) {
    plan.steps.unshift({
      type: "navigate",
      url: intent.site,
      selector: null,
      state: null,
      valueKey: null,
      key: null,
      timeout: null,
    });
  }

  console.log(`✅ Plan generated: ${plan.steps.length} steps`);
  return plan;
}

// ─── Infer logical keys from the prompt when no selectors discovered ──────────

function inferLogicalKeys(prompt: string): string[] {
  const keys: string[] = [];
  const p = prompt.toLowerCase();

  // Navigation
  if (p.includes("search")) keys.push("search_input", "search_button");
  if (p.includes("login") || p.includes("sign in")) keys.push("email_input", "password_input", "login_button");
  if (p.includes("sign up") || p.includes("register")) keys.push("name_input", "email_input", "password_input", "confirm_password", "submit_button");

  // Email / Gmail
  if (p.includes("compose") || p.includes("email") || p.includes("mail")) {
    keys.push("compose_button", "to_field", "subject_field", "body_area", "send_button");
  }

  // Social
  if (p.includes("tweet") || p.includes("post") || p.includes("share")) {
    keys.push("compose_area", "post_button");
  }

  // WhatsApp
  if (p.includes("whatsapp") || p.includes("whats app") || p.includes("wa ")) {
    keys.push("search_box", "first_search_result", "message_input", "send_button");
  }

  // E-commerce
  if (p.includes("cart") || p.includes("add to cart") || p.includes("buy")) {
    keys.push("add_to_cart_button", "buy_now_button", "checkout_button");
  }
  if (p.includes("address")) keys.push("address_input", "city_input", "pincode_input");

  // Forms
  if (p.includes("form") || p.includes("fill")) {
    keys.push("form_input", "submit_button");
  }

  // Generic fallbacks
  if (keys.length === 0) {
    keys.push("main_action_button", "input_field", "submit_button");
  }

  return [...new Set(keys)];
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export async function dispatch(intent: TaskIntent, cdp?: string): Promise<void> {
  console.log(`\n🚀 Dispatching: "${intent.goal}"`);
  console.log(`   Site: ${intent.site}`);
  console.log(`   DataBag keys: ${Object.keys(intent.dataBag).join(", ") || "(none)"}\n`);

  // ── Twitter/X: dedicated flow, skip generic explore/plan pipeline ──────────
  if (isTwitterIntent(intent)) {
    return dispatchTwitter(intent, cdp);
  }

  // ── WhatsApp: dedicated flow, skip generic explore/plan pipeline ───────────
  if (isWhatsAppIntent(intent)) {
    return dispatchWhatsApp(intent, cdp);
  }

  const runOpts = buildRunOpts(cdp);

  // Step 1: Discover selectors by visiting the page
  const requiredKeys = inferLogicalKeys(intent.prompt);
  const selectorMap = await discoverSelectors(
    intent.site,
    intent.site,
    intent.prompt,
    requiredKeys
  );

  // Step 2: Generate plan
  const plan = await buildPlan(intent, selectorMap);

  // Step 3: Execute — with replan loop on failure
  let lastError: any;
  for (let attempt = 1; attempt <= MAX_REPLAN_ATTEMPTS; attempt++) {
    try {
      console.log(`\n▶️  Execution attempt ${attempt}/${MAX_REPLAN_ATTEMPTS}`);
      await runPlan(plan as any, selectorMap, intent.dataBag, runOpts);
      console.log("✅ Task completed successfully.");
      return;

    } catch (err: any) {
      lastError = err;
      console.warn(`⚠️  Attempt ${attempt} failed: ${err?.message}`);

      if (attempt < MAX_REPLAN_ATTEMPTS) {
        console.log("🔄 Replanning with updated selectors...");

        // Re-explore with failure context added to prompt
        const retryPrompt = `${intent.prompt}\n\nPrevious attempt failed at: ${err?.message}. Try alternative selectors or navigation paths.`;
        const freshSelectors = await discoverSelectors(
          intent.site,
          intent.site,
          retryPrompt,
          requiredKeys
        );

        const freshPlan = await buildPlan(
          { ...intent, prompt: retryPrompt },
          freshSelectors
        );

        Object.assign(plan, freshPlan);
        Object.assign(selectorMap, freshSelectors);
      }
    }
  }

  throw new Error(`Task failed after ${MAX_REPLAN_ATTEMPTS} attempts. Last error: ${lastError?.message}`);
}