#!/usr/bin/env node
// Creates and removes worktrees with their own slot (ports) and their own database in the shared
// Postgres — see docs/repository-structure.md ("Ports and worktree isolation").
//
//   node harness/worktree.mjs create <branch> [--base <ref>]
//   node harness/worktree.mjs remove <branch-or-path> [--force] [--delete-branch]
//   node harness/worktree.mjs list
//
// `create` prints the worktree path as its last line (the WorktreeCreate hook relies on it).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { randomPassword } from "./lib/credentials.mjs";
import { composeDatabases } from "./lib/databases.mjs";
import {
  allocateSlot,
  basePortsFrom,
  databaseName,
  emptyState,
  envFileContent,
  freeSlot,
  existingIssueBranch,
  worktreeDirName,
} from "./lib/slots.mjs";

// The checkout this script belongs to: its documented example configuration and its compose.yaml,
// so the harness, the ports it reads and the database service it uses come from the same revision.
const CHECKOUT_ROOT = path.join(import.meta.dirname, "..");
const EXAMPLE_FILE = path.join(CHECKOUT_ROOT, ".env.example");
const ENV_FILE = ".env.local";

// Settings from the process environment, falling back to the documented example for any that are
// not set.
export function loadSettings(env = process.env) {
  let example = {};
  try {
    example = parseEnv(fs.readFileSync(EXAMPLE_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { ...example, ...env };
}

// Base ports from the settings. Throws when a port is missing or invalid.
export function loadBasePorts(env = process.env) {
  return basePortsFrom(loadSettings(env));
}

// The databases of the shared Postgres, reached through this checkout's compose.yaml.
function defaultDatabases(env) {
  return composeDatabases({ root: CHECKOUT_ROOT, env: loadSettings(env) });
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function gitSucceeds(args, cwd) {
  try {
    git(args, { cwd });
    return true;
  } catch {
    return false;
  }
}

export function mainRootFrom(cwd = process.cwd()) {
  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd });
  return path.dirname(commonDir);
}

function paths(mainRoot) {
  const dir = path.join(mainRoot, ".worktrees");
  return { dir, state: path.join(dir, ".slots.json"), lock: path.join(dir, ".lock") };
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return emptyState();
  }
}

function writeState(file, state) {
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

function withLock(lockDir, fn) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || Date.now() > deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

function branchExistsIn(mainRoot, branch) {
  return (
    gitSucceeds(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], mainRoot) ||
    gitSucceeds(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], mainRoot)
  );
}

// Local branches as `<name>`, remote ones as `origin/<name>`.
function allBranches(mainRoot) {
  return git(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes/origin"], {
    cwd: mainRoot,
  })
    .split("\n")
    .filter(Boolean)
    .map((ref) => ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\//, ""));
}

