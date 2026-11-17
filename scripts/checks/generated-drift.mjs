// Generated-code drift check: runs a generator, then fails when the committed generated folders no
// longer match what it produced (a changed, added or removed file). Plain Node, no dependencies.
//
// Usage: node scripts/checks/generated-drift.mjs <folder>... -- <command> [<argument>...]
// Run from the repository root (or the folder the paths are relative to) with a clean checkout of
// the folders; the regenerated output is left in place so it can be inspected or committed.

import { spawnSync } from "node:child_process";

const USAGE =
  "Usage: generated-drift <folder>... -- <command> [<argument>...]\n" +
  "  Runs <command>, then fails if any <folder> differs from the committed files.\n";

function parse(argv) {
  const separator = argv.indexOf("--");
  if (separator <= 0 || separator === argv.length - 1) return undefined;
  return { folders: argv.slice(0, separator), command: argv.slice(separator + 1) };
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function main(argv) {
  const parsed = parse(argv);
  if (!parsed) {
    process.stderr.write(USAGE);
    return 2;
  }
  const { folders, command } = parsed;
  const shown = command.join(" ");

  const generated = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
  if (generated.status !== 0) {
    const reason = generated.error ? generated.error.message : `exit ${String(generated.status)}`;
    process.stderr.write(`Generation failed (${reason}): ${shown}\n`);
    return 1;
  }

  // Untracked files count as drift too, so additions are caught as well as changes and removals.
  const status = git(["status", "--porcelain", "--untracked-files=all", "--", ...folders]);
  if (status.trim() === "") {
    process.stdout.write(`Generated files are up to date: ${folders.join(", ")}\n`);
    return 0;
  }

  process.stderr.write(
    "Generated files differ from what is committed:\n" +
      status +
      "\n" +
      git(["--no-pager", "diff", "--stat", "--", ...folders]) +
      `\nRegenerate with \`${shown}\` and commit the result.\n`,
  );
  return 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
