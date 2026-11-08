import { expect, test, type Page } from "@playwright/test";
import { statePath } from "./env";

// Keyboard use of the map home: logical Tab order through the search card, a visible focus ring,
// and the starting-point dialog opened, used and closed without a mouse.
async function tabUntil(page: Page, match: (name: string) => boolean, max = 25) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return "";
      const id = el.getAttribute("id");
      const label = id ? document.querySelector(`label[for="${id}"]`)?.textContent : el.closest("label")?.textContent;
      return (el.getAttribute("aria-label") ?? label ?? el.textContent ?? "").trim();
    });
    if (match(name)) return name;
  }
  throw new Error("focus never reached the expected control");
}

test("map home works by keyboard with a visible focus ring", async ({ browser }) => {
  const context = await browser.newContext({ storageState: statePath("priya") });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator(".maplibregl-canvas").waitFor({ state: "attached" });

  // The search card comes first (before map pins), then destination, time and detour, in that order.
  const first = await tabUntil(page, (n) => n.startsWith("From:") || /pickup pin|Zoom/.test(n));
  expect(first).toMatch(/^From:/);
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe("none");
  await tabUntil(page, (n) => n.startsWith("Where are you heading"));
  await tabUntil(page, (n) => n.startsWith("Leaving"));
  await tabUntil(page, (n) => n.startsWith("Most extra driving"));

  // Starting-point dialog: Enter opens it with focus inside, Escape closes it and nothing is chosen.
  await page.getByRole("button", { name: /^From:/ }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Choose a suburb by keyboard only.
  await page.getByRole("button", { name: /^From:/ }).focus();
  await page.keyboard.press("Enter");
  await tabUntil(page, (n) => n === "Choose a suburb instead");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Sunshine");
  await expect(dialog.getByRole("button", { name: /^Sunshine\s*\d{4}$/ })).toBeVisible();
  await tabUntil(page, (n) => /^Sunshine\s*\d{4}$/.test(n));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^From: Sunshine/ })).toBeVisible();
  // Focus went back to the chip that opened the dialog.
  await expect(page.getByRole("button", { name: /^From: Sunshine/ })).toBeFocused();

  // Focus stays inside the open dialog: many Tabs never reach the page behind it.
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // The menu drawer opens from the keyboard, traps focus, closes on Escape and returns focus.
  const menu = page.getByRole("button", { name: "Menu" });
  await menu.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Menu" });
  await expect(drawer.getByRole("link", { name: "My assignments" })).toBeVisible();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    expect(await drawer.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  await context.close();
});
