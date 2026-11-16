#!/usr/bin/env node
// Git commit-msg hook (started by ./commit-msg): refuses a message that is not in Conventional
// Commits form. Rules: ../lib/commit-message.mjs and docs/git-workflow.md ("Commits").

import fs from "node:fs";
import { checkCommitMessage } from "../lib/commit-message.mjs";

try {
  const file = process.argv[2];
  if (!file) throw new Error("Git did not pass the commit message file");
  const { valid, errors } = checkCommitMessage(fs.readFileSync(file, "utf8"));
  if (!valid) {
    process.stderr.write(
      `commit-msg: the commit message does not follow Conventional Commits (docs/git-workflow.md):\n` +
        errors.map((error) => `  - ${error}\n`).join("") +
        `Example: feat(api): add experience endpoints\n`,
    );
    process.exit(1);
  }
} catch (error) {
  process.stderr.write(`commit-msg hook failed: ${error.message}\n`);
  process.exit(1);
}
