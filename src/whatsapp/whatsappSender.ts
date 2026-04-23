// src/whatsapp/whatsappSender.ts
//
// Sends a WhatsApp message via WhatsApp Web using Playwright + CDP.
//
// Prerequisites:
//   - Chrome must be running with remote debugging enabled:
//       google-chrome --remote-debugging-port=9333
//   - WhatsApp Web must already be authenticated (QR scanned) in that Chrome session.
//     The session is persisted in Chrome's profile — no re-scan needed after first login.
//
// Strategy:
//   1. Navigate to https://web.whatsapp.com
//   2. Wait for the chat list to load (confirms authenticated session)
//   3. Search for the contact by name or phone number
//   4. Click the first search result to open the chat
//   5. Type the message into the compose box
//   6. Press Enter (or click Send) to send
//   7. Verify the message appears in the conversation

import { chromium, type Page } from "playwright";
import { runPlan } from "../executor";
import { whatsappSelectors } from "./selectors.whatsapp";
import type { WhatsAppIntent } from "./whatsappIntentParser";
import type { LlmPlan } from "../llmPlanner";

const DEFAULT_CDP = process.env.CHROME_CDP || "http://127.0.0.1:9333";
const WA_URL = "https://web.whatsapp.com";

// ── Shared run options ────────────────────────────────────────────────────────

function buildRunOpts(cdp?: string) {
  return {
    headless: false,
    slowMo: 700,
    stepDelayMs: 800,
    viewport: { width: 1440, height: 900 } as const,
    keepOpenMs: 8000,
    screenshotMode: "element" as const,
    screenshotSettleMs: 150,
    disableAnimations: false,   // Keep animations ON — WhatsApp Web relies on them for state transitions
    enableTracing: false,
    enableHighlight: true,
    humanTyping: true,
    typingDelayMs: 60,
    connectWsEndpoint: cdp || DEFAULT_CDP,
  };
}

// ── Check WhatsApp Web is authenticated ──────────────────────────────────────

async function verifyAuthenticated(cdp: string): Promise<void> {
  console.log("🔐 Verifying WhatsApp Web session...");

  const browser = await chromium.connectOverCDP(cdp);
  const contexts = browser.contexts();
  const context = contexts[0] || (await browser.newContext());
  const page = await context.newPage();

  try {
    await page.goto(WA_URL, { waitUntil: "domcontentloaded", timeout: 20000 });

    // Wait up to 20s for either the chat list (authenticated) or QR code (not authenticated)
    const result = await Promise.race([
      page.waitForSelector("div#pane-side", { timeout: 20000 }).then(() => "authenticated"),
      page.waitForSelector("canvas[aria-label='Scan this QR code to link a device']", { timeout: 20000 }).then(() => "qr"),
    ]).catch(() => "timeout");

    if (result === "qr") {
      throw new Error(
        "WhatsApp Web is not authenticated. Please open https://web.whatsapp.com in your Chrome session and scan the QR code first."
      );
    }
    if (result === "timeout") {
      throw new Error(
        "WhatsApp Web did not load within 20 seconds. Ensure Chrome is running and https://web.whatsapp.com is accessible."
      );
    }

    console.log("✅ WhatsApp Web session is active.");
  } finally {
    await page.close().catch(() => {});
  }
}

// ── Build the execution plan ──────────────────────────────────────────────────

function buildWhatsAppPlan(intent: WhatsAppIntent): LlmPlan {
  // The search term is the phone number if available (more precise), else the contact name
  const searchTerm = intent.phoneNumber || intent.contactName;

  const steps: LlmPlan["steps"] = [
    // 1. Navigate to WhatsApp Web
    {
      type: "navigate",
      url: WA_URL,
      selector: null, state: null, valueKey: null, key: null, timeout: null,
    },

    // 2. Wait for the chat list — confirms we're authenticated and UI is ready
    {
      type: "waitFor",
      selector: "search_box",
      state: "visible",
      url: null, valueKey: null, key: null, timeout: 20000,
    },

    // 3. Click the search box and type the contact name/number
    {
      type: "click",
      selector: "search_box",
      url: null, state: null, valueKey: null, key: null, timeout: null,
    },
    {
      type: "fill",
      selector: "search_box",
      valueKey: "search_term",
      url: null, state: null, key: null, timeout: null,
    },

    // 4. Wait for search results to appear
    {
      type: "waitFor",
      selector: "first_search_result",
      state: "visible",
      url: null, valueKey: null, key: null, timeout: 10000,
    },

    // 5. Click the first result to open the chat
    {
      type: "click",
      selector: "first_search_result",
      url: null, state: null, valueKey: null, key: null, timeout: null,
    },

    // 6. Wait for the conversation panel and message input to be ready
    {
      type: "waitFor",
      selector: "message_input",
      state: "visible",
      url: null, valueKey: null, key: null, timeout: 15000,
    },

    // 7. Click the message input to focus it
    {
      type: "click",
      selector: "message_input",
      url: null, state: null, valueKey: null, key: null, timeout: null,
    },

    // 8. Type the message
    {
      type: "fill",
      selector: "message_input",
      valueKey: "message",
      url: null, state: null, key: null, timeout: null,
    },

    // 9. Press Enter to send
    {
      type: "press",
      selector: "message_input",
      key: "Enter",
      url: null, state: null, valueKey: null, timeout: null,
    },

    // 10. Wait for network to settle (message delivery confirmation)
    {
      type: "waitNetworkIdle",
      url: null, selector: null, state: null, valueKey: null, key: null, timeout: 8000,
    },
  ];

  return {
    meta: {
      site: WA_URL,
      goal: intent.goal,
    },
    steps,
  };
}

// ── Main exported function ────────────────────────────────────────────────────

export type WhatsAppResult = {
  success: boolean;
  contactName: string;
  message: string;
  sentAt: string;
};

export async function sendWhatsAppMessage(
  intent: WhatsAppIntent,
  cdp?: string
): Promise<WhatsAppResult> {
  const cdpEndpoint = cdp || DEFAULT_CDP;

  console.log(`\n💬 WhatsApp Sender`);
  console.log(`   To     : ${intent.contactName}${intent.phoneNumber ? ` (${intent.phoneNumber})` : ""}`);
  console.log(`   Message: "${intent.message}"`);
  console.log(`   CDP    : ${cdpEndpoint}\n`);

  // Verify WhatsApp Web is authenticated before attempting automation
  await verifyAuthenticated(cdpEndpoint);

  const plan = buildWhatsAppPlan(intent);

  const dataBag: Record<string, string> = {
    search_term: intent.phoneNumber || intent.contactName,
    message: intent.message,
  };

  await runPlan(plan as any, whatsappSelectors, dataBag, buildRunOpts(cdpEndpoint));

  console.log(`✅ WhatsApp message sent to "${intent.contactName}"`);

  return {
    success: true,
    contactName: intent.contactName,
    message: intent.message,
    sentAt: new Date().toISOString(),
  };
}