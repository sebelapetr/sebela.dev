#!/usr/bin/env node
// Creates and removes worktrees with their own slot (ports) — see docs/repository-structure.md.
//
//   node scripts/harness/worktree.mjs create <branch> [--base <ref>]
//   node scripts/harness/worktree.mjs remove <branch-or-path> [--force] [--delete-branch]
//   node scripts/harness/worktree.mjs list
//
// `create` prints the worktree path as its last line (the WorktreeCreate hook relies on it).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allocateSlot,
  emptyState,
  envFileContent,
  freeSlot,
  worktreeDirName,
} from "./lib/slots.mjs";

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
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

export function createWorktree({ branch, base = "HEAD", mainRoot = mainRootFrom() }) {
  const p = paths(mainRoot);
  fs.mkdirSync(p.dir, { recursive: true });
  const name = worktreeDirName(branch);
  const worktreePath = path.join(p.dir, name);

  if (!fs.existsSync(worktreePath)) {
    if (gitSucceeds(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], mainRoot)) {
      git(["worktree", "add", worktreePath, branch], { cwd: mainRoot });
    } else if (gitSucceeds(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], mainRoot)) {
      git(["worktree", "add", "--track", "-b", branch, worktreePath, `origin/${branch}`], { cwd: mainRoot });
    } else {
      git(["worktree", "add", "--no-track", "-b", branch, worktreePath, base], { cwd: mainRoot });
    }
  }

  const slot = withLock(p.lock, () => {
    const result = allocateSlot(readState(p.state), name);
    writeState(p.state, result.state);
    return result.slot;
  });

  fs.writeFileSync(path.join(worktreePath, ".env.local"), envFileContent(slot));
  return { path: worktreePath, slot, name };
}

export function removeWorktree({ target, force = false, deleteBranch = false, mainRoot = mainRootFrom() }) {
  const p = paths(mainRoot);
  const name = path.isAbsolute(target) ? path.basename(target) : worktreeDirName(target);
  const worktreePath = path.join(p.dir, name);

  if (fs.existsSync(worktreePath)) {
    // The environment file is ours; anything else left behind is the agent's work and stops
    // the removal unless --force is given.
    const leftovers = git(["status", "--porcelain", "--untracked-files=all"], { cwd: worktreePath })
      .split("\n")
      .filter((line) => line && !line.endsWith(".env.local"));
    if (leftovers.length && !force) {
      throw new Error(
        `${name} has uncommitted work (${leftovers.length} file(s)); commit it or pass --force:\n${leftovers.join("\n")}`,
      );
    }
    fs.rmSync(path.join(worktreePath, ".env.local"), { force: true });
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
  return { path: worktreePath, name };
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
    console.error(`worktree ${result.name} on slot ${result.slot}`);
    console.log(result.path);
  } else if (command === "remove" && options._[0]) {
    const result = removeWorktree({ target: options._[0], force: options.force, deleteBranch: options.deleteBranch });
    console.error(`removed ${result.name}`);
  } else if (command === "list") {
    for (const { slot, name } of listWorktrees()) console.log(`${slot}\t${name}`);
  } else {
    console.error("usage: worktree.mjs create <branch> [--base <ref>] | remove <branch-or-path> [--force] [--delete-branch] | list");
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
