// Startup adapter: validates the configuration once, listens and stops cleanly on SIGTERM or
// SIGINT. It holds no API key and no database setting.
import { startMcpAdminServer, type Logger } from "./app.js";
import { readMcpAdminConfig } from "./config.js";

const log: Logger = (line) => {
  process.stdout.write(`${line}\n`);
};

async function start() {
  const config = readMcpAdminConfig(process.env);
  const server = await startMcpAdminServer({ config, log });
  log(`MCP Admin listening on ${server.url}`);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        process.stderr.write(`Stopping MCP Admin failed: ${String(error)}\n`);
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

start().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
