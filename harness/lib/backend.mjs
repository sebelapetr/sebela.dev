// The backend maintenance stages of a worktree: install its dependencies, apply its pending
// migrations, prepare its storage folder and load the demo seed into an empty profile. Each stage is
// a package script of the worktree's own checkout started through pnpm, so the harness stays plain
// Node without dependencies and every worktree runs the code and configuration it checked out — see
// docs/repository-structure.md ("Ports and worktree isolation").

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const ENV_FILE = ".env.local";

// Settings a child process must read from the worktree's own environment files, never from the
// caller (the main checkout or another worktree): ports, hosts, database, storage and media.
const WORKTREE_PREFIXES = [
  "WORKTREE_",
  "WEB_",
  "API_",
  "MCP_",
  "LLM_AGENT_",
  "POSTGRES_",
  "DATABASE_",
  "STORAGE_",
  "MEDIA_",
];
const SHARED_SERVER = ["POSTGRES_HOST", "POSTGRES_PORT"];

function defaultRun({ cwd, args, env }) {
  const result = spawnSync("pnpm", args, { cwd, env, stdio: ["ignore", 2, 2] });
  if (result.error) return 1;
  return result.status ?? 1;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function hasScript(root, pkg, script) {
  return Boolean(readJson(path.join(root, pkg, "package.json"))?.scripts?.[script]);
}

// The worktree's generated settings, or null when it has no environment file.
function worktreeSettings(root) {
  try {
    return parseEnv(fs.readFileSync(path.join(root, ENV_FILE), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// The caller's environment without any setting the worktree owns and without any key the worktree's
// documented example names, so the child reads them from the worktree's own files. Only where the
// shared Postgres listens, the same for every checkout, passes through.
export function worktreeEnv(env, root) {
  let example = {};
  try {
    example = parseEnv(fs.readFileSync(path.join(root, ".env.example"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        SHARED_SERVER.includes(key) ||
        (!(key in example) && !WORKTREE_PREFIXES.some((prefix) => key.startsWith(prefix))),
    ),
  );
}

// `run` starts `pnpm <args>` in `cwd` and returns its exit code; `log` receives notices. Both are
// replaceable for tests. Errors name the failing stage and how to retry; nothing is printed to
// stdout, so the last line of `create` stays the worktree path.
export function backendMaintenance({
  run = defaultRun,
  env = process.env,
  log = (text) => process.stderr.write(text),
} = {}) {
  const pnpm = (root, stage, args) => {
    const status = run({ cwd: root, args, env: worktreeEnv(env, root) });
    if (status !== 0) {
      throw new Error(
        `the ${stage} stage failed in ${root} (exit ${status}); fix the cause and run create again`,
      );
    }
  };

  return {
    // Installs, migrates, prepares storage and seeds an empty profile, in that order. Safe to run
    // again: migrations apply only what is pending, the storage folder is reused and a profile that
    // holds content is not seeded again. Throws at the first failing stage.
    setup({ root, owner }) {
      if (!fs.existsSync(path.join(root, "package.json"))) return;
      pnpm(root, "install", ["install", "--frozen-lockfile", "--prefer-offline"]);

      if (hasScript(root, "packages/db", "db:migrate")) {
        pnpm(root, "migration", ["--filter", "@sebela/db", "db:migrate"]);
      } else {
        log("migration stage skipped: this checkout has no db:migrate script\n");
      }

      if (hasScript(root, "apps/api", "storage")) {
        if (!worktreeSettings(root)?.STORAGE_WORKTREE) {
          throw new Error(
            `${path.join(root, ENV_FILE)} sets no STORAGE_WORKTREE, so the storage stage cannot run; it was kept as it is. To have it generated, delete ${ENV_FILE} (keep any local edits you need) and run create again`,
          );
        }
        pnpm(root, "storage", ["--silent", "--filter", "@sebela/api", "storage", "prepare", owner]);
      } else {
        log("storage stage skipped: this checkout has no storage command\n");
      }

      if (hasScript(root, "apps/api", "seed")) {
        pnpm(root, "seed", ["--silent", "--filter", "@sebela/api", "seed", "--if-empty"]);
      } else {
        log("seed stage skipped: this checkout has no seed command\n");
      }
    },

    // Removes the worktree's storage folder. A worktree without a storage folder or without the
    // storage command needs nothing. Without its installed tools the folder cannot be removed:
    // refused unless `force`, which leaves the folder behind with a notice.
    teardown({ root, owner, force = false }) {
      if (!hasScript(root, "apps/api", "storage")) return;
      if (!worktreeSettings(root)?.STORAGE_WORKTREE) {
        log("storage teardown skipped: the worktree has no storage folder\n");
        return;
      }
      if (!fs.existsSync(path.join(root, "node_modules", ".bin"))) {
        if (!force) {
          throw new Error(
            `the storage folder of ${root} cannot be removed without its tools; run \`pnpm install --frozen-lockfile\` there and remove it again, or pass --force to leave the storage folder behind`,
          );
        }
        log(`storage folder of ${owner} left behind: the worktree's tools are not installed\n`);
        return;
      }
      const status = run({
        cwd: root,
        args: ["--silent", "--filter", "@sebela/api", "storage", "remove", owner],
        env: worktreeEnv(env, root),
      });
      if (status !== 0) {
        throw new Error(
          `the storage folder of ${root} could not be removed (storage remove, exit ${status}); nothing else was removed`,
        );
      }
    },
  };
}
