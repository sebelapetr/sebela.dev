// Maintenance adapter: prepares or removes the storage folder of one development worktree, so the
// worktree script can provision and clean up storage without importing the services.
import { pathToFileURL } from "node:url";

import { openStorageNamespace, readStorageConfig } from "@sebela/services";

import type { CommandOutput } from "./api-keys.js";

const USAGE = `Usage: storage prepare <worktree> | storage remove <worktree>

  Prepares or removes the storage folder of a development worktree, <environment>/<worktree>/ as
  configured by STORAGE_ENVIRONMENT and STORAGE_WORKTREE. <worktree> is the worktree's name, recorded
  in the folder's owner marker; only the worktree that prepared a folder can remove it.

  prepare  Creates the folder and its owner marker, or reuses the folder this worktree holds.
  remove   Deletes every file of the folder this worktree holds; a missing folder is absent.
`;

const messages = {
  created: "The worktree's storage folder was created.\n",
  reused: "The worktree's storage folder was reused.\n",
  removed: "The worktree's storage folder was removed.\n",
  absent: "The worktree has no storage folder; nothing to remove.\n",
} as const;

/**
 * Runs the storage command and returns the exit code: 0 done, 1 for invalid settings (named, never
 * their values) or a refused folder, 2 for bad usage. Prints neither keys, paths nor credentials.
 */
export async function runStorageCommand(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  output: CommandOutput,
  cwd: string = process.cwd(),
): Promise<number> {
  const [command, owner, ...extra] = args;
  if ((command !== "prepare" && command !== "remove") || owner === undefined || extra.length > 0) {
    output.err(USAGE);
    return 2;
  }
  try {
    const namespace = openStorageNamespace(readStorageConfig(env, cwd), owner);
    const outcome = command === "prepare" ? await namespace.prepare() : await namespace.remove();
    output.out(messages[outcome]);
    return 0;
  } catch (error) {
    // Configuration errors name variables, refusals and storage failures name no path or value.
    const message =
      error instanceof Error && !("path" in error) ? error.message : "The storage request failed.";
    output.err(`${message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStorageCommand(process.argv.slice(2), process.env, {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
