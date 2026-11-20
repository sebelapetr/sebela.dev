// Maintenance adapter for the knowledge base: works through queued indexing work, rebuilds the
// portfolio index, lists the evals' candidate pools and prints the month's recorded provider spend, straight through the services, so it needs
// no running server and no API key. Every answer is one JSON document on stdout.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { SearchRequestSchema } from "@sebela/contracts";
import {
  DomainError,
  openServices,
  readDatabaseConfig,
  readMediaConfig,
  readRetrievalOptions,
  type QueueReport,
  type Services,
} from "@sebela/services";

import { logCleanupFailure } from "../modules/media/index.js";
import type { CommandOutput } from "./api-keys.js";

const USAGE = `Usage: knowledge <command>

  reindex                 Works through all queued indexing work, failed items included, and
                          brings the index in step with the portfolio, embedding only what
                          changed; prints the report with what is still queued.
  rebuild                 Stores every portfolio source again, as after an embedding model or
                          version change, embedding each text at most once per model.
  pending                 Prints { pending, failed }: the queued indexing work.
  candidates <questions>  Prints { pools: { <id>: [sourceId, ...] } }: each question's candidate
                          pool, best first, without the relevance floor. <questions> is a JSON file
                          of [{ id, query, kinds? }], resolved against the starting directory.
  usage                   Prints the provider usage recorded this calendar month (UTC).
`;

const QuestionsSchema = z.array(
  z.strictObject({
    id: z.string().min(1).max(100),
    query: SearchRequestSchema.shape.query,
    kinds: SearchRequestSchema.shape.kinds,
  }),
);

/**
 * Runs the knowledge command and returns the exit code: 0 on success, 1 when the provider is
 * unavailable, the budget is spent or the questions file is unreadable, 2 for bad usage. Prints
 * results as JSON, never queries or settings.
 */
export async function runKnowledgeCommand(
  args: readonly string[],
  services: Pick<Services, "knowledge">,
  output: CommandOutput,
  cwd: string = process.cwd(),
): Promise<number> {
  const [command, ...rest] = args;
  const print = (value: unknown) => {
    output.out(`${JSON.stringify(value, null, 2)}\n`);
  };
  try {
    if (command === "reindex" && rest.length === 0) {
      print(await workThroughQueue(services.knowledge));
      return 0;
    }
    if (command === "rebuild" && rest.length === 0) {
      print(await services.knowledge.rebuildPortfolio());
      return 0;
    }
    if (command === "pending" && rest.length === 0) {
      print(await services.knowledge.pending());
      return 0;
    }
    if (command === "usage" && rest.length === 0) {
      print(await services.knowledge.usage());
      return 0;
    }
    const [file, ...extra] = rest;
    if (command === "candidates" && file !== undefined && file !== "" && extra.length === 0) {
      const questions = QuestionsSchema.safeParse(
        JSON.parse(await readFile(resolve(cwd, file), "utf8")),
      );
      if (!questions.success) {
        output.err("The questions file is not a list of { id, query, kinds? }.\n");
        return 1;
      }
      const found = await services.knowledge.candidates(
        questions.data.map(({ query, kinds }) =>
          kinds === undefined ? { query } : { query, kinds },
        ),
      );
      const pools = Object.fromEntries(
        questions.data.map(({ id }, index) => [id, found[index] ?? []]),
      );
      print({ pools });
      return 0;
    }
  } catch (error) {
    if (error instanceof DomainError) {
      output.err(`${error.message}\n`);
      return 1;
    }
    // A Node file-system error names the path it failed on; print its code only.
    if (error instanceof Error && "syscall" in error && "code" in error) {
      output.err(`The questions file could not be read (${String(error.code)}).\n`);
      return 1;
    }
    if (error instanceof SyntaxError) {
      output.err("The questions file is not JSON.\n");
      return 1;
    }
    throw error;
  }
  output.err(USAGE);
  return 2;
}

/** Runs bounded batches until no queued work is left, summing what they did. */
async function workThroughQueue(knowledge: Services["knowledge"]): Promise<QueueReport> {
  let total = await knowledge.processPending({ retryFailed: true });
  let last = total;
  while (last.completed > 0 && last.remaining.pending + last.remaining.failed > 0) {
    last = await knowledge.processPending({ retryFailed: true });
    total = {
      sources: last.sources,
      updated: total.updated + last.updated,
      removed: total.removed + last.removed,
      embedded: total.embedded + last.embedded,
      reused: total.reused + last.reused,
      tokens: total.tokens + last.tokens,
      costUsd: total.costUsd + last.costUsd,
      completed: total.completed + last.completed,
      remaining: last.remaining,
    };
  }
  return total;
}

async function main() {
  const services = openServices(readDatabaseConfig(process.env), {
    media: {
      config: readMediaConfig(process.env),
      onCleanupFailure: logCleanupFailure((line) => process.stderr.write(`${line}\n`)),
    },
    retrieval: readRetrievalOptions(process.env),
  });
  try {
    // pnpm runs package scripts in the package folder; INIT_CWD is where the command was started.
    process.exitCode = await runKnowledgeCommand(
      process.argv.slice(2),
      services,
      { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) },
      process.env["INIT_CWD"] ?? process.cwd(),
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
