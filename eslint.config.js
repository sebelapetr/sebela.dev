import { createConfig } from "@sebela/config/eslint";
import { defineConfig, globalIgnores } from "eslint/config";

// Root files only: the harness, the repository checks and root configuration. Every app and
// package lints itself through its own `lint` task, and `.worktrees/` holds other checkouts. The
// fixtures of the hard-coded configuration check are sample files of other languages and projects
// that its tests check explicitly; they are not part of the root code. `.venv/` is the installed
// uv Python environment, third-party code like `node_modules/`.
export default defineConfig(
  createConfig({ tsconfigRootDir: import.meta.dirname }),
  globalIgnores([
    "apps/",
    "packages/",
    ".worktrees/",
    ".context/",
    "scripts/checks/fixtures/",
    ".venv/",
  ]),
);
