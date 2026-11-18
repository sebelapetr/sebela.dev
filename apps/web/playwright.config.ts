import { defineConfig, devices } from "@playwright/test";

import { apiCommand, origin, required, webCommand } from "./e2e/stack";

// The browser tests run the built website (`pnpm build` first) against the API's end-to-end
// server: a real API on a temporary database of its own, seeded from a fictional fixture. Both
// listen on this checkout's own WEB_PORT and API_PORT; stop the checkout's dev servers first.
const apiUrl = origin(required("API_HOST"), required("API_PORT"));
const webUrl = origin(required("WEB_HOST"), required("WEB_PORT"));

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: webUrl, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      ...apiCommand("with-photo"),
      url: `${apiUrl}/health`,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      stdout: "pipe",
    },
    {
      ...webCommand(),
      url: webUrl,
      env: { WEB_API_BASE_URL: apiUrl, WEB_SITE_ORIGIN: webUrl },
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
  ],
});
