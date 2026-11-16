#!/usr/bin/env node
// PreCompact hook: before Claude Code compacts a context, manually or automatically, it prints what
// the summary must keep. Claude Code uses this output as instructions for the compaction summary.
// It never blocks compaction. Intent: docs/agents.md, "Compaction".

const INSTRUCTIONS = `When you summarise this conversation, keep exactly what the next steps need:

- The issue number, its branch and the absolute path of the worktree the work happens in.
- The issue's acceptance criteria verbatim, not paraphrased, with which are met and which are not.
- Test-first state: which tests are written, which were seen failing, which are committed, and which still fail.
- The files changed so far, and the last error or test output that is still unresolved, quoted.
- The reviewer's objections verbatim, and which of them are fixed.
- Decisions made and why, including any refusal by the guard and the allowed way taken instead.
- What remains to be done before handing back, in order.

Leave out what is finished and verified, file contents that can be read again, and repeated tool output.`;

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  // The owner's own /compact instructions are passed on by Claude Code; ours only add to them.
  process.stdout.write(INSTRUCTIONS);
  process.exitCode = 0;
});
process.stdin.on("error", () => {
  process.stdout.write(INSTRUCTIONS);
});
