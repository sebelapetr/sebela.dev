#!/usr/bin/env node
// PreToolUse hook: refuses the actions listed in docs/permissions.md. Rules: ../lib/guard.mjs.

import { execFileSync } from "node:child_process";
import { evaluateToolCall } from "../lib/guard.mjs";
import { mainRootFrom } from "../worktree.mjs";
import { readHookInput } from "./read-input.mjs";

function lookupPrBase(number) {
  return execFileSync("gh", ["pr", "view", String(number), "--json", "baseRefName", "-q", ".baseRefName"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 15_000,
  }).trim();
}

function currentBranchIn(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

try {
  const input = await readHookInput();
  const cwd = input.cwd ?? process.cwd();
  const isBash = input.tool_name === "Bash";
  const verdict = evaluateToolCall({
    toolName: input.tool_name,
    toolInput: input.tool_input,
    // The project directory comes from Claude Code, not from the tool call.
    mainRoot: mainRootFrom(process.env.CLAUDE_PROJECT_DIR ?? cwd),
    cwd,
    isSubagent: Boolean(input.agent_id),
    unattended: process.env.SEBELA_UNATTENDED === "1",
    lookupPrBase,
    currentBranch: isBash ? currentBranchIn(cwd) : null,
  });
  if (verdict) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: verdict.reason,
        },
      }),
    );
  }
} catch (error) {
  process.stderr.write(`pre-tool-use guard failed: ${error.message}\n`);
  // Unattended, nobody is watching: a broken guard refuses. Interactively, the owner sees the
  // error and the permission rules still decide.
  if (process.env.SEBELA_UNATTENDED === "1") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `The guard failed (${error.message}); refusing while unattended.`,
        },
      }),
    );
  }
}
