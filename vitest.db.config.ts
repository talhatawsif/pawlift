import { defineConfig } from "vitest/config";
import path from "node:path";

// RLS and RPC tests against the linked dev Supabase project. Run with `npm run test:db`.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/db/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
