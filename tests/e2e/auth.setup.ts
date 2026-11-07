import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test as setup, type BrowserContext } from "@playwright/test";
import { AUTH_DIR, assertDemoProject, saveRunInfo, serviceClient, statePath } from "./env";

// Persona key → name shown in the DEMO switcher (src/lib/demo/personas.ts).
export const PERSONA_NAMES = { admin: "Demo Admin", sam: "Sam", priya: "Priya", tom: "Tom", lee: "Lee", mia: "Mia" } as const;

async function waitForSession(context: BrowserContext) {
  await expect
    .poll(async () => (await context.cookies()).some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token")), {
      timeout: 30_000,
    })
    .toBe(true);
}

setup("reseed DEMO data and sign each persona in once", async ({ browser }) => {
  setup.setTimeout(300_000);
  assertDemoProject();
  execSync("node scripts/demo-reset.mjs", { stdio: "pipe" });
  mkdirSync(AUTH_DIR, { recursive: true });

  const db = serviceClient();
  const { data: org, error: orgErr } = await db
    .from("organisations").select("id").eq("name", "Western Paws Rescue (DEMO)").single();
  if (orgErr || !org) throw new Error(`demo org missing: ${orgErr?.message}`);

  // A fresh, confirmed demo account for the organisation story. demo:reset deletes every
  // @demo.pawlift.invalid user, so the next run removes it.
  const runId = Date.now().toString(36);
  const email = `e2e-org-${runId}@demo.pawlift.invalid`;
  const password = randomBytes(18).toString("base64url");
  const { data: created, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: "Casey (e2e)" },
  });
  if (error || !created.user) throw new Error(`create org user: ${error?.message}`);
  const { error: pErr } = await db.from("profiles").update({ is_demo: true, display_name: "Casey (e2e)" }).eq("id", created.user.id);
  if (pErr) throw new Error(`org user profile: ${pErr.message}`);
  saveRunInfo({ westernOrgId: org.id, orgUserEmail: email, runId });

  // One sign-in per persona, each in its own context, through the real DEMO switcher.
  for (const [key, name] of Object.entries(PERSONA_NAMES)) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await page.getByLabel("Switch demo persona").click();
    await page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).click();
    await waitForSession(context);
    await context.storageState({ path: statePath(key) });
    await context.close();
  }

  // The organisation-story user signs in through the normal form.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForSession(context);
  await context.storageState({ path: statePath("orguser") });
  await context.close();
});
