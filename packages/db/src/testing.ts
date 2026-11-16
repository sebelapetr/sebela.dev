import { randomBytes } from "node:crypto";

import pg from "pg";

import type { DatabaseConfig } from "./config.js";
import { migrateDatabase } from "./migrate.js";

export { readDatabaseConfig } from "./config.js";
export type { DatabaseConfig } from "./config.js";

/** A database of its own for one test file. */
export interface TemporaryDatabase {
  readonly config: DatabaseConfig;
  /** Drops the database, ending connections that are still open. */
  drop(): Promise<void>;
}

/**
 * Test support, not a runtime entry: creates a separate, empty database next to the configured one
 * with the same role (worktree roles have `CREATEDB`), migrated unless `migrated` is `false`.
 * Worktree cleanup drops every database the role owns, so an interrupted run leaves nothing behind.
 */
export async function createTemporaryDatabase(
  base: DatabaseConfig,
  options: { migrated?: boolean } = {},
): Promise<TemporaryDatabase> {
  const name = `test_${randomBytes(12).toString("hex")}`;
  await administer(base, (client) => client.query(`CREATE DATABASE "${name}"`));
  const config = { ...base, name };
  const drop = () =>
    administer(base, (client) => client.query(`DROP DATABASE "${name}" WITH (FORCE)`));
  if (options.migrated !== false) {
    try {
      await migrateDatabase(config);
    } catch (error) {
      await drop();
      throw error;
    }
  }
  return {
    config,
    drop: async () => {
      await drop();
    },
  };
}

async function administer<T>(base: DatabaseConfig, run: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({
    host: base.host,
    port: base.port,
    database: base.name,
    user: base.user,
    password: base.password,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}
