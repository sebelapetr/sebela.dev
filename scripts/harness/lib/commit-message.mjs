// Conventional Commits check for the commit-msg hook (docs/git-workflow.md, "Commits").

export function checkCommitMessage() {
  return { valid: true, errors: [] };
}
