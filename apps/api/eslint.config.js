import { defineConfig } from "eslint/config";

import { createConfig } from "@sebela/config/eslint";

export default defineConfig(createConfig({ tsconfigRootDir: import.meta.dirname }));
