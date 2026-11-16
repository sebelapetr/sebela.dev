import { defineConfig, globalIgnores } from "eslint/config";

import { createConfig } from "@sebela/config/eslint";

// `src/generated/` is written by `pnpm generate` and committed as it is; the drift check compares it
// with a fresh generation. It is still typechecked with the shared strict settings.
export default defineConfig(
  createConfig({ tsconfigRootDir: import.meta.dirname }),
  globalIgnores(["src/generated/"]),
);
