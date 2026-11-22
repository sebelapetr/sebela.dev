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
import { backendMaintenance } from "./lib/backend.mjs";
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
  portsForSlot,
  storageWorktreeName,
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

// The ref a new branch is cut from, by name: `HEAD` is the branch the main checkout is on.
function baseName(mainRoot, base) {
  if (base !== "HEAD") return base;
  try {
    return git(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: mainRoot });
  } catch {
    return base;
  }
}

function checkedOutBranches(mainRoot) {
  return git(["worktree", "list", "--porcelain"], { cwd: mainRoot })
    .split("\n")
    .filter((line) => line.startsWith("branch refs/heads/"))
    .map((line) => line.slice("branch refs/heads/".length));
}

// Whether `base` already holds the work of a branch (`<name>` or `origin/<name>`): the branch is
// an ancestor of it, or its changes since the common ancestor are in it as one commit, which is
// what a squash merge leaves. A local branch with a worktree counts as unfinished whatever it
// holds: an interrupted agent may not have committed yet.
function mergedInto(mainRoot, name, base) {
  const remote = name.startsWith("origin/");
  if (!remote && checkedOutBranches(mainRoot).includes(name)) return false;
  const ref = remote ? `refs/remotes/${name}` : `refs/heads/${name}`;
  if (gitSucceeds(["merge-base", "--is-ancestor", ref, base], mainRoot)) return true;
  try {
    const fork = git(["merge-base", ref, base], { cwd: mainRoot });
    // The branch as one commit; `git cherry` marks it `-` when the base has an equal change.
    const squashed = git(["commit-tree", `${ref}^{tree}`, "-p", fork, "-m", "squashed"], {
      cwd: mainRoot,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "worktree",
        GIT_AUTHOR_EMAIL: "worktree@example.invalid",
        GIT_COMMITTER_NAME: "worktree",
        GIT_COMMITTER_EMAIL: "worktree@example.invalid",
      },
    });
    return git(["cherry", base, squashed], { cwd: mainRoot }).startsWith("-");
  } catch {
    return false;
  }
}

// Creates the worktree of `branch` (or reuses it), gives it a slot, its own database and its own
// role, and only then writes its environment file with the role's credentials and its own storage
// folder. Then the backend stages run in the worktree (lib/backend.mjs): install, migrations,
// storage and the seed of an empty profile, also for an existing worktree. A failing stage is
// thrown and keeps the worktree, its environment file, its database and its slot, so running create
// again retries it. An existing
// environment file (or a symbolic link in its place) is never touched and the role keeps its
// password; a missing one is generated with a new password. When the database or role cannot be
// ensured, whatever this call added is undone (a new worktree and branch, a new slot) and the
// error is thrown; an existing worktree keeps its slot and its environment file. The password is
// written only to the environment file, never returned.
//
// The branch is created as requested, with one exception, for an interrupted issue of the phase
// loop: when it does not exist and is cut from a phase branch, an unmerged branch of the same
// issue under another name is continued instead (existingIssueBranch in lib/slots.mjs has the
// whole rule). That is told to `notice` before anything is set up, naming both branches, and is
// in the result as `requested` and `resumed`.
export function createWorktree({
  branch: requested,
  base = "HEAD",
  mainRoot = mainRootFrom(),
  env = process.env,
  databases = defaultDatabases(env),
  backend = backendMaintenance({ env }),
  notice = (message) => console.error(message),
}) {
  // Configuration is validated before anything is created.
  const settings = loadSettings(env);
  const basePorts = basePortsFrom(settings);
  if (!settings.API_HOST) {
    throw new Error("API_HOST is not set; set it in the environment (documented in .env.example)");
  }
  if (!settings.WEB_HOST) {
    throw new Error("WEB_HOST is not set; set it in the environment (documented in .env.example)");
  }
  if (!settings.STORAGE_ENVIRONMENT) {
    throw new Error(
      "STORAGE_ENVIRONMENT is not set; set it in the environment (documented in .env.example)",
    );
  }
  if (!settings.AI_SERVICE_HOST) {
    throw new Error(
      "AI_SERVICE_HOST is not set; set it in the environment (documented in .env.example)",
    );
  }
  const agent = agentVersions();
  const p = paths(mainRoot);
  fs.mkdirSync(p.dir, { recursive: true });
  const resumed = branchExistsIn(mainRoot, requested)
    ? null
    : existingIssueBranch(requested, allBranches(mainRoot), {
        base: baseName(mainRoot, base),
        merged: (name) => mergedInto(mainRoot, name, base),
      });
  const branch = resumed ?? requested;
  if (resumed) notice(continuedNotice(requested, resumed));
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
        envFileContent(slot, basePorts, {
          DATABASE_NAME: database,
          ...credentials,
          STORAGE_WORKTREE: storageWorktreeName(name),
          STORAGE_PUBLIC_BASE_URL: `http://${settings.API_HOST}:${portsForSlot(slot, basePorts).API_PORT}/v1/media/files`,
          // The website's image optimizer fetches only this worktree's own media folder.
          WEB_MEDIA_BASE_URL: `http://${settings.API_HOST}:${portsForSlot(slot, basePorts).API_PORT}/v1/media/files/${settings.STORAGE_ENVIRONMENT}/${storageWorktreeName(name)}`,
          // The website reads this worktree's own API, not the main checkout's.
          WEB_API_BASE_URL: `http://${settings.API_HOST}:${portsForSlot(slot, basePorts).API_PORT}`,
          // MCP Admin, too, reaches only this worktree's own API.
          MCP_ADMIN_API_URL: `http://${settings.API_HOST}:${portsForSlot(slot, basePorts).API_PORT}`,
          // Its canonical links, sitemap and llms.txt name the worktree's own website.
          WEB_SITE_ORIGIN: `http://${settings.WEB_HOST}:${portsForSlot(slot, basePorts).WEB_PORT}`,
          // The API signs its invalidations for the worktree's own website with a secret of its own.
          API_WEB_INVALIDATION_URL: `http://${settings.WEB_HOST}:${portsForSlot(slot, basePorts).WEB_PORT}/internal/invalidation`,
          ...invalidationSecrets(randomPassword()),
          // The visitor chat runs against the worktree's own AI service, with secrets of its own.
          ...chatSettings({ settings, ports: portsForSlot(slot, basePorts), agent }),
        }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Written by someone else meanwhile: kept, but its credentials no longer work.
      throw new Error(
        `${envPath} appeared while the worktree was set up and was kept, but role ${credentials.DATABASE_USER} now has a new password it does not hold; delete it and run create again`,
        { cause: error },
      );
    }
  }

  backend.setup({ root: worktreePath, owner: name });
  return { path: worktreePath, slot, name, database, ...(resumed ? { requested, resumed } : {}) };
}

