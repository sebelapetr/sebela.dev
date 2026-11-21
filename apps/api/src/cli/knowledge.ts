// Maintenance adapter for the knowledge base: works through queued indexing work, rebuilds the
// index from the portfolio and the approved originals, lists the evals' candidate pools, prints
// the month's recorded provider spend and takes supplemental documents through ingest, preview,
// the owner's decision, withdrawal and deletion, straight through the services, so it needs no
// running server and no API key. Run it only while no API serves the same database, which works
// through the queue itself.
// Every answer is one JSON document on stdout.
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { SearchRequestSchema } from "@sebela/contracts";
import {
  DomainError,
  defaultDocumentLimits,
  documentTypeOf,
  openPrivateStorage,
  openServices,
  readDatabaseConfig,
  readMediaConfig,
  readPrivateStorageConfig,
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
  rebuild                 Rebuilds the whole index, as after an embedding model or version change
                          or a lost index: every portfolio source and every approved document
                          from its retained original, embedding each text at most once per model.
                          Pending, rejected, superseded and withdrawn versions stay unpublished;
                          prints { portfolio, documents }.
  pending                 Prints { pending, failed }: the queued indexing work.
  candidates <questions>  Prints { pools: { <id>: [sourceId, ...] } }: each question's candidate
                          pool, best first, without the relevance floor. <questions> is a JSON file
                          of [{ id, query, kinds? }], resolved against the starting directory.
  usage                   Prints the provider usage recorded this calendar month (UTC).

  Supplemental documents (Markdown, plain text or PDF with a text layer, kept in private storage):
  ingest <file> --slug <slug> --title <title>
                          Ingests the file for review without calling the provider; prints
                          { created, version }. Exits 1 when the version is blocked by findings.
  list                    Prints { documents: [...] }: every version, newest first.
  show <hash>             Prints the version's preview: text, sections, chunks and findings.
  approve <hash>          Embeds the pending version with exactly this content hash and makes it
                          searchable, superseding the earlier approved version.
  reject <hash>           Rejects a pending or blocked version and deletes its original.
  withdraw <hash>         Takes the approved version out of search at once, without the provider,
                          and deletes its original; the version stays listed as withdrawn.
  delete <slug>           Deletes the document completely: every version, its chunks and every
                          original; prints { sourceId, deletedVersions }.
`;

/** The commands that need private storage. */
const documentCommands: ReadonlySet<string> = new Set([
  "ingest",
  "list",
  "show",
  "approve",
  "reject",
  "withdraw",
  "delete",
  "rebuild",
]);

const QuestionsSchema = z.array(
  z.strictObject({
    id: z.string().min(1).max(100),
    query: SearchRequestSchema.shape.query,
    kinds: SearchRequestSchema.shape.kinds,
  }),
);

/**
 * Runs the knowledge command and returns the exit code: 0 on success, 1 when the provider is
 * unavailable, the budget is spent, the questions or document file is unreadable, or a document is
 * refused or blocked, 2 for bad usage. Prints results as JSON, never queries, settings or keys.
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
      print(await services.knowledge.rebuildIndex());
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
    if (command === "list" && rest.length === 0) {
      print({ documents: await services.knowledge.listDocuments() });
      return 0;
    }
    const [hash, ...more] = rest;
    if (hash !== undefined && hash !== "" && more.length === 0) {
      if (command === "show") {
        print(await services.knowledge.showDocument(hash));
        return 0;
      }
      if (command === "approve") {
        print(await services.knowledge.approveDocument(hash));
        return 0;
      }
      if (command === "reject") {
        print(await services.knowledge.rejectDocument(hash));
        return 0;
      }
      if (command === "withdraw") {
        print(await services.knowledge.withdrawDocument(hash));
        return 0;
      }
      if (command === "delete") {
        print(await services.knowledge.deleteDocument(hash));
        return 0;
      }
    }
    const ingest = command === "ingest" ? ingestArguments(rest) : null;
    if (ingest !== null) {
      const path = resolve(cwd, ingest.file);
      // The size is checked before the file is read, so a huge file is never loaded.
      const maxBytes =
        documentTypeOf(ingest.file)?.extension === "pdf"
          ? defaultDocumentLimits.maxPdfBytes
          : defaultDocumentLimits.maxBytes;
      if ((await stat(path)).size > maxBytes) {
        throw new DomainError(
          "payload_too_large",
          `The file is larger than ${String(maxBytes)} bytes; split it into smaller documents.`,
        );
      }
      const bytes = await readFile(path);
      const ingested = await services.knowledge.ingestDocument({
        slug: ingest.slug,
        title: ingest.title,
        fileName: basename(ingest.file),
        bytes: new Uint8Array(bytes),
      });
      print(ingested);
      if (ingested.version.status === "blocked") {
        output.err(
          "The document has sensitivity findings (kinds, pages and lines above); remove them and ingest a sanitized revision.\n",
        );
        return 1;
      }
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
      const what = command === "ingest" ? "document" : "questions";
      output.err(`The ${what} file could not be read (${String(error.code)}).\n`);
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

/** `<file> --slug <slug> --title <title>`, the options in either order; `null` otherwise. */
function ingestArguments(
  args: readonly string[],
): { file: string; slug: string; title: string } | null {
  const [file, ...options] = args;
  if (file === undefined || file === "" || file.startsWith("--") || options.length !== 4) {
    return null;
  }
  const values = new Map<string, string>();
  for (let index = 0; index < options.length; index += 2) {
    const [name, value] = [options[index], options[index + 1]];
    if (name === undefined || value === undefined || value === "" || values.has(name)) return null;
    values.set(name, value);
  }
  const slug = values.get("--slug");
  const title = values.get("--title");
  if (slug === undefined || title === undefined) return null;
  return { file, slug, title };
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
    retrieval: {
      ...readRetrievalOptions(process.env),
      // Only the document commands need private storage; the others run without its settings.
      ...(documentCommands.has(process.argv[2] ?? "")
        ? { privateStorage: openPrivateStorage(readPrivateStorageConfig(process.env)) }
        : {}),
    },
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
