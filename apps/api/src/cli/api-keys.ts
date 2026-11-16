import type { Services } from "@sebela/services";

export interface CommandOutput {
  out(text: string): void;
  err(text: string): void;
}

/**
 * Runs one API-key maintenance command (`create <name>`, `list`, `revoke <id>`) through the
 * services and returns the exit code.
 */
export async function runApiKeyCommand(
  args: readonly string[],
  services: Pick<Services, "apiKeys">,
  output: CommandOutput,
): Promise<number> {
  output.err(`Not implemented yet: ${args.join(" ")}\n`);
  await services.apiKeys.listKeys();
  return 1;
}
