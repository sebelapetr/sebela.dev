import { createConfig } from "@sebela/config/eslint";
import { defineConfig, globalIgnores } from "eslint/config";

// Root files only: the harness scripts and root configuration. Every app and package lints
// itself through its own `lint` task, and `.worktrees/` holds other checkouts.
export default defineConfig(
  createConfig({ tsconfigRootDir: import.meta.dirname }),
  globalIgnores(["apps/", "packages/", ".worktrees/", ".context/"]),
);
