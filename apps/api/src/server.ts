// Startup adapter: validates the configuration once, composes the services and the app, and
// listens. It never migrates the database; that is the db package's own command.
import { serve } from "@hono/node-server";

import { openServices, readDatabaseConfig } from "@sebela/services";

import { createApp, type Logger } from "./app.js";
import { readApiConfig } from "./config.js";

const log: Logger = (line) => {
  process.stdout.write(`${line}\n`);
};

function start() {
  const config = readApiConfig(process.env);
  const services = openServices(readDatabaseConfig(process.env));
  const { app } = createApp({ services, config, log });
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    log(`listening on http://${host}:${String(info.port)}`);
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      services.close().then(
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
