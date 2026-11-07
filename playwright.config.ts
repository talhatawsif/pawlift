import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against the dev server and the pawlift-dev Supabase project.
// The setup project reseeds DEMO data (`npm run demo:reset`) and signs each persona in once.
// One worker: the stories share one demo seed and run in order.
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "stories",
      testMatch: /(volunteer|organisation|foster)\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "a11y",
      testMatch: /(a11y|keyboard)\.spec\.ts/,
      dependencies: ["stories"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
