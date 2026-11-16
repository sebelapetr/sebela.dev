import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "./config.js";
import { migrateDatabase } from "./migrate.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "./testing.js";

const base = readDatabaseConfig(process.env);

async function query(database: TemporaryDatabase, text: string) {
  const { host, port, name, user, password } = database.config;
  const client = new pg.Client({ host, port, database: name, user, password });
  await client.connect();
  try {
    return (await client.query<Record<string, string>>(text)).rows;
  } finally {
    await client.end();
  }
}

describe("migrateDatabase", () => {
  let database: TemporaryDatabase | undefined;

  afterEach(async () => {
    await database?.drop();
    database = undefined;
  });

  it("creates the profile and API-key tables in separate schemas of an empty database", async () => {
    database = await createTemporaryDatabase(base, { migrated: false });

    await migrateDatabase(database.config);

    const tables = await query(
      database,
      `SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
       WHERE table_schema IN ('profile', 'auth') ORDER BY name`,
    );
    expect(tables.map((row) => row["name"])).toEqual([
      "auth.api_keys",
      "profile.case_studies",
      "profile.experience_technologies",
      "profile.experiences",
      "profile.organizations",
      "profile.persons",
      "profile.project_technologies",
      "profile.projects",
      "profile.technologies",
      "profile.topics",
    ]);
  });

  it("does nothing when the database is already migrated", async () => {
    database = await createTemporaryDatabase(base, { migrated: false });
    await migrateDatabase(database.config);

    await expect(migrateDatabase(database.config)).resolves.toBeUndefined();
  });
});
