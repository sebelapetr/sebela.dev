import { coverage } from "@sebela/config/vitest";
import { defineConfig } from "vitest/config";

// The schemas' unit tests: pure parsing, no database, network or settings.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: coverage(),
  },
});
