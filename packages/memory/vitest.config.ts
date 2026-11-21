import { defineConfig } from "vitest/config";

// The package's tests use deterministic fakes only: no database, network or settings.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "evals/**/*.test.ts"],
  },
});
