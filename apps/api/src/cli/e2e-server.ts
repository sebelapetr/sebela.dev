// Test support, excluded from the build: serves the API on a database and a storage folder of its
// own, filled from one seed folder, for the browser tests of the apps that read it (apps/web,
// "End-to-end tests"). Never touches the checkout's database or storage. Run with tsx:
//
//   node --import tsx src/cli/e2e-server.ts <seed-folder>
//
// It takes the usual API settings from the environment (`.env.example`), except the database
// name, the storage folder and the storage environment, which are its own. When API_E2E_KEY_FILE
// names a file, it creates an API key on its temporary database and writes it there (mode 0600)
// for tests that write content through the private routes. When API_E2E_KEYS_FILE names a file,
// it creates one key per name in the comma-separated API_E2E_KEY_NAMES and writes
// `{ database, keys: [{ name, id, key }] }` there (mode 0600). When API_E2E_STORAGE_ROOT names a
// folder, it stores its files there instead of a new temporary folder below the checkout's `.tmp/`,
// so the caller knows which folder is this server's. On SIGTERM or SIGINT it stops, drops the
// database and removes the folder.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { serve } from "@hono/node-server";

import {
  openServices,
  readChatOptions,
  readDatabaseConfig,
  readMediaConfig,
  readRetrievalOptions,
} from "@sebela/services";
import { createTemporaryDatabase } from "@sebela/services/testing";

import { createApp, type Logger } from "../app.js";
import { readApiConfig } from "../config.js";
import { createChatSupervisor } from "../modules/chat/index.js";
import { createIndexingQueue } from "../modules/indexing/index.js";
import { createWebsiteInvalidation } from "../modules/invalidation/index.js";
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
  // A clean checkout has no `.tmp/` yet (it is git-ignored), so create it before the temporary folder.
  const scratch = resolve("../../.tmp");
  await mkdir(scratch, { recursive: true });
  const givenRoot = process.env["API_E2E_STORAGE_ROOT"];
  const storageRoot =
    givenRoot === undefined || givenRoot === ""
      ? await mkdtemp(join(scratch, "e2e-storage-"))
      : resolve(givenRoot);
  await mkdir(storageRoot, { recursive: true });
  const cleanUp = async () => {
    await database.drop();
    await rm(storageRoot, { recursive: true, force: true });
  };

  const retrieval = readRetrievalOptions(process.env);
  // The visitor chat runs only with both its HTTP and its service settings; half of them is an error.
  const chatOptions = readChatOptions(process.env);
  if ((config.chat === null) !== (chatOptions === null)) {
    throw new Error("Set every visitor chat setting, or none of them.");
  }
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
      retrieval,
      ...(chatOptions === null ? {} : { chat: chatOptions }),
    });
    await services.seed.loadSeed(seedFolder);
    const keyFile = process.env["API_E2E_KEY_FILE"];
    if (keyFile !== undefined && keyFile !== "") {
      const { key } = await services.apiKeys.createKey("e2e");
      await writeFile(resolve(keyFile), key, { mode: 0o600 });
    }
    // Named keys for callers that need several, such as the MCP Admin tests and evals, which also
    // revoke one through the key command and so need the name of the temporary database.
    const keysFile = process.env["API_E2E_KEYS_FILE"];
    if (keysFile !== undefined && keysFile !== "") {
      const names = (process.env["API_E2E_KEY_NAMES"] ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== "");
      const keys = [];
      for (const name of names) {
        const { key, metadata } = await services.apiKeys.createKey(name);
        keys.push({ name, id: metadata.id, key });
      }
      await writeFile(resolve(keysFile), JSON.stringify({ database: database.config.name, keys }), {
        mode: 0o600,
      });
    }
  } catch (error) {
    await cleanUp();
    throw error;
  }

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
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    log(`e2e API listening on http://${host}:${String(info.port)}`);
  });
  indexing?.start();
  chat?.start();

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      Promise.all([indexing?.close(), invalidation?.close(), chat?.close()])
        .then(() => services.close())
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
