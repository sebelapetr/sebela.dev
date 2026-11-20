import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The end-to-end tests start the real API on a temporary database with this checkout's database
// settings. `process.loadEnvFile` keeps a variable that is already set, so the process environment
// (CI) wins, then this checkout's `.env.local`, its `.env`, then the documented examples.
for (const name of [".env.local", ".env", ".env.example"]) {
  const file = fileURLToPath(new URL(`../../${name}`, import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "evals/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
