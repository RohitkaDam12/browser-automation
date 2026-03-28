// src/perception.ts
import TurndownService from "turndown";
import type { Page } from "playwright";

export type FieldMeta = {
  tag: string;
  id?: string;
  name?: string;
  type?: string;
  ariaLabel?: string;
  placeholder?: string;
  labelText?: string;
  role?: string;
  text?: string;
  visible: boolean;
};

export type Perception = {
  url: string;
  title: string;
  markdown: string;
  fields: FieldMeta[];
};

const td = new TurndownService({ headingStyle: "atx" });

export async function capturePerception(page: Page): Promise<Perception> {
  
  const html = await page.content();
  const markdown = td.turndown(html);

  const fields = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("input, textarea, select, button, a"));
    const out: any[] = [];

    for (const el of els) {
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute("role") || "").toLowerCase();
      const id = el.getAttribute("id") || undefined;
      const name = el.getAttribute("name") || undefined;
      const type = el.getAttribute("type") || undefined;
      const ariaLabel = el.getAttribute("aria-label") || undefined;
      const placeholder = el.getAttribute("placeholder") || undefined;

      // visibility (inline)
      const style = (window as any).getComputedStyle(el);
      const rect = (el as HTMLElement).getBoundingClientRect();
      const visible = style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;

      
      let labelText: string | undefined = undefined;
      if (id) {
        try {
          const lab = document.querySelector('label[for="' + id.replace(/"/g, '\\"') + '"]');
          if (lab) labelText = (lab.textContent || "").trim();
        } catch {}
      }
      if (!labelText) {
        const parentLabel = (el as HTMLElement).closest("label");
        if (parentLabel) labelText = (parentLabel.textContent || "").trim();
      }

      
      let text = (el.textContent || "").trim();
      if (tag === "input" || tag === "textarea") text = "";

      out.push({
        tag,
        id,
        name,
        type,
        ariaLabel,
        placeholder,
        labelText,
        role,
        text,
        visible
      });
    }
    return out;
  });

  return {
    url: page.url(),
    title: await page.title(),
    markdown,
    fields: fields as FieldMeta[],
  };
}