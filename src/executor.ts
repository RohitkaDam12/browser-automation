// src/executor.ts
import { chromium, Page, Locator, BrowserContext } from "playwright";
import type { Plan } from "./actions";
import type { SelectorMap } from "./selectors";

export type FormDataBag = Record<string, string>;

type ScreenshotMode = "element" | "viewport" | "fullPage" | "both";

type RunOpts = {
  headless?: boolean;
  slowMo?: number;
  stepDelayMs?: number;
  viewport?: { width: number; height: number };
  keepOpen?: boolean;
  keepOpenMs?: number;
  screenshotMode?: ScreenshotMode;
  screenshotSettleMs?: number;
  disableAnimations?: boolean;
  enableTracing?: boolean;
  enableHighlight?: boolean;
  humanTyping?: boolean;
  typingDelayMs?: number;
  userDataDir?: string;
  channel?: "chrome" | "msedge";
  executablePath?: string;
  connectWsEndpoint?: string;
};

const highlightColors = [
  "rgba(255,0,0,.85)",
  "rgba(0,200,0,.85)",
  "rgba(0,0,255,.85)",
  "rgba(255,165,0,.85)",
  "rgba(128,0,128,.85)",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseMaybeRegex(value: string): string | RegExp {
  const m = value.match(/^\/(.+)\/(i)?$/);
  if (m) return new RegExp(m[1], m[2] ? "i" : undefined);
  return value;
}

function parseRoleCandidate(c: string): { role: string; name?: string | RegExp } | null {
  const m = c.match(/^role=([a-zA-Z]+)\s*(?:\[\s*name\s*=\s*(.+?)\s*\])?$/);
  if (!m) return null;
  const role = m[1];
  const nameRaw = m[2];
  const name = nameRaw ? parseMaybeRegex(nameRaw) : undefined;
  return { role, name };
}

function normalizeCandidate(raw: string): string {
  const c = raw.trim();
  const nameMatch = c.match(/^name\s*=\s*(.+)$/i);
  if (nameMatch) return `css=[name="${nameMatch[1].trim()}"]`;
  const idMatch = c.match(/^id\s*=\s*(.+)$/i);
  if (idMatch) return `css=#${idMatch[1].trim()}`;
  const testidMatch = c.match(/^(?:data-)?testid\s*=\s*(.+)$/i);
  if (testidMatch) return `css=[data-testid="${testidMatch[1].trim()}"]`;
  const ariaLabelMatch = c.match(/^aria-label\s*=\s*(.+)$/i);
  if (ariaLabelMatch) return `css=[aria-label="${ariaLabelMatch[1].trim()}"]`;
  return c;
}

async function getLocatorForCandidate(page: Page, rawCandidate: string): Promise<Locator> {
  const candidate = normalizeCandidate(rawCandidate);
  if (candidate.startsWith("label=")) {
    const val = candidate.slice("label=".length);
    return page.getByLabel(parseMaybeRegex(val) as any);
  }
  if (candidate.startsWith("placeholder=")) {
    const val = candidate.slice("placeholder=".length);
    return page.getByPlaceholder(parseMaybeRegex(val) as any);
  }
  if (candidate.startsWith("text=")) {
    const val = candidate.slice("text=".length);
    return page.getByText(parseMaybeRegex(val) as any);
  }
  if (candidate.startsWith("role=")) {
    const parsed = parseRoleCandidate(candidate);
    if (parsed) {
      return page.getByRole(parsed.role as any, parsed.name ? { name: parsed.name as any } : {});
    }
  }
  if (candidate.startsWith("css=")) {
    return page.locator(candidate.slice("css=".length));
  }
  return page.locator(candidate);
}

async function firstExistingLocator(page: Page, candidates: string[]): Promise<Locator | null> {
  for (const c of candidates) {
    try {
      const loc = await getLocatorForCandidate(page, c);
      if (await loc.count()) return loc.first();
    } catch {}
  }
  return null;
}

async function bestGroupLocator(page: Page, candidates: string[]): Promise<{ locator: Locator; count: number } | null> {
  let best: { locator: Locator; count: number } | null = null;
  for (const c of candidates) {
    try {
      const loc = await getLocatorForCandidate(page, c);
      const cnt = await loc.count();
      if (cnt > 0 && (!best || cnt > best.count)) best = { locator: loc, count: cnt };
    } catch {}
  }
  return best;
}

async function getLocator(page: Page, candidates: string[]): Promise<Locator> {
  const loc = await firstExistingLocator(page, candidates);
  if (loc) return loc;
  return getLocatorForCandidate(page, normalizeCandidate(candidates[0] ?? "UNKNOWN"));
}

async function overlayHighlight(page: Page, loc: Locator, stepIndex: number, enable: boolean) {
  if (!enable) return;
  const box = await loc.boundingBox();
  if (!box) return;
  const color = highlightColors[stepIndex % highlightColors.length];
  await page.evaluate(([b, colorArg]) => {
    const id = "__agent_overlay_highlight__";
    let el = document.getElementById(id) as HTMLDivElement | null;
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      Object.assign(el.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        border: `3px solid ${colorArg}`,
        borderRadius: "6px",
        boxShadow: `0 0 10px ${colorArg}`,
        transition: "opacity 0.2s ease",
        opacity: "1",
      } as CSSStyleDeclaration);
      document.body.appendChild(el);
    }
    Object.assign(el.style, {
      left: `${b.x}px`,
      top: `${b.y}px`,
      width: `${b.width}px`,
      height: `${b.height}px`,
      border: `3px solid ${colorArg}`,
      boxShadow: `0 0 10px ${colorArg}`,
      opacity: "1",
    } as CSSStyleDeclaration);
    setTimeout(() => {
      if (el) el.style.opacity = "0";
    }, 600);
  }, [box, color] as any);
}

