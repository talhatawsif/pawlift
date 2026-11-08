import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { runInfo, serviceClient, statePath } from "./env";
import { main, type Who } from "./helpers";

// Automated WCAG 2 A/AA scan (axe) of every main screen, at desktop and phone width, plus a
// no-sideways-scroll check on phones. Fails on serious or critical violations.
type Visit = { who: Who | "anon"; path: string };

/** Detail pages need ids from the seeded data (read with the test-only service client). */
async function detailVisits(): Promise<Visit[]> {
  const db = serviceClient();
  const w = runInfo().westernOrgId;
  const { data: reqs } = await db.from("transport_requests").select("id, animal_name, status").eq("org_id", w);
  const open = reqs?.find((r) => r.animal_name === "Rusty");
  const done = reqs?.find((r) => r.animal_name === "Biscuit");
  const { data: leg } = await db.from("transport_legs").select("id").eq("request_id", done!.id).single();
  const { data: asg } = await db.from("transport_assignments").select("id").eq("leg_id", leg!.id).limit(1).single();
  const { data: jordan } = await db.from("profiles").select("id").eq("display_name", "Jordan").eq("is_demo", true).single();
  return [
    { who: "anon", path: `/requests/${open!.id}` },
    { who: "priya", path: `/requests/${open!.id}` },
    { who: "priya", path: `/assignments/${asg!.id}` },
    { who: "sam", path: `/org/${w}/requests/${open!.id}` },
    { who: "admin", path: `/admin/organisations/${w}` },
    { who: "admin", path: `/admin/volunteers/${jordan!.id}` },
  ];
}

function visits(): Visit[] {
  const w = runInfo().westernOrgId;
  const anon = ["/", "/requests", "/about", "/how-it-works", "/transport-safety", "/terms", "/privacy", "/sign-in", "/sign-up"];
  const org = ["", "/dashboard", "/requests", "/requests/new", "/members", "/locations", "/settings", "/history", "/audit"];
  const adminPages = ["/admin", "/admin/requests", "/admin/organisations", "/admin/volunteers", "/admin/incidents", "/admin/audit", "/admin/private-access"];
  return [
    ...anon.map((path) => ({ who: "anon" as const, path })),
    ...["/", "/assignments", "/volunteer", "/notifications", "/join"].map((path) => ({ who: "priya" as const, path })),
    { who: "mia", path: "/foster" },
    ...org.map((p) => ({ who: "sam" as const, path: `/org/${w}${p}` })),
    ...adminPages.map((path) => ({ who: "admin" as const, path })),
  ];
}

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 375, height: 812 },
] as const;

async function settle(page: Page, path: string) {
  await page.goto(path);
  await expect(main(page)).toBeVisible();
  if (path === "/") await page.locator(".maplibregl-canvas").waitFor({ state: "attached" });
  await page.waitForLoadState("networkidle").catch(() => {});
}

for (const vp of VIEWPORTS) {
  test(`axe WCAG A/AA and layout at ${vp.name} width`, async ({ browser }) => {
    test.setTimeout(600_000);
    const failures: string[] = [];
    const contexts = new Map<string, Page>();
    for (const v of [...visits(), ...(await detailVisits())]) {
      let page = contexts.get(v.who);
      if (!page) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          storageState: v.who === "anon" ? undefined : statePath(v.who),
        });
        page = await context.newPage();
        contexts.set(v.who, page);
      }
      await settle(page, v.path);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // Hidden pages Next keeps mounted (display:none) are not scanned by axe anyway.
        .analyze();
      for (const x of result.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) {
        const where = x.nodes.slice(0, 3)
          .map((n) => `${n.html.slice(0, 120)} (${(n.failureSummary ?? "").split("\n").pop()?.trim()})`).join(" | ");
        failures.push(`${v.who} ${v.path} [${x.impact}] ${x.id}: ${x.help} → ${where}`);
      }
      if (vp.name === "phone") {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) failures.push(`${v.who} ${v.path} [layout] page scrolls sideways by ${overflow}px at 375px`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
}

// The open menu drawer (a modal dialog) is scanned too: the page scans above only see it closed.
for (const vp of VIEWPORTS) {
  test(`axe with the menu open at ${vp.name} width`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, storageState: statePath("sam") });
    const page = await context.newPage();
    await settle(page, "/");
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const bad = result.violations.filter((x) => x.impact === "serious" || x.impact === "critical");
    expect(bad.map((x) => `${x.id}: ${x.help}`)).toEqual([]);
    await context.close();
  });
}
