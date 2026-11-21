/**
 * The shape of `coverage()` from `vitest.js`. Declared here because this package has no build step
 * and does not depend on Vitest; it is assignable to Vitest's `test.coverage` option.
 */
export interface CoverageSettings {
  enabled: boolean;
  provider: "v8";
  include: string[];
  exclude: string[];
  reporter: ("text-summary" | "lcovonly")[];
}

/** Coverage settings for `test.coverage`, collected only when `TEST_COVERAGE` is `"true"`. */
export function coverage(): CoverageSettings;
