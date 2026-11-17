import type { CommandOutput } from "./api-keys.js";

/** Not implemented yet. */
export function runStorageCommand(
  ...args: [readonly string[], Readonly<Record<string, string | undefined>>, CommandOutput, string?]
): Promise<number> {
  return Promise.reject(new Error(`Not implemented yet (${String(args.length)} arguments).`));
}