// What a caller is told when it does not get the branch it asked for.
export function continuedNotice(requested, resumed) {
  return (
    `NOTICE: branch ${requested} was not created. Continuing branch ${resumed} instead: ` +
    `an earlier, unmerged branch of the same issue. To start ${requested} anyway, merge, ` +
    `rename or delete ${resumed} first.`
  );
}

// The same server-only signing secret for the API's sender and the website's receiver.
function invalidationSecrets(secret) {
  return { API_WEB_INVALIDATION_SECRET: secret, WEB_INVALIDATION_SECRET: secret };
}

// Cloudflare's published Turnstile test keys: they always pass and are refused in production.
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

// The model and pricing version the AI service accepts, read from the agent package of the
// harness's own revision, so the API's dispatches match the agent of the same checkout.
const AGENT_CONFIG_FILE = path.join(
  CHECKOUT_ROOT,
  "packages/llm-agent/src/llm_agent/models/config.py",
);

function agentVersions(file = AGENT_CONFIG_FILE) {
  const source = fs.readFileSync(file, "utf8");
  const constant = (name) => {
    const match = new RegExp(`^${name}: Final = "([^"]+)"$`, "m").exec(source);
    if (!match) throw new Error(`${file} does not define ${name}`);
    return match[1];
  };
  return { model: constant("HAIKU"), pricingVersion: constant("PRICING_VERSION") };
}

// The visitor chat's development settings for one worktree. The API's sender and the AI service's
// receiver share one generated token, the reverse direction a second; the quota fingerprint key is a
// third, and the website's chat relay and the API share a fourth. Every address is derived from the worktree's own ports; the Turnstile keys are the test
// keys, issued for the worktree's website host; the model is the fictional one.
function chatSettings({ settings, ports, agent }) {
  const serviceToken = randomPassword();
  const controlToken = randomPassword();
  const relayToken = randomPassword();
  return {
    API_CHAT_ALLOWED_ORIGINS: `http://${settings.WEB_HOST}:${ports.WEB_PORT}`,
    API_CHAT_COOKIE_SECURE: "false",
    API_CHAT_FINGERPRINT_KEY: randomPassword(),
    API_CHAT_MODEL: agent.model,
    API_CHAT_PRICING_VERSION: agent.pricingVersion,
    API_CHAT_RELAY_TOKEN: relayToken,
    API_TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
    API_TURNSTILE_EXPECTED_HOSTNAME: settings.WEB_HOST,
    API_AI_SERVICE_URL: `http://${settings.AI_SERVICE_HOST}:${ports.LLM_AGENT_PORT}`,
    API_AI_SERVICE_TOKEN: serviceToken,
    API_AI_CONTROL_TOKEN: controlToken,
    WEB_TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
    WEB_CHAT_RELAY_TOKEN: relayToken,
    AI_SERVICE_HOST: settings.AI_SERVICE_HOST,
    AI_SERVICE_API_URL: `http://${settings.API_HOST}:${ports.API_PORT}`,
    AI_SERVICE_TOKEN: serviceToken,
    AI_SERVICE_CONTROL_TOKEN: controlToken,
    AI_SERVICE_MODEL: "fake",
  };
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

// Removes the worktree's storage folder and drops its databases and its role first, then removes the
// worktree and frees its slot. Uncommitted work, storage that cannot be removed or a database or role
// that cannot be dropped stops the removal before anything else is changed.
export function removeWorktree({
  target,
  force = false,
  deleteBranch = false,
  mainRoot = mainRootFrom(),
  env = process.env,
  databases = defaultDatabases(env),
  backend = backendMaintenance({ env }),
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

  // The storage folder is found through the worktree's own settings and tools, so it goes first.
  if (exists) backend.teardown({ root: worktreePath, owner: name, force });
  else backend.teardownMissing({ owner: name });

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
    // Said again after the set-up output, next to the path the caller reads.
    if (result.resumed) console.error(continuedNotice(result.requested, result.resumed));
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
