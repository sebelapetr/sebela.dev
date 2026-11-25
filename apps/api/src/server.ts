// Startup adapter: validates the configuration once, composes the services and the app, and
// listens. It never migrates the database; that is the db package's own command.
import { serve } from "@hono/node-server";

import {
  openServices,
  readChatOptions,
  readDatabaseConfig,
  readMediaConfig,
  readRetrievalOptions,
} from "@sebela/services";

import { createApp, type Logger } from "./app.js";
import { readApiConfig } from "./config.js";
import { createChatSupervisor } from "./modules/chat/index.js";
import { createIndexingQueue } from "./modules/indexing/index.js";
import { createWebsiteInvalidation } from "./modules/invalidation/index.js";
import { logCleanupFailure } from "./modules/media/index.js";

const log: Logger = (line) => {
  process.stdout.write(`${line}\n`);
};

function start() {
  const config = readApiConfig(process.env);
  // Without its settings or a provider key, search answers a typed 503.
  const retrieval = readRetrievalOptions(process.env);
  // The visitor chat runs only with both its HTTP and its service settings; half of them is an error.
  const chatOptions = readChatOptions(process.env);
  if ((config.chat === null) !== (chatOptions === null)) {
    throw new Error("Set every visitor chat setting, or none of them.");
  }
  const services = openServices(readDatabaseConfig(process.env), {
    media: { config: readMediaConfig(process.env), onCleanupFailure: logCleanupFailure(log) },
    retrieval,
    ...(chatOptions === null ? {} : { chat: chatOptions }),
  });
  // Keeps the knowledge index current after committed content writes, when a provider is set.
  const indexing =
    retrieval.config !== null && retrieval.embedder !== undefined
      ? createIndexingQueue({ knowledge: services.knowledge, log })
      : null;
  // Signed notifications to the website after committed content writes, when configured.
  const invalidation = config.websiteInvalidation
    ? createWebsiteInvalidation({ ...config.websiteInvalidation, log })
    : null;
  // Dispatches admitted chat questions to the AI service and interrupts overdue ones.
  const chat = config.chat
    ? createChatSupervisor({ chat: services.chat, aiService: config.chat.aiService, log })
    : null;
  const { app } = createApp({
    services,
    config,
    log,
    ...(chat === null ? {} : { chatDispatcher: chat }),
    onWrite: [indexing?.notify, invalidation?.notify].filter((notify) => notify !== undefined),
  });
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    log(`listening on http://${host}:${String(info.port)}`);
  });
  // Catches up on work queued before a restart and on content changed while it was down.
  indexing?.start();
  chat?.start();

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      Promise.all([indexing?.close(), invalidation?.close(), chat?.close()])
        .then(() => services.close())
        .then(
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
