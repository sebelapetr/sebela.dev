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

try {
  const input = await readHookInput();
  const cwd = input.cwd ?? process.cwd();
  const verdict = evaluateToolCall({
    toolName: input.tool_name,
    toolInput: input.tool_input,
    mainRoot: mainRootFrom(cwd),
    cwd,
    isSubagent: Boolean(input.agent_id),
    unattended: process.env.SEBELA_UNATTENDED === "1",
    lookupPrBase,
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
  // A broken guard must not stop all work; it reports and lets permissions decide.
  process.stderr.write(`pre-tool-use guard failed: ${error.message}\n`);
}
