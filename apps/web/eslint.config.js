import nextPlugin from "@next/eslint-plugin-next";
import { createConfig } from "@sebela/config/eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";

// The shared configuration, plus the Next.js rules (Core Web Vitals as errors) and the React Hooks
// rules. `eslint-config-next` is not used: it bundles plugins that do not support ESLint 10 yet.
export default defineConfig(
  createConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    settings: { next: { rootDir: import.meta.dirname } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  reactHooks.configs.flat["recommended-latest"],
  globalIgnores(["next-env.d.ts", "playwright-report/", "test-results/"]),
);
