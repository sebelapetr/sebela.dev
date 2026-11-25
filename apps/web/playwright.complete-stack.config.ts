import { defineConfig, devices } from "@playwright/test";

import { required } from "./e2e/stack";

// The browser step of the complete stack smoke checks (`pnpm test:web-stack`,
// scripts/checks/web-stack.e2e.mjs, and scripts/checks/production-stack.e2e.mjs --browser): the
// website container of a disposable Compose project at WEB_STACK_URL, with the demo seed's person
// WEB_STACK_PERSON_NAME and the stack's chat in WEB_STACK_CHAT (`on` or `off`). It starts no server;
// the smoke check starts the stack and runs this configuration. `test:e2e` leaves these tests out.
export default defineConfig({
  testDir: "e2e/complete-stack",
  outputDir: "test-results/complete-stack",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: "list",
  use: { baseURL: required("WEB_STACK_URL"), trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
