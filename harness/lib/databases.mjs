// The worktree databases and roles in the shared Postgres of compose.yaml — see
// docs/repository-structure.md ("Worktree databases"). Plain Node without a database driver: SQL
// runs through psql inside the running `postgres` service (`docker compose exec`), connected as the
// service's own superuser to its initial database. Compose reads its configuration from the
// environment given. Statements reach psql on standard input, never on a command line.
//
// Each worktree has one database and one role of the same name. The role logs in with a password,
// may create (temporary) databases, owns the worktree's database and is the only non-superuser
// that may connect to it. Both belong to the worktree recorded in their comment. `ensure` creates
// what is missing and records the owner, or reuses what the same worktree already owns; `drop`
// removes the worktree's database, every other database its role owns and then the role. Anything
// recorded for another worktree, or not created by the scripts, is refused, never used or dropped.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { randomPassword, scramVerifier } from "./credentials.mjs";

const SERVICE = "postgres";
const OWNER_MARKER = "sebela worktree:";
const TIMEOUT_MS = 20_000;
// The form databaseName in slots.mjs produces: nothing else is ever created or dropped.
const DATABASE_IDENTIFIER = /^wt_[a-z0-9_]{1,60}$/;
const OWNER_NAME = /^[A-Za-z0-9._-]+$/;
const ROLE_ATTRIBUTES = "LOGIN CREATEDB NOSUPERUSER NOCREATEROLE";

// `root` is the checkout whose compose.yaml defines the service; `env` is the environment Compose
// runs with (it resolves the project name and the settings compose.yaml requires).
export function composeDatabases({ root, env }) {
  // `secret` is removed from any error, so not even a password verifier is reported.
  const psql = (sql, { secret } = {}) => {
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
      let detail = error.stderr?.toString().trim() || error.message;
      if (secret) detail = detail.replaceAll(secret, "[redacted]");
      throw new Error(
        `the shared Postgres did not run the statement (${detail}); is it running? Start it with \`docker compose up --detach --wait\` in the main checkout`,
        // The cause would carry the unredacted output.
        secret ? {} : { cause: error },
      );
    }
  };

  // The recorded owner of a database (`pg_database`) or a role (`pg_authid`): null when it does
  // not exist, "" when it records no worktree.
  const holderOf = (catalog, view, column, name) => {
    const row = psql(
      `SELECT 'found:' || coalesce(shobj_description(oid, '${catalog}'), '') FROM ${view} WHERE ${column} = '${name}';`,
    );
    if (!row) return null;
    const comment = row.slice("found:".length);
    return comment.startsWith(OWNER_MARKER) ? comment.slice(OWNER_MARKER.length) : "";
  };
  const databaseHolder = (name) => holderOf("pg_database", "pg_database", "datname", name);
  const roleHolder = (name) => holderOf("pg_authid", "pg_roles", "rolname", name);

  const refuse = (kind, name, owner, holder) =>
    new Error(
      `${kind} ${name} exists but ${holder ? `belongs to worktree ${holder}` : "was not created for a worktree"}; refusing to use or drop it for ${owner}`,
    );

  // The databases the role owns besides `name`: those drop may remove (`protectedOnes` false), or
  // those it must keep (true) — the main checkout's database and any recorded for another worktree.
  const otherDatabasesOf = (name, owner, protectedOnes) => {
    const comment = "coalesce(shobj_description(oid, 'pg_database'), '')";
    const kept = `(datname = current_database() OR (${comment} LIKE '${OWNER_MARKER}%' AND ${comment} <> '${OWNER_MARKER}${owner}'))`;
    return `FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = '${name}') AND datname <> '${name}' AND ${protectedOnes ? "" : "NOT "}${kept}`;
  };

  return {
    // Ensures the worktree's role and database. `password` becomes the role's password; without
    // it a new role gets a random one nobody knows and an existing role keeps its password.
    // Returns the role's name. When it fails, whatever this call created is removed again.
    ensure(name, owner, { password } = {}) {
      check(name, owner);
      const database = databaseHolder(name);
      if (database !== null && database !== owner) throw refuse("database", name, owner, database);
      const role = roleHolder(name);
      if (role !== null && role !== owner) throw refuse("role", name, owner, role);

      const verifier = scramVerifier(password ?? randomPassword());
      const undo = [];
      try {
        if (role === null) {
          psql(`CREATE ROLE "${name}" WITH ${ROLE_ATTRIBUTES} PASSWORD '${verifier}';`, {
            secret: verifier,
          });
          undo.push(`DROP ROLE "${name}";`);
          psql(`COMMENT ON ROLE "${name}" IS '${OWNER_MARKER}${owner}';`);
        } else {
          // Also restores the attributes of a role that was changed by hand.
          const newPassword = password === undefined ? "" : ` PASSWORD '${verifier}'`;
          psql(`ALTER ROLE "${name}" WITH ${ROLE_ATTRIBUTES}${newPassword};`, { secret: verifier });
        }
        if (database === null) {
          psql(`CREATE DATABASE "${name}" OWNER "${name}";`);
          undo.unshift(`DROP DATABASE "${name}" WITH (FORCE);`);
          psql(`COMMENT ON DATABASE "${name}" IS '${OWNER_MARKER}${owner}';`);
        }
        // Also for a database created before worktrees had roles.
        psql(
          `ALTER DATABASE "${name}" OWNER TO "${name}"; REVOKE CONNECT ON DATABASE "${name}" FROM PUBLIC;`,
        );
      } catch (error) {
        // A database or role without its owner could never be reused or dropped by the scripts.
        for (const statement of undo) {
          try {
            psql(statement);
          } catch {
            // reported with the original error below
          }
        }
        throw error;
      }
      return { user: name, created: database === null };
    },

    // Drops the worktree's database, every other database its role owns (temporary test
    // databases) and then the role, in that order. Everything is checked before anything is
    // dropped.
    drop(name, owner) {
      check(name, owner);
      const database = databaseHolder(name);
      if (database !== null && database !== owner) throw refuse("database", name, owner, database);
      const role = roleHolder(name);
      if (role !== null && role !== owner) throw refuse("role", name, owner, role);
      if (role !== null) {
        const kept = psql(`SELECT datname ${otherDatabasesOf(name, owner, true)};`)
          .split("\n")
          .filter(Boolean);
        if (kept.length) {
          throw new Error(
            `role ${name} owns ${kept.join(", ")}, which belong to the main checkout or another worktree; refusing to drop them for ${owner}`,
          );
        }
      }

      // FORCE ends the connections a development server or a test run may still hold.
      if (database !== null) psql(`DROP DATABASE "${name}" WITH (FORCE);`);
      if (role !== null) {
        // Repeats the protection, so a database created meanwhile is not dropped either.
        psql(
          `SELECT format('DROP DATABASE %I WITH (FORCE);', datname) ${otherDatabasesOf(name, owner, false)} \\gexec`,
        );
        psql(`DROP ROLE "${name}";`);
      }
      return { dropped: database !== null || role !== null };
    },
  };
}

// Names reach SQL only after this check, so quoting cannot be broken out of.
function check(name, owner) {
  if (!DATABASE_IDENTIFIER.test(name)) throw new Error(`not a worktree database name: "${name}"`);
  if (!OWNER_NAME.test(owner)) throw new Error(`not a worktree name: "${owner}"`);
}
