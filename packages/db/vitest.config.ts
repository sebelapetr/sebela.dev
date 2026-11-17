import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
