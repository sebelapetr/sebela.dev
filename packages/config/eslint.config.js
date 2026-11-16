import { defineConfig, globalIgnores } from "eslint/config";

import { createConfig } from "./eslint.js";

// The fixtures are a fictional workspace whose files break the import boundaries on purpose; the
// import-boundaries tests lint them explicitly.
export default defineConfig(
  createConfig({ tsconfigRootDir: import.meta.dirname }),
  globalIgnores(["fixtures/"]),
);
