// Maintenance adapter: deletes the visitor conversations past their retention straight through the
// services, in bounded batches, so a scheduled job can run it without a running HTTP server.
import { pathToFileURL } from "node:url";

import {
  openServices,
  readChatOptions,
  readDatabaseConfig,
  type ChatService,
  type ChatTraceDeleter,
} from "@sebela/services";

import type { CommandOutput } from "./api-keys.js";

const DEFAULT_BATCH_SIZE = 1_000;
const MAX_BATCH_SIZE = 10_000;
const DEFAULT_MAX_BATCHES = 100;
const MAX_BATCHES = 10_000;

const USAGE = `Usage: chat-maintenance delete-expired [--batch-size <n>] [--max-batches <n>]

  Deletes the visitor identities last seen longer ago than the retention period
  (API_CHAT_RETENTION_DAYS), with their conversations, messages, operations and summaries, in at most
  --max-batches batches (default ${String(DEFAULT_MAX_BATCHES)}) of at most --batch-size
  conversations (default ${String(DEFAULT_BATCH_SIZE)}, at most ${String(MAX_BATCH_SIZE)}).
  The spend accounting and a count of each run, without content, stay.
`;

/** A whole number from 1 to `max`, or `null`. */
const count = (text: string | undefined, max: number): number | null => {
  if (text === undefined || !/^\d{1,6}$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= max ? value : null;
};

/**
 * Runs the chat-maintenance command (`delete-expired [--batch-size <n>] [--max-batches <n>]`) and
 * returns the exit code: 0 when the run finished, 2 for bad usage, which deletes nothing.
 */
export async function runChatMaintenanceCommand(
  args: readonly string[],
  chat: Pick<ChatService, "deleteExpired" | "deleteTelemetry">,
  output: CommandOutput,
  deleter: ChatTraceDeleter | null = null,
): Promise<number> {
  const [command, ...flags] = args;
  if (command === "delete-telemetry") {
    output.err(`Not implemented${deleter === null ? "" : "."}\n`);
    return 1;
  }
  let batchSize: number | null = DEFAULT_BATCH_SIZE;
  let maxBatches: number | null = DEFAULT_MAX_BATCHES;
  let usable = command === "delete-expired" && flags.length % 2 === 0;
  for (let index = 0; usable && index < flags.length; index += 2) {
    const value = flags[index + 1];
    if (flags[index] === "--batch-size") batchSize = count(value, MAX_BATCH_SIZE);
    else if (flags[index] === "--max-batches") maxBatches = count(value, MAX_BATCHES);
    else usable = false;
  }
  if (!usable || batchSize === null || maxBatches === null) {
    output.err(USAGE);
    return 2;
  }

  let total = 0;
  let full = false;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const deleted = await chat.deleteExpired(batchSize);
    total += deleted;
    full = deleted === batchSize;
    if (!full) break;
  }
  output.out(`${String(total)} expired conversations deleted${full ? "; more may remain" : ""}\n`);
  return 0;
}

async function main() {
  const chat = readChatOptions(process.env);
  if (chat === null) {
    process.stderr.write("The chat is not configured; nothing was deleted.\n");
    process.exitCode = 1;
    return;
  }
  const services = openServices(readDatabaseConfig(process.env), { chat });
  try {
    process.exitCode = await runChatMaintenanceCommand(process.argv.slice(2), services.chat, {
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
