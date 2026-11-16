import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";

/**
 * A node-postgres connection pool or an open transaction on it; both run the same queries, and a
 * transaction started on a transaction is a savepoint. Never leaves this package.
 */
export type Database = PgDatabase<NodePgQueryResultHKT>;
