#!/usr/bin/env node
// WorktreeCreate hook: replaces Claude Code's default `git worktree add`, so that a worktree
// created by Claude Code gets a slot, its database and its .env.local like one created by the
// scripts: migrated, with its storage folder and the demo seed in an empty profile. Without a
// running database service the hook fails and no worktree is created; a failing backend stage
// fails the hook and keeps the worktree, so creating it again retries.
// Must print the worktree path as the last line of stdout; everything else goes to stderr.

import { createWorktree, mainRootFrom } from "../worktree.mjs";
import { readHookInput } from "./read-input.mjs";

try {
  const input = await readHookInput();
  if (!input.name) throw new Error("WorktreeCreate input has no name");
  const mainRoot = mainRootFrom(input.cwd ?? process.cwd());
  const result = createWorktree({ branch: input.name, base: "HEAD", mainRoot });
  process.stderr.write(
    `worktree ${result.name} on slot ${result.slot} with database ${result.database}\n`,
  );
  process.stdout.write(`${result.path}\n`);
} catch (error) {
  process.stderr.write(`worktree-create hook failed: ${error.message}\n`);
  process.exit(1);
}
