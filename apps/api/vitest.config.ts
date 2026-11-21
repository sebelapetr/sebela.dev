import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { coverage } from "@sebela/config/vitest";
import { defineConfig } from "vitest/config";

// Integration tests connect with this checkout's database settings. `process.loadEnvFile` keeps a
// variable that is already set, so the process environment (CI) wins, then this checkout's
// `.env.local` (a worktree's generated settings), its `.env` (the main checkout's), then the
// documented examples (the shared Postgres address).
for (const name of [".env.local", ".env", ".env.example"]) {
  const file = fileURLToPath(new URL(`../../${name}`, import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: coverage(),
    // Two minutes: the test that sends a request to every private route takes about 28 s on a slow
    // host and timed out under load at the former 30 s (owner's decision, 2026-11-17).
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
