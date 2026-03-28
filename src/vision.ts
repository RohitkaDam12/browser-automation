import type { Page, Locator } from "playwright";

export async function screenshotBase64(page: Page, loc?: Locator): Promise<{ b64: string; mime: string }> {
  const buf = loc ? await loc.screenshot() : await page.screenshot({ animations: "disabled", caret: "hide" });
  return { b64: buf.toString("base64"), mime: "image/png" };
}