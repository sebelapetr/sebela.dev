// Startup adapter: validates the configuration once, composes the services and the app, and
// listens. It never migrates the database; that is the db package's own command.
import { serve } from "@hono/node-server";

import {
  openServices,
  readDatabaseConfig,
  readMediaConfig,
  readRetrievalOptions,
} from "@sebela/services";

import { createApp, type Logger } from "./app.js";
import { readApiConfig } from "./config.js";
import { createWebsiteInvalidation } from "./modules/invalidation/index.js";
import { logCleanupFailure } from "./modules/media/index.js";

const log: Logger = (line) => {
  process.stdout.write(`${line}\n`);
};

function start() {
  const config = readApiConfig(process.env);
  const services = openServices(readDatabaseConfig(process.env), {
    media: { config: readMediaConfig(process.env), onCleanupFailure: logCleanupFailure(log) },
    // Without its settings or a provider key, search answers a typed 503.
    retrieval: readRetrievalOptions(process.env),
  });
  // Signed notifications to the website after committed content writes, when configured.
  const invalidation = config.websiteInvalidation
    ? createWebsiteInvalidation({ ...config.websiteInvalidation, log })
    : null;
  const { app } = createApp({
    services,
    config,
    log,
    ...(invalidation ? { onWrite: invalidation.notify } : {}),
  });
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    log(`listening on http://${host}:${String(info.port)}`);
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      Promise.all([invalidation?.close(), services.close()]).then(
        () => process.exit(0),
        (error: unknown) => {
          process.stderr.write(`Closing the database failed: ${String(error)}\n`);
          process.exit(1);
        },
      );
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

try {
  start();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