function safeSlug(input?: string) {
  return input ? input.replace(/[^a-z0-9_-]+/gi, "_") : "";
}

async function snap(
  page: Page,
  stepIndex: number,
  actionType: string,
  selector?: string,
  loc?: Locator,
  mode: ScreenshotMode = "element",
  settleMs: number = 160
) {
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  const base = `step-${String(stepIndex + 1).padStart(2, "0")}-${actionType}${selector ? "-" + safeSlug(selector) : ""}`;
  if (mode === "element" || mode === "both") {
    if (loc) {
      const h = await loc.elementHandle();
      if (h) await h.scrollIntoViewIfNeeded();
      const p = `${base}-elem.png`;
      await loc.screenshot({ path: p });
      console.log(`   📸 saved ${p}`);
    } else {
      const p = `${base}-view.png`;
      await page.screenshot({ path: p, animations: "disabled", caret: "hide" });
      console.log(`   📸 saved ${p}`);
    }
  }
  if (mode === "viewport") {
    const p = `${base}-view.png`;
    await page.screenshot({ path: p, animations: "disabled", caret: "hide" });
    console.log(`   📸 saved ${p}`);
  }
  if (mode === "fullPage" || mode === "both") {
    const p = `${base}-full.png`;
    await page.screenshot({ path: p, fullPage: true, animations: "disabled", caret: "hide" });
    console.log(`   🖼️ saved ${p}`);
  }
}

async function holdPage(page: Page, ms: number) {
  if (ms <= 0) return;
  try {
    await Promise.race([
      page.waitForTimeout(ms),
      (async () => {
        try {
          await page.waitForEvent("close");
        } catch {}
      })(),
    ]);
  } catch {}
}

async function looksLikeOtpGroup(group: Locator): Promise<boolean> {
  const count = await group.count();
  if (count < 2 || count > 8) return false;
  return true;
}

async function openContextWithProfile(opts: RunOpts): Promise<{ browser?: any; context: BrowserContext }> {
  const viewport = opts.viewport ?? { width: 1600, height: 1000 };
  if (opts.connectWsEndpoint) {
    const browser = await chromium.connectOverCDP(opts.connectWsEndpoint);
    const contexts = browser.contexts();
    const context = contexts.length ? contexts[0] : await browser.newContext({ viewport });
    return { browser, context };
  }
  if (opts.userDataDir) {
    const context = await chromium.launchPersistentContext(opts.userDataDir, {
      headless: false,
      slowMo: opts.slowMo ?? 0,
      viewport,
      channel: opts.channel,
      executablePath: opts.executablePath,
      args: [`--window-size=${viewport.width},${viewport.height}`, "--disable-features=TranslateUI"],
    });
    return { context };
  }
  const browser = await chromium.launch({
    headless: opts.headless ?? true,
    slowMo: opts.slowMo ?? 0,
    channel: opts.channel,
    executablePath: opts.executablePath,
    args: [`--window-size=${viewport.width},${viewport.height}`],
  });
  const context = await browser.newContext({ viewport });
  return { browser, context };
}