// Creates the worktree of `branch` (or reuses it), gives it a slot, its own database and its own
// role, and only then writes its environment file with the role's credentials. An existing
// environment file (or a symbolic link in its place) is never touched and the role keeps its
// password; a missing one is generated with a new password. When the database or role cannot be
// ensured, whatever this call added is undone (a new worktree and branch, a new slot) and the
// error is thrown; an existing worktree keeps its slot and its environment file. The password is
// written only to the environment file, never returned.
export function createWorktree({
  branch: requested,
  base = "HEAD",
  mainRoot = mainRootFrom(),
  env = process.env,
  databases = defaultDatabases(env),
}) {
  // Configuration is validated before anything is created.
  const basePorts = loadBasePorts(env);
  const p = paths(mainRoot);
  fs.mkdirSync(p.dir, { recursive: true });
  const resumed = branchExistsIn(mainRoot, requested)
    ? null
    : existingIssueBranch(requested, allBranches(mainRoot));
  const branch = resumed ?? requested;
  const name = worktreeDirName(branch);
  const database = databaseName(name);
  const worktreePath = path.join(p.dir, name);

  let added = null;
  if (!fs.existsSync(worktreePath)) {
    if (gitSucceeds(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], mainRoot)) {
      git(["worktree", "add", worktreePath, branch], { cwd: mainRoot });
      added = { branch: false };
    } else if (
      gitSucceeds(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], mainRoot)
    ) {
      git(["worktree", "add", "--track", "-b", branch, worktreePath, `origin/${branch}`], {
        cwd: mainRoot,
      });
      added = { branch: true };
    } else {
      git(["worktree", "add", "--no-track", "-b", branch, worktreePath, base], { cwd: mainRoot });
      added = { branch: true };
    }
  }

  const envPath = path.join(worktreePath, ENV_FILE);
  let slot;
  let credentials = null;
  try {
    // The database is ensured under the lock, so a slot is only kept by a worktree with a database.
    slot = withLock(p.lock, () => {
      const before = readState(p.state);
      const result = allocateSlot(before, name);
      const newSlot = result.state !== before;
      if (newSlot) writeState(p.state, result.state);
      try {
        const password = fileExists(envPath) ? undefined : randomPassword();
        const { user } = databases.ensure(database, name, { password });
        if (password !== undefined)
          credentials = { DATABASE_USER: user, DATABASE_PASSWORD: password };
      } catch (error) {
        if (newSlot) writeState(p.state, freeSlot(readState(p.state), name));
        throw error;
      }
      return result.slot;
    });
  } catch (error) {
    if (added) undoAdd({ mainRoot, worktreePath, branch, deleteBranch: added.branch, error });
    throw error;
  }

  // Exclusive creation preserves local edits and never follows an existing symbolic link. Only its
  // owner may read the file, as it holds the password.
  if (credentials) {
    try {
      fs.writeFileSync(
        envPath,
        envFileContent(slot, basePorts, { DATABASE_NAME: database, ...credentials }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  return { path: worktreePath, slot, name, database, ...(resumed ? { resumed } : {}) };
}

// Also true for a symbolic link, whether or not it leads anywhere.
function fileExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// Removes a worktree this call has just added; it holds no work yet. A failure here is added to the
// error that caused it, which is thrown afterwards.
function undoAdd({ mainRoot, worktreePath, branch, deleteBranch, error }) {
  try {
    git(["worktree", "remove", "--force", worktreePath], { cwd: mainRoot });
    if (deleteBranch) git(["branch", "-D", branch], { cwd: mainRoot });
  } catch (undoError) {
    error.message += `; removing the new worktree ${worktreePath} also failed: ${undoError.stderr?.toString().trim() || undoError.message}`;
  }
}

// Drops the worktree's databases and its role first, then removes the worktree and frees its slot.
// Uncommitted work or a database or role that cannot be dropped stops the removal before anything
// else is changed.
export function removeWorktree({
  target,
  force = false,
  deleteBranch = false,
  mainRoot = mainRootFrom(),
  env = process.env,
  databases = defaultDatabases(env),
}) {
  const p = paths(mainRoot);
  const name = path.isAbsolute(target) ? path.basename(target) : worktreeDirName(target);
  const database = databaseName(name);
  const worktreePath = path.join(p.dir, name);
  const exists = fs.existsSync(worktreePath);

  if (exists) {
    // The environment file is ours; anything else left behind is the agent's work and stops
    // the removal unless --force is given.
    const leftovers = git(["status", "--porcelain", "--untracked-files=all"], { cwd: worktreePath })
      .split("\n")
      .filter((line) => line && !line.endsWith(ENV_FILE));
    if (leftovers.length && !force) {
      throw new Error(
        `${name} has uncommitted work (${leftovers.length} file(s)); commit it or pass --force:\n${leftovers.join("\n")}`,
      );
    }
  }

  // Also when the folder is already gone, so a database or role left behind by an earlier attempt
  // goes too.
  databases.drop(database, name);

  if (exists) {
    fs.rmSync(path.join(worktreePath, ENV_FILE), { force: true });
    git(["worktree", "remove", ...(force ? ["--force"] : []), worktreePath], { cwd: mainRoot });
  }
  git(["worktree", "prune"], { cwd: mainRoot });
  // After a squash merge git cannot tell the branch was merged, so deleting it is an explicit choice.
  if (deleteBranch && !path.isAbsolute(target)) {
    try {
      git(["branch", "-D", target], { cwd: mainRoot });
    } catch {
      // already gone
    }
  }

  withLock(p.lock, () => writeState(p.state, freeSlot(readState(p.state), name)));
  return { path: worktreePath, name, database };
}

export function listWorktrees({ mainRoot = mainRootFrom() } = {}) {
  const state = readState(paths(mainRoot).state);
  return Object.entries(state.slots).map(([slot, name]) => ({ slot: Number(slot), name }));
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--base") options.base = rest[++i];
    else if (rest[i] === "--force") options.force = true;
    else if (rest[i] === "--delete-branch") options.deleteBranch = true;
    else options._.push(rest[i]);
  }
  return { command, options };
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "create" && options._[0]) {
    const result = createWorktree({ branch: options._[0], base: options.base });
    if (result.resumed) console.error(`issue already has branch ${result.resumed}; continuing it`);
    console.error(
      `worktree ${result.name} on slot ${result.slot} with database ${result.database}`,
    );
    console.log(result.path);
  } else if (command === "remove" && options._[0]) {
    const result = removeWorktree({
      target: options._[0],
      force: options.force,
      deleteBranch: options.deleteBranch,
    });
    console.error(`removed ${result.name}, its databases and its role ${result.database}`);
  } else if (command === "list") {
    for (const { slot, name } of listWorktrees()) console.log(`${slot}\t${name}`);
  } else {
    console.error(
      "usage: worktree.mjs create <branch> [--base <ref>] | remove <branch-or-path> [--force] [--delete-branch] | list",
    );
    process.exit(64);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.stderr?.toString().trim() || error.message);
    process.exit(1);
  }
}
