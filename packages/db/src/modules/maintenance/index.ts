import { sql } from "drizzle-orm";

import type { Database } from "../../database.js";

/** Operations on the whole content of the database, for the owner's maintenance commands. */
export interface MaintenancePersistence {
  /**
   * Empties every table of the `profile` and `ai_roadmap` schemas in one transaction, all or
   * nothing, and returns the storage keys of the media it removed, so the caller can delete the
   * stored files after the commit. API keys and the audit of earlier changes stay. The migrations
   * stay applied, so the database is empty and ready for content again.
   */
  clearContent(): Promise<readonly string[]>;
}

/**
 * Runs `<command> <every table of the content schemas>` as one statement. The table list is read
 * from the catalogue, so a table a later migration adds is covered without a change here. `auth`
 * and `audit` are operational data and are never listed.
 */
const overContentTables = (command: "lock table" | "truncate table") => sql`
  do $$
  declare tables text;
  begin
    select string_agg(format('%I.%I', schemaname, tablename), ', ' order by schemaname, tablename)
      into tables
      from pg_tables
     where schemaname in ('profile', 'ai_roadmap');
    if tables is not null then
      execute ${sql.raw(`'${command} ' || tables`)};
    end if;
  end
  $$`;

export function createMaintenancePersistence(db: Database): MaintenancePersistence {
  return {
    clearContent: () =>
      db.transaction(async (tx) => {
        // Lock first, so no media is recorded between reading the keys and the truncate.
        await tx.execute(overContentTables("lock table"));
        const media = await tx.execute<{ key: string }>(sql`select key from profile.media`);
        await tx.execute(overContentTables("truncate table"));
        return media.rows.map(({ key }) => key);
      }),
  };
}
