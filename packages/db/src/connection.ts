import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import type { DatabaseConfig } from "./config.js";

/** A pool and its Drizzle wrapper. Never leaves this package. */
export interface Connection {
  readonly db: NodePgDatabase;
  close(): Promise<void>;
}

export function openConnection(config: DatabaseConfig, options: { max?: number } = {}): Connection {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.name,
    user: config.user,
    password: config.password,
    max: options.max ?? 10,
  });
  // An idle client that loses its connection must not crash the process; the next query reconnects.
  pool.on("error", () => undefined);
  return {
    db: drizzle({ client: pool }),
    close: () => pool.end(),
  };
}
