// Maintenance adapter: loads a seed folder straight through the services. Not implemented yet.
import type { Services } from "@sebela/services";

import type { CommandOutput } from "./api-keys.js";

export function runSeedCommand(
  args: readonly string[],
  services: Pick<Services, "seed">,
  output: CommandOutput,
  cwd: string = process.cwd(),
): Promise<number> {
  output.err(`Usage: seed [folder] (${String(args.length)} ${typeof services} ${cwd})\n`);
  return Promise.resolve(2);
}
