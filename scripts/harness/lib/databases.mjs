// The worktree databases in the shared Postgres of compose.yaml — see docs/repository-structure.md
// ("Ports and worktree isolation"). Plain Node without a database driver: SQL runs through psql
// inside the running `postgres` service (`docker compose exec`), connected as the service's own
// superuser to its initial database. Compose reads its configuration from the environment given.
//
// A database belongs to the worktree recorded in its comment. `ensure` creates a missing database
// and records the owner, or reuses one the same worktree already owns; `drop` removes only a
// database its worktree owns. Any other database is refused, never used or dropped.

import { execFileSync } from "node:child_process";
import path from "node:path";

const SERVICE = "postgres";
const OWNER_MARKER = "sebela worktree:";
const TIMEOUT_MS = 20_000;
// The form databaseName in slots.mjs produces: nothing else is ever created or dropped.
const DATABASE_IDENTIFIER = /^wt_[a-z0-9_]{1,60}$/;
const OWNER_NAME = /^[A-Za-z0-9._-]+$/;

// `root` is the checkout whose compose.yaml defines the service; `env` is the environment Compose
// runs with (it resolves the project name and the settings compose.yaml requires).
export function composeDatabases({ root, env }) {
  const psql = (sql) => {
    try {
      return execFileSync(
        "docker",
        [
          "compose",
          "--project-directory",
          root,
          "--file",
          path.join(root, "compose.yaml"),
          "exec",
          "-T",
          SERVICE,
          "sh",
          "-c",
          'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
        ],
        { input: sql, encoding: "utf8", env, timeout: TIMEOUT_MS, stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
    } catch (error) {
      const detail = error.stderr?.toString().trim() || error.message;
      throw new Error(
        `the shared Postgres did not run the statement (${detail}); is it running? Start it with \`docker compose up --detach --wait\` in the main checkout`,
        { cause: error },
      );
    }
  };

  // The recorded owner of a database: null when it does not exist, "" when it has no owner.
  const ownerOf = (name) => {
    const row = psql(
      `SELECT 'found:' || coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = '${name}';`,
    );
    if (!row) return null;
    const comment = row.slice("found:".length);
    return comment.startsWith(OWNER_MARKER) ? comment.slice(OWNER_MARKER.length) : "";
  };

  const refuse = (name, owner, holder) =>
    new Error(
      `database ${name} exists but ${holder ? `belongs to worktree ${holder}` : "was not created for a worktree"}; refusing to use or drop it for ${owner}`,
    );

  return {
    ensure(name, owner) {
      check(name, owner);
      const holder = ownerOf(name);
      if (holder === owner) return { created: false };
      if (holder !== null) throw refuse(name, owner, holder);
      psql(`CREATE DATABASE "${name}";`);
      try {
        psql(`COMMENT ON DATABASE "${name}" IS '${OWNER_MARKER}${owner}';`);
      } catch (error) {
        // A database without its owner could never be reused or dropped by the scripts.
        try {
          psql(`DROP DATABASE "${name}";`);
        } catch {
          // reported with the original error below
        }
        throw error;
      }
      return { created: true };
    },
    drop(name, owner) {
      check(name, owner);
      const holder = ownerOf(name);
      if (holder === null) return { dropped: false };
      if (holder !== owner) throw refuse(name, owner, holder);
      // FORCE ends the connections a development server of this worktree may still hold.
      psql(`DROP DATABASE "${name}" WITH (FORCE);`);
      return { dropped: true };
    },
  };
}

// Names reach SQL only after this check, so quoting cannot be broken out of.
function check(name, owner) {
  if (!DATABASE_IDENTIFIER.test(name)) throw new Error(`not a worktree database name: "${name}"`);
  if (!OWNER_NAME.test(owner)) throw new Error(`not a worktree name: "${owner}"`);
}
