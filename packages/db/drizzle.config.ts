import { defineConfig } from "drizzle-kit";

// drizzle-kit reads the private module schemas to generate SQL migrations into `migrations/`.
// Generating needs no database connection; applying them is `pnpm --filter @sebela/db db:migrate`.
export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/modules/profile/schema.ts",
    "./src/modules/roadmap/schema.ts",
    "./src/modules/api-keys/schema.ts",
    "./src/modules/audit/schema.ts",
  ],
  out: "./migrations",
});
