/**
 * Test coverage settings shared by every package that tests with Vitest (docs/testing.md,
 * Coverage). A package's `vitest.config.ts` passes them as `test.coverage`.
 *
 * Coverage is collected only when `TEST_COVERAGE` is `"true"` (CI sets it; Turborepo passes it to
 * the `test` task), so a local `vitest run` stays as fast as before. The V8 provider measures the
 * package's handwritten source, `src/`, including files no test loads; tests, declaration files and
 * generated code are left out. Each run writes `coverage/lcov.info`, which
 * `scripts/checks/coverage-summary.mjs` combines, and prints a short summary. There is no
 * threshold: coverage informs and never fails a run.
 *
 * @returns {import("./vitest.js").CoverageSettings}
 */
export function coverage() {
  return {
    enabled: process.env["TEST_COVERAGE"] === "true",
    provider: "v8",
    include: ["src/**/*.{ts,tsx}"],
    exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/**/generated/**"],
    reporter: ["text-summary", "lcovonly"],
  };
}
