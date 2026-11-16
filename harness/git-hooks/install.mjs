#!/usr/bin/env node
// Enables the repository's Git hooks; the root `prepare` script runs it on every `pnpm install`
// (docs/git-workflow.md, "Local hooks").
//
// It sets `core.hooksPath` to the relative path of this folder. Git resolves a relative hooks path
// in the top level of the worktree a hook runs in, so every worktree runs the hooks it checked
// out, and the setting, written once, serves all worktrees of the repository.
//
// It never takes over: a hooks path configured for something else is kept and reported, and the
// phase loop, which does not change repository settings (docs/permissions.md), only reports.
// Outside a Git checkout, for example in an unpacked archive, there is nothing to enable.

import { spawnSync } from "node:child_process";

const HOOKS_PATH = "harness/git-hooks";
// Where the hooks lived before the harness moved to the top level (docs/decisions/0013). A
// checkout configured then points at a folder that no longer exists; that setting is ours to move.
const FORMER_HOOKS_PATHS = new Set(["scripts/harness/git-hooks"]);

function git(args) {
  const run = spawnSync("git", args, { encoding: "utf8" });
  if (run.error) throw run.error;
  return run;
}

function enableHooks(env) {
  if (git(["rev-parse", "--is-inside-work-tree"]).stdout.trim() !== "true") {
    return { notice: "Git hooks: not a Git checkout, nothing to enable." };
  }
  const configured = git(["config", "--get", "core.hooksPath"]).stdout.trim();
  if (configured === HOOKS_PATH) return { notice: `Git hooks: enabled (${HOOKS_PATH}).` };
  if (configured && !FORMER_HOOKS_PATHS.has(configured)) {
    return {
      warning:
        `Git hooks: not enabled, because core.hooksPath is already set to "${configured}". ` +
        `To use this repository's hooks, set it to ${HOOKS_PATH}.`,
    };
  }
  if (env.SEBELA_UNATTENDED === "1") {
    return {
      warning:
        "Git hooks: not enabled; the phase loop does not change repository settings. " +
        "Run `pnpm install` once in the main checkout to enable them for every worktree.",
    };
  }
  const run = git(["config", "--local", "core.hooksPath", HOOKS_PATH]);
  if (run.status !== 0) throw new Error(`git config failed: ${run.stderr.trim()}`);
  return {
    notice: `Git hooks: enabled (${HOOKS_PATH}): staged files are formatted and linted, commit messages checked.`,
  };
}

try {
  const { notice, warning } = enableHooks(process.env);
  if (notice) process.stdout.write(`${notice}\n`);
  if (warning) process.stderr.write(`${warning}\n`);
} catch (error) {
  process.stderr.write(`Git hooks could not be enabled: ${error.message}\n`);
  process.exit(1);
}
