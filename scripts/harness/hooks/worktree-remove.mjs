#!/usr/bin/env node
// WorktreeRemove hook: removes the worktree and frees its slot.

import { mainRootFrom, removeWorktree } from "../worktree.mjs";
import { readHookInput } from "./read-input.mjs";

try {
  const input = await readHookInput();
  if (!input.worktree_path) throw new Error("WorktreeRemove input has no worktree_path");
  const mainRoot = mainRootFrom(input.cwd ?? process.cwd());
  removeWorktree({ target: input.worktree_path, mainRoot });
} catch (error) {
  process.stderr.write(`worktree-remove hook failed: ${error.message}\n`);
  process.exit(1);
}
