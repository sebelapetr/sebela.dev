#!/usr/bin/env node
// PostToolUse hook on Bash: after an issue pull request is merged, remind the orchestrator
// to run the docs-keeper on the merged change (docs/agents.md, step 9).

import { invokesPrMerge } from "../lib/guard.mjs";
import { readHookInput } from "./read-input.mjs";

try {
  const input = await readHookInput();
  if (invokesPrMerge(input.tool_input?.command)) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext:
            "A pull request was merged. Next: run the docs-keeper agent on the merged change, close the issue with a comment naming the pull request, then remove the worktree and its branch with `node harness/worktree.mjs remove <branch> --delete-branch`.",
        },
      }),
    );
  }
} catch (error) {
  process.stderr.write(`post-tool-use hook failed: ${error.message}\n`);
}
