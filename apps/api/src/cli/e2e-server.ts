// Test support, excluded from the build: serves the API on a database and a storage folder of its
// own, filled from one seed folder, for the browser tests of the apps that read it (apps/web,
// "End-to-end tests"). Never touches the checkout's database or storage. Run with tsx:
//
//   node --import tsx src/cli/e2e-server.ts <seed-folder>
//
// It takes the usual API settings from the environment (`.env.example`), except the database
// name, the storage folder and the storage environment, which are its own. On SIGTERM or SIGINT it
// stops, drops the database and removes the folder.
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { serve } from "@hono/node-server";

import { openServices, readDatabaseConfig, readMediaConfig } from "@sebela/services";
import { createTemporaryDatabase } from "@sebela/services/testing";

import { createApp, type Logger } from "../app.js";
import { readApiConfig } from "../config.js";
import { logCleanupFailure } from "../modules/media/index.js";

const log: Logger = (line) => {
  process.stdout.write(`${line}\n`);
};

async function main() {
  const [folder, ...extra] = process.argv.slice(2);
  if (folder === undefined || extra.length > 0) {
    throw new Error("Usage: e2e-server <seed-folder>");
  }
  // pnpm runs package scripts in the package folder; INIT_CWD is where the command was started.
  const seedFolder = resolve(process.env["INIT_CWD"] ?? process.cwd(), folder);

  const config = readApiConfig(process.env);
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  const database = await createTemporaryDatabase(readDatabaseConfig(process.env));
  const storageRoot = await mkdtemp(join(resolve("../../.tmp"), "e2e-storage-"));
  const cleanUp = async () => {
    await database.drop();
    await rm(storageRoot, { recursive: true, force: true });
  };

  let services: ReturnType<typeof openServices>;
  try {
    services = openServices(database.config, {
      media: {
        config: readMediaConfig({
          ...process.env,
          STORAGE_DRIVER: "local",
          STORAGE_LOCAL_ROOT: storageRoot,
          STORAGE_ENVIRONMENT: "test",
          STORAGE_WORKTREE: "",
          STORAGE_PUBLIC_BASE_URL: `http://${host}:${String(config.port)}/v1/media/files`,
        }),
        onCleanupFailure: logCleanupFailure(log),
      },
    });
    await services.seed.loadSeed(seedFolder);
  } catch (error) {
    await cleanUp();
    throw error;
  }

  const { app } = createApp({ services, config, log });
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    log(`e2e API listening on http://${host}:${String(info.port)}`);
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      services
        .close()
        .then(cleanUp)
        .then(
          () => process.exit(0),
          (error: unknown) => {
            process.stderr.write(`Cleaning up the e2e API failed: ${String(error)}\n`);
            process.exit(1);
          },
        );
    });
    // The website keeps connections alive; end them so closing does not wait for their timeout.
    if ("closeAllConnections" in server) server.closeAllConnections();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