export async function runPlan(plan: Plan, map: SelectorMap, data: FormDataBag, opts?: RunOpts) {
  const headless = opts?.headless ?? true;
  const slowMo = opts?.slowMo ?? (headless ? 0 : 1200);
  const viewport = opts?.viewport ?? { width: 1600, height: 1000 };
  const stepDelayMs = opts?.stepDelayMs ?? 800;
  const screenshotMode = opts?.screenshotMode ?? "element";
  const screenshotSettleMs = opts?.screenshotSettleMs ?? 160;
  const disableAnimations = opts?.disableAnimations ?? true;
  const enableTracing = opts?.enableTracing ?? true;
  const enableHighlight = opts?.enableHighlight ?? true;
  const humanTyping = opts?.humanTyping ?? false;
  const typingDelayMs = opts?.typingDelayMs ?? 100;

  const { browser, context } = await openContextWithProfile({
    headless,
    slowMo,
    viewport,
    channel: opts?.channel,
    executablePath: opts?.executablePath,
    userDataDir: opts?.userDataDir,
    connectWsEndpoint: opts?.connectWsEndpoint,
  });

  if (disableAnimations) {
    await context.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent = `
        * { animation: none !important; transition: none !important; caret-color: transparent !important; }
        html, body { scroll-behavior: auto !important; }
      `;
      document.documentElement.appendChild(style);
    });
  }

  if (enableTracing) {
    await context.tracing.start({ screenshots: false, snapshots: true });
  }

  const page = await context.newPage();

  const hasExplicitConfirm = (plan.steps as any[]).some(
    (s) => s.type === "fill" && s.selector === "confirm_password"
  );
  let confirmFilled = false;

  console.log(`\n=== EXECUTION START ===`);
  console.log(`Site: ${plan.meta.site}`);
  console.log(`Goal: ${plan.meta.goal}`);
  console.log(
    `Mode: ${
      opts?.connectWsEndpoint ? "cdp-attach" : opts?.userDataDir ? "persistent-chrome" : headless ? "headless" : "headful"
    } (slowMo ${slowMo}ms)`
  );
  console.log(`Viewport: ${viewport.width}x${viewport.height}`);
  console.log(`Steps: ${plan.steps.length}\n`);

  try {
    for (let i = 0; i < plan.steps.length; i++) {
      const action = plan.steps[i] as any;
      const started = Date.now();
      console.log(`[${i + 1}/${plan.steps.length}] ${action.type} → ${JSON.stringify(action)}`);

      try {
        switch (action.type) {
          case "navigate": {
            await page.goto(action.url, { waitUntil: "domcontentloaded" });
            await snap(page, i, "navigate", undefined, undefined, screenshotMode, screenshotSettleMs);
            break;
          }
          case "waitFor": {
            let candidates = map[action.selector] || [];
            if (action.selector === "full_name") {
              candidates = [...candidates, ...(map["first_name"] || [])];
            }
            const loc = await getLocator(page, candidates);
            await overlayHighlight(page, loc, i, enableHighlight);
            await loc.waitFor({ state: action.state, timeout: action.timeout ?? 15000 });
            await snap(page, i, "waitFor", action.selector, loc, screenshotMode, screenshotSettleMs);
            break;
          }
          case "fill": {
            if (action.selector === "full_name") {
              const value = data[action.valueKey] ?? "";
              const firstLoc = await firstExistingLocator(page, map["first_name"] || []);
              const lastLoc = await firstExistingLocator(page, map["last_name"] || []);
              if (firstLoc && lastLoc) {
                const parts = value.trim().split(/\s+/);
                const first = parts.shift() || "";
                const last = parts.join(" ") || "";
                await overlayHighlight(page, firstLoc, i, enableHighlight);
                await firstLoc.fill("");
                if (humanTyping) {
                  await firstLoc.type(first, { delay: typingDelayMs });
                } else {
                  await firstLoc.fill(first);
                }
                await snap(page, i, "fill", "first_name", firstLoc, screenshotMode, screenshotSettleMs);
                await overlayHighlight(page, lastLoc, i, enableHighlight);
                await lastLoc.fill("");
                if (humanTyping) {
                  await lastLoc.type(last, { delay: typingDelayMs });
                } else {
                  await lastLoc.fill(last);
                }
                await snap(page, i, "fill", "last_name", lastLoc, screenshotMode, screenshotSettleMs);
                break;
              }
            }

            if (action.selector === "confirm_password") {
              const loc = await getLocator(page, map[action.selector] || []);
              await overlayHighlight(page, loc, i, enableHighlight);
              const val = data[action.valueKey] ?? data["confirm_password"] ?? "";
              await loc.fill("");
              if (humanTyping) {
                await loc.type(String(val), { delay: typingDelayMs });
              } else {
                await loc.fill(String(val));
              }
              await snap(page, i, "fill", action.selector, loc, screenshotMode, screenshotSettleMs);
              confirmFilled = true;
              break;
            }

            const candidates = map[action.selector] || [];
            const best = await bestGroupLocator(page, candidates);
            if (action.selector === "otp_input" && best && best.count > 1 && data[action.valueKey ?? "otp"]) {
              const code = String(data[action.valueKey ?? "otp"]);
              const group = best.locator;
              const n = Math.min(best.count, code.length);
              for (let k = 0; k < n; k++) {
                const box = group.nth(k);
                await overlayHighlight(page, box, i, enableHighlight);
                await box.fill("");
                if (humanTyping) {
                  await box.type(code[k], { delay: typingDelayMs });
                } else {
                  await box.type(code[k]);
                }
                await snap(page, i, "fill", `otp_digit_${k + 1}`, box, screenshotMode, screenshotSettleMs);
                await sleep(typingDelayMs);
              }
              break;
            }

            const loc = await getLocator(page, candidates);
            await overlayHighlight(page, loc, i, enableHighlight);
            const val = data[action.valueKey] ?? "";
            await loc.fill("");
            if (humanTyping) {
              await loc.type(String(val), { delay: typingDelayMs });
            } else {
              await loc.fill(String(val));
            }
            await snap(page, i, "fill", action.selector, loc, screenshotMode, screenshotSettleMs);

            if (action.selector === "password" && data["confirm_password"] && !hasExplicitConfirm && !confirmFilled) {
              const confirmLoc = await firstExistingLocator(page, map["confirm_password"] || []);
              if (confirmLoc) {
                await overlayHighlight(page, confirmLoc, i, enableHighlight);
                await confirmLoc.fill("");
                if (humanTyping) {
                  await confirmLoc.type(String(data["confirm_password"]), { delay: typingDelayMs });
                } else {
                  await confirmLoc.fill(String(data["confirm_password"]));
                }
                await snap(page, i, "fill", "confirm_password", confirmLoc, screenshotMode, screenshotSettleMs);
                confirmFilled = true;
              }
            }
            break;
          }
          case "click": {
            if (action.selector === "auth_menu") {
              const signUpLoc = await firstExistingLocator(page, map["signup_menu"] || []);
              if (signUpLoc && (await signUpLoc.isVisible())) {
                console.log("   ⏭️ auth_menu already open, skipping click");
                break;
              }
            }
            const loc = await getLocator(page, map[action.selector] || []);
            await overlayHighlight(page, loc, i, enableHighlight);
            await loc.click();
            await snap(page, i, "click", action.selector, loc, screenshotMode, screenshotSettleMs);
            break;
          }
          case "press": {
            const loc = await getLocator(page, map[action.selector] || []);
            await overlayHighlight(page, loc, i, enableHighlight);
            await loc.press(action.key);
            await snap(page, i, "press", action.selector, loc, screenshotMode, screenshotSettleMs);
            break;
          }
          case "waitNetworkIdle": {
            await page.waitForLoadState("networkidle", { timeout: action.timeout ?? 15000 });
            await snap(page, i, "waitNetworkIdle", undefined, undefined, screenshotMode, screenshotSettleMs);
            break;
          }
        }

        console.log(`   ✅ step done in ${Date.now() - started}ms\n`);
        if (stepDelayMs > 0) await sleep(stepDelayMs);
      } catch (err: any) {
        const errPath = `error-step-${i + 1}.png`;
        await page.screenshot({ path: errPath, animations: "disabled", caret: "hide" });
        console.error(`   ❌ failed: ${err?.message || err}`);
        console.error(`   📸 saved ${errPath}\n`);
        throw err;
      }
    }

    if (opts?.keepOpen) {
      console.log("👀 keepOpen=true: Press 'q' or Enter to close, or Ctrl+C.");
      await new Promise<void>((resolve) => {
        const cleanup = async () => {
          try {
            await context.close();
          } catch {}
          try {
            await (browser?.close?.());
          } catch {}
          resolve();
        };
        const onSigint = () => {
          process.off("SIGINT", onSigint);
          cleanup();
        };
        process.on("SIGINT", onSigint);

        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
          process.stdin.resume();
          process.stdin.on("data", (buf: Buffer) => {
            const key = buf.toString("utf8");
            if (["q", "Q", "\r", "\n"].includes(key)) {
              process.stdin.setRawMode(false);
              process.stdin.pause();
              process.off("SIGINT", onSigint);
              cleanup();
            }
          });
        } else {
          setTimeout(() => {
            process.off("SIGINT", onSigint);
            cleanup();
          }, 15000);
        }
      });
      return;
    }

    if (opts?.keepOpenMs && opts.keepOpenMs > 0) {
      console.log(`⏸ Keeping browser open for ${opts.keepOpenMs}ms...`);
      await holdPage(page, opts.keepOpenMs);
    }
  } finally {
    try {
      await context.close();
    } catch {}
    try {
      await (browser?.close?.());
    } catch {}
  }
}