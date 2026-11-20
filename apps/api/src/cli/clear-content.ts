// Maintenance adapter: clears the profile and the AI roadmap straight through the services after
// the operator confirms the database's name, so it works without a running HTTP server.
import { pathToFileURL } from "node:url";

import { openServices, readDatabaseConfig, readMediaConfig, type Services } from "@sebela/services";

import { logCleanupFailure } from "../modules/media/index.js";
import type { CommandOutput } from "./api-keys.js";

const USAGE = `Usage: clear-content --confirm <database>

  Empties every table of the profile and the AI roadmap and deletes their stored media files. API
  keys and the audit of earlier changes stay, and the migrations stay applied, so the database is
  empty and ready for content again. <database> must be the name of the configured database.
  Take a backup first; infra/scripts/clear-demo.sh does so before it runs this command.
`;

/**
 * Runs the clear-content command (`--confirm <database>`) and returns the exit code: 0 when the
 * content is cleared, 1 when the confirmation names another database, 2 for bad usage.
 */
export async function runClearContentCommand(
  args: readonly string[],
  services: Pick<Services, "seed">,
  output: CommandOutput,
  databaseName: string,
): Promise<number> {
  const [flag, confirmation, ...extra] = args;
  if (flag !== "--confirm" || confirmation === undefined || confirmation === "" || extra.length) {
    output.err(USAGE);
    return 2;
  }
  if (confirmation !== databaseName) {
    output.err("The confirmation does not match the configured database; nothing was cleared.\n");
    return 1;
  }
  const report = await services.seed.clearContent();
  const { removed, failed } = report.media;
  output.out("The profile and the AI roadmap are empty.\n");
  output.out(`media: ${String(removed)} removed, ${String(failed)} failed\n`);
  return 0;
}

async function main() {
  const database = readDatabaseConfig(process.env);
  const services = openServices(database, {
    media: {
      config: readMediaConfig(process.env),
      onCleanupFailure: logCleanupFailure((line) => process.stderr.write(`${line}\n`)),
    },
  });
  try {
    process.exitCode = await runClearContentCommand(
      process.argv.slice(2),
      services,
      { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) },
      database.name,
    );
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
