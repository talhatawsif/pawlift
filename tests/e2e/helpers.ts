import type { Browser, Locator, Page } from "@playwright/test";
import { statePath } from "./env";

export type Who = "admin" | "sam" | "priya" | "tom" | "lee" | "mia" | "orguser";

/** A page signed in as one persona (storage state saved by auth.setup.ts). */
export async function as(browser: Browser, who: Who): Promise<Page> {
  const context = await browser.newContext({ storageState: statePath(who) });
  return context.newPage();
}

/**
 * Pages that read cookies render inside <Suspense>; in dev the fallback <main> can stay in the DOM.
 * Next also keeps the previous page mounted but hidden. This is the visible <main> with real content.
 */
export const main = (page: Page) =>
  page.locator("main").filter({ visible: true }).filter({ hasNotText: /^Loading…$/ }).last();

/** Melbourne wall-clock "YYYY-MM-DDTHH:mm" for a datetime-local input, `hours` from now. */
export function melbourneLocal(hours: number): string {
  const d = new Date(Date.now() + hours * 3600_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Choose the <option> whose text matches, in a labelled <select>. */
export async function chooseOption(select: Locator, text: RegExp) {
  const option = select.locator("option").filter({ hasText: text }).first();
  const value = await option.getAttribute("value");
  if (!value) throw new Error(`no option matching ${text}`);
  await select.selectOption(value);
}

/** The list item (card) on a page that mentions this text. */
export const card = (scope: Page | Locator, text: string | RegExp) => scope.locator("li").filter({ hasText: text }).first();

