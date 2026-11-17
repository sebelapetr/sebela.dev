// Maintenance adapter: manages API keys straight through the services, so it works against a
// migrated database without a running HTTP server and without an existing key.
import { pathToFileURL } from "node:url";

import { DomainError, openServices, readDatabaseConfig, type Services } from "@sebela/services";

export interface CommandOutput {
  out(text: string): void;
  err(text: string): void;
}

const USAGE = `Usage: api-keys <command>

  create <name>   Create a key and print it once. Only its hash is stored.
  list            List every key's id, name and times; never the key itself.
  revoke <id>     Revoke a key; its next request is refused.
`;

/**
 * Runs one API-key maintenance command (`create <name>`, `list`, `revoke <id>`) through the
 * services and returns the exit code: 0 on success, 1 for an expected failure, 2 for bad usage.
 */
export async function runApiKeyCommand(
  args: readonly string[],
  services: Pick<Services, "apiKeys">,
  output: CommandOutput,
): Promise<number> {
  const [command, ...rest] = args;
  const argument = rest.join(" ").trim();
  try {
    if (command === "create" && argument) {
      const { key, metadata } = await services.apiKeys.createKey(argument);
      output.out(
        `Created key "${metadata.name}" (id ${metadata.id}).\n\n${key}\n\n` +
          "Store it now; it is not shown again.\n",
      );
      return 0;
    }
    if (command === "list" && !argument) {
      const keys = await services.apiKeys.listKeys();
      if (keys.length === 0) output.out("No keys.\n");
      for (const key of keys) {
        output.out(
          `${key.id}  ${key.name}  created ${key.createdAt}  last used ${key.lastUsedAt ?? "never"}` +
            `  ${key.revokedAt ? `revoked ${key.revokedAt}` : "active"}\n`,
        );
      }
      return 0;
    }
    if (command === "revoke" && argument) {
      const revoked = await services.apiKeys.revokeKey(argument);
      output.out(`Revoked key "${revoked.name}" (id ${revoked.id}).\n`);
      return 0;
    }
  } catch (error) {
    if (error instanceof DomainError) {
      output.err(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
  output.err(USAGE);
  return 2;
}

async function main() {
  const services = openServices(readDatabaseConfig(process.env));
  try {
    process.exitCode = await runApiKeyCommand(process.argv.slice(2), services, {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    });
  } finally {
    await services.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
