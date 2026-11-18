import { defineConfig, devices } from "@playwright/test";

import { apiCommand, mediaBaseUrl, origin, required, webCommand } from "./e2e/stack";

// The browser tests run the built website (`pnpm build` first) against the API's end-to-end
// server: a real API on a temporary database of its own, seeded from a fictional fixture. Both
// listen on this checkout's own WEB_PORT and API_PORT; stop the checkout's dev servers first.
const apiUrl = origin(required("API_HOST"), required("API_PORT"));
const webUrl = origin(required("WEB_HOST"), required("WEB_PORT"));

// Spec files run in parallel, the tests of one file in order: a file's blocks share the API and
// website they start, each on its own temporary database and free ports. E2E_WORKERS overrides
// the default of 3 on a development machine and 4 in CI (`docs/testing.md`, Website browser tests).
function workers(): number {
  const value = process.env["E2E_WORKERS"];
  if (value === undefined || value === "") return process.env["CI"] ? 4 : 3;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("E2E_WORKERS must be a whole number of at least 1");
  }
  return count;
}

export default defineConfig({
  testDir: "e2e",
  // The complete stack's browser step runs against containers (playwright.complete-stack.config.ts).
  testIgnore: "complete-stack/**",
  fullyParallel: false,
  workers: workers(),
  forbidOnly: Boolean(process.env["CI"]),
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: webUrl, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      ...apiCommand("with-photo"),
      url: `${apiUrl}/health`,
      // No invalidation notifications here: `e2e/invalidation.spec.ts` starts its own pair.
      env: { API_WEB_INVALIDATION_URL: "", API_WEB_INVALIDATION_SECRET: "", API_E2E_KEY_FILE: "" },
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      stdout: "pipe",
    },
    {
      ...webCommand(),
      url: webUrl,
      env: {
        WEB_API_BASE_URL: apiUrl,
        WEB_SITE_ORIGIN: webUrl,
        WEB_MEDIA_BASE_URL: mediaBaseUrl(apiUrl),
        WEB_MEDIA_READ_BASE_URL: "",
        WEB_INVALIDATION_SECRET: "",
        WEB_CONTENT_REVALIDATE_SECONDS: "",
        // No analytics, whatever the checkout's environment says (e2e/analytics.spec.ts sets it).
        WEB_ANALYTICS_SCRIPT_URL: "",
        WEB_ANALYTICS_WEBSITE_ID: "",
      },
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
  ],
});
