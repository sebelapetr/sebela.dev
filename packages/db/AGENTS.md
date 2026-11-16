# @sebela/db

PostgreSQL schema, committed migrations and persistence operations. The only package that contains SQL. Read the root `AGENTS.md` first; this file covers only what is specific to this package.

## What it is

A library used only by `@sebela/services`. It may import nothing from this repository except `@sebela/config` (dependency table in `docs/repository-structure.md`). Drizzle tables, query builders, pools and driver errors never leave it: callers receive domain records and documented results.

## Public interface

Only the subpaths declared in `exports` of `package.json` are public.

| Export               | Entry            | What it provides                                                                                                                                                                                                                                                   |
| -------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@sebela/db`         | `src/index.ts`   | `readDatabaseConfig(env)` (validates `POSTGRES_HOST`, `POSTGRES_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`; no fallbacks), `migrateDatabase(config)`, `createPersistence(config)` returning `{ profile, apiKeys, close }`, and the record types. |
| `@sebela/db/testing` | `src/testing.ts` | Test support only: `createTemporaryDatabase(config, { migrated })` creates a separate `test_<random>` database with the configured role, migrates it unless `migrated: false`, and `drop()` removes it. Never used by runtime code.                                |

## Module map

| Module                 | Entry                           | Responsibility and hidden decisions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Depends on    | Tests                                                                         |
| ---------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `src/modules/profile`  | `src/modules/profile/index.ts`  | `ProfilePersistence`: find, create, update and delete the one person in `profile.persons`. A unique, always-true `singleton` column makes the database refuse a second row, so concurrent creates give exactly one success and `{ ok: false, reason: "conflict" }` for the rest. Also the ordered catalogs `profile.technologies` and `profile.topics` (private `catalogs.ts`, types in private `types.ts` re-exported by the entry): list, find, create, update and delete by slug. A unique slug turns duplicate and concurrent creates into `conflict`; the check constraint `technologies_group_matches_tier` (a primary technology has a group, a secondary none) turns an inconsistent create or update into `inconsistent`; positions are non-negative. Technologies are listed by tier, group (enum order), position and slug, topics by position and slug. Updates set `updated_at` to `clock_timestamp()`. | `drizzle-orm` | `src/modules/profile/profile.test.ts`, `src/modules/profile/catalogs.test.ts` |
| `src/modules/api-keys` | `src/modules/api-keys/index.ts` | `ApiKeyPersistence`: insert, list metadata (oldest first, never the hash), find a credential by public id, record last use, revoke (keeps the first revocation time). Table `auth.api_keys`, a schema apart from content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `drizzle-orm` | `src/modules/api-keys/api-keys.test.ts`                                       |

Files outside modules: `config.ts` (environment validation), `connection.ts` (the `pg` pool and its Drizzle wrapper, private), `migrate.ts` (the Drizzle migrator over `migrations/`), `persistence.ts` (composes the module persistences over one pool), `testing.ts` and `cli/migrate.ts` (the migration command). Module tests build their persistence from their own entry and `connection.ts`, never from `persistence.ts`, which would close a module cycle. `drizzle.config.ts` is the tooling configuration that reads the private `schema.ts` files.

## Migrations

- Migrations are generated from the schema files and committed in `migrations/` (SQL plus Drizzle's `meta/` journal). Never edit an applied migration; change `schema.ts` and generate a new one.
- Generate: `pnpm --filter @sebela/db db:generate --name <what-changed>`. It needs no database.
- Apply: `pnpm --filter @sebela/db db:migrate`. It builds the package and runs `dist/cli/migrate.js` with the settings of the process environment, then `.env.local`, `.env` and `.env.example` of the checkout (the earlier source wins). It migrates an empty database and does nothing on an up-to-date one. The API never runs migrations when it starts.
- Each domain gets its own PostgreSQL schema (`profile`, `auth`). Drizzle records applied migrations in the `drizzle` schema.

## Adding an entity end to end

1. Add the table to the owning module's `schema.ts` and a persistence operation to its `index.ts`, with a test in the module against a temporary database. Generate the migration.
2. Add the service operation in `@sebela/services` (domain rules and errors), then contracts and routes in `@sebela/contracts` and `apps/api`.
3. Update the module maps of every touched package.

## Tests

`pnpm --filter @sebela/db test`. Every test file creates its own temporary database through `createTemporaryDatabase` with the role from the environment (a worktree role has `CREATEDB`), uses small fictional fixtures and drops the database afterwards. Tests need a running Postgres and `DATABASE_USER`/`DATABASE_PASSWORD`; there is no mocked database.
