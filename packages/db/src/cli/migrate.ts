import { readDatabaseConfig } from "../config.js";
import { migrateDatabase } from "../migrate.js";

try {
  const config = readDatabaseConfig(process.env);
  await migrateDatabase(config);
  process.stdout.write(`Database "${config.name}" is migrated.\n`);
} catch (error) {
  process.stderr.write(
    `Migration failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
}
