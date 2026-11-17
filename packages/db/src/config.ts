import { z } from "zod";

/** Where and as whom to connect. Validated once where a process starts, then passed down. */
export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly name: string;
  readonly user: string;
  readonly password: string;
}

const DatabaseEnvironmentSchema = z.object({
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_NAME: z.string().min(1),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string().min(1),
});

/**
 * Reads the database settings from an environment such as `process.env`. Throws an error naming
 * every missing or invalid variable; there are no fallbacks. Values are never included in it.
 */
export function readDatabaseConfig(
  env: Readonly<Record<string, string | undefined>>,
): DatabaseConfig {
  const parsed = DatabaseEnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(
      `Invalid database configuration: set ${names.join(", ")} (documented in .env.example)`,
    );
  }
  const settings = parsed.data;
  return {
    host: settings.POSTGRES_HOST,
    port: settings.POSTGRES_PORT,
    name: settings.DATABASE_NAME,
    user: settings.DATABASE_USER,
    password: settings.DATABASE_PASSWORD,
  };
}
