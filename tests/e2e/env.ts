// Test-setup only (service role allowed here, never in src/). Same guard as scripts/demo-reset.mjs.
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // env may come from the shell
}

export function assertDemoProject() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url ? new URL(url).hostname.split(".")[0] : "";
  const allowed = (process.env.DEMO_PROJECT_REFS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (process.env.APP_ENV !== "demo" || !ref || !allowed.includes(ref)) {
    throw new Error("e2e refuses to run: needs APP_ENV=demo and the project ref in DEMO_PROJECT_REFS.");
  }
}

export const serviceClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export const AUTH_DIR = path.join("tests", "e2e", ".auth");
export const statePath = (who: string) => path.join(AUTH_DIR, `${who}.json`);

export type RunInfo = { westernOrgId: string; orgUserEmail: string; runId: string };
const infoPath = path.join(AUTH_DIR, "run.json");
export function saveRunInfo(info: RunInfo) {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(infoPath, JSON.stringify(info, null, 2));
}
export const runInfo = (): RunInfo => JSON.parse(readFileSync(infoPath, "utf8"));
