// Maintenance adapter: clears the profile and the AI roadmap straight through the services after
// the operator confirms the database's name, so it works without a running HTTP server.
import type { Services } from "@sebela/services";

import type { CommandOutput } from "./api-keys.js";

/**
 * Runs the clear-content command (`--confirm <database>`) and returns the exit code: 0 when the
 * content is cleared, 1 when the confirmation names another database, 2 for bad usage.
 */
export function runClearContentCommand(
  args: readonly string[],
  services: Pick<Services, "seed">,
  output: CommandOutput,
  databaseName: string,
): Promise<number> {
  return Promise.reject(
    new Error("not implemented", { cause: { args, services, output, databaseName } }),
  );
}
