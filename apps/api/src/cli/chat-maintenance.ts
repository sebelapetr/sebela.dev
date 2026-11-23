// Maintenance adapter: deletes the visitor conversations past their retention, and the remote
// telemetry traces owed a deletion, straight through the services, in bounded batches, so a
// scheduled job can run it without a running HTTP server.
import { pathToFileURL } from "node:url";

import {
  createLangfuseTraceDeleter,
  openServices,
  readChatOptions,
  readDatabaseConfig,
  readTelemetryDeletionOptions,
  type ChatService,
  type ChatTelemetryDeletionReport,
  type ChatTraceDeleter,
} from "@sebela/services";

import type { CommandOutput } from "./api-keys.js";

const DEFAULT_BATCH_SIZE = 1_000;
const MAX_BATCH_SIZE = 10_000;
const DEFAULT_MAX_BATCHES = 100;
const MAX_BATCHES = 10_000;
/** Langfuse deletes at most 1000 traces per request. */
const MAX_TRACES_PER_REQUEST = 1_000;
const DEFAULT_MAX_REQUESTS = 10;
const MAX_REQUESTS = 1_000;

const USAGE = `Usage: chat-maintenance delete-expired [--batch-size <n>] [--max-batches <n>]
       chat-maintenance delete-telemetry [--batch-size <n>] [--max-requests <n>]

  delete-expired deletes the visitor identities last seen longer ago than the retention period
  (API_CHAT_RETENTION_DAYS), with their conversations, messages, operations and summaries, in at most
  --max-batches batches (default ${String(DEFAULT_MAX_BATCHES)}) of at most --batch-size
  conversations (default ${String(DEFAULT_BATCH_SIZE)}, at most ${String(MAX_BATCH_SIZE)}).
  The spend accounting and a count of each run, without content, stay.

  delete-telemetry hands the telemetry traces registered more than 30 days ago over for deletion,
  then deletes the due traces from Langfuse (API_LANGFUSE_BASE_URL, API_LANGFUSE_PUBLIC_KEY,
  API_LANGFUSE_SECRET_KEY) in at most --max-requests requests (default
  ${String(DEFAULT_MAX_REQUESTS)}, at most ${String(MAX_REQUESTS)}) of at most --batch-size traces
  (default ${String(DEFAULT_BATCH_SIZE)}, at most ${String(MAX_TRACES_PER_REQUEST)}), the longest due
  first. A failed request is retried later; a rate limit stops the run. Without the Langfuse
  settings it only hands expired traces over and reports how many deletions are pending.
`;

/** A whole number from 1 to `max`, or `null`. */
const count = (text: string | undefined, max: number): number | null => {
  if (text === undefined || !/^\d{1,6}$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= max ? value : null;
};

/** Each flag's value, each a whole number from 1 to its maximum, or `null` for bad usage. */
function parseFlags(
  flags: readonly string[],
  allowed: Readonly<Record<string, { value: number; max: number }>>,
): Record<string, number> | null {
  if (flags.length % 2 !== 0) return null;
  const values: Record<string, number> = {};
  for (const [name, { value }] of Object.entries(allowed)) values[name] = value;
  for (let index = 0; index < flags.length; index += 2) {
    const name = flags[index] ?? "";
    const rule = allowed[name];
    if (rule === undefined) return null;
    const value = count(flags[index + 1], rule.max);
    if (value === null) return null;
    values[name] = value;
  }
  return values;
}

const telemetrySummary = (report: ChatTelemetryDeletionReport) =>
  report.configured
    ? `telemetry deletion: ${String(report.swept)} swept, ${String(report.sent)} sent in ` +
      `${String(report.requests)} requests, ${String(report.completed)} completed, ` +
      `${String(report.failed)} failed, ${String(report.pending)} pending` +
      `${report.rateLimited ? "; rate limited, stopped" : ""}\n`
    : `${String(report.swept)} expired telemetry references swept; ` +
      `telemetry deletion not configured; ${String(report.pending)} pending\n`;

/**
 * Runs the chat-maintenance command and returns the exit code: 0 when the run finished, also
 * when some remote deletions failed or were rate limited (they stay pending and are retried),
 * 2 for bad usage, which changes nothing.
 *
 * - `delete-expired [--batch-size <n>] [--max-batches <n>]`
 * - `delete-telemetry [--batch-size <n>] [--max-requests <n>]`, sending through `deleter`, or
 *   only handing expired traces over when it is `null`.
 */
export async function runChatMaintenanceCommand(
  args: readonly string[],
  chat: Pick<ChatService, "deleteExpired" | "deleteTelemetry">,
  output: CommandOutput,
  deleter: ChatTraceDeleter | null = null,
): Promise<number> {
  const [command, ...flags] = args;
  if (command === "delete-telemetry") {
    const values = parseFlags(flags, {
      "--batch-size": { value: DEFAULT_BATCH_SIZE, max: MAX_TRACES_PER_REQUEST },
      "--max-requests": { value: DEFAULT_MAX_REQUESTS, max: MAX_REQUESTS },
    });
    const batchSize = values?.["--batch-size"];
    const maxRequests = values?.["--max-requests"];
    if (batchSize === undefined || maxRequests === undefined) {
      output.err(USAGE);
      return 2;
    }
    output.out(telemetrySummary(await chat.deleteTelemetry({ deleter, batchSize, maxRequests })));
    return 0;
  }

  const values =
    command === "delete-expired"
      ? parseFlags(flags, {
          "--batch-size": { value: DEFAULT_BATCH_SIZE, max: MAX_BATCH_SIZE },
          "--max-batches": { value: DEFAULT_MAX_BATCHES, max: MAX_BATCHES },
        })
      : null;
  const batchSize = values?.["--batch-size"];
  const maxBatches = values?.["--max-batches"];
  if (batchSize === undefined || maxBatches === undefined) {
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
  const telemetry = readTelemetryDeletionOptions(process.env);
  const deleter = telemetry === null ? null : createLangfuseTraceDeleter(telemetry);
  const services = openServices(readDatabaseConfig(process.env), { chat });
  try {
    process.exitCode = await runChatMaintenanceCommand(
      process.argv.slice(2),
      services.chat,
      {
        out: (text) => process.stdout.write(text),
        err: (text) => process.stderr.write(text),
      },
      deleter,
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
