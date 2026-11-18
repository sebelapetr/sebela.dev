import { defineConfig } from "vitest/config";

// Unit tests of the website's logic (environment, data mapping). They run in Node without a
// browser and without the API; the browser checks are Playwright's (`e2e/`).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
