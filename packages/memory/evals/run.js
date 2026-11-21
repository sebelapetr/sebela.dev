// @ts-check

// Runs the retrieval evals of the knowledge base (.plan/09-rag/prd.md, Evals and measurement).
//
//   node evals/run.js                  every case (paid: indexing and query embeddings; run it as
//                                      `pnpm --filter @sebela/memory eval`, which supplies the key
//                                      through the secret wrapper)
//   node evals/run.js --case <id> [--case <id>...]
//                                      only those cases; the summary's `scope` marks it partial.
//                                      Issues run the cases their change affects.
//   node evals/run.js --publish <name> also writes the summary to `evals/results/<name>.json`
//   node evals/run.js --max-cost-usd <n>
//                                      the run's spend ceiling, at most and by default USD 1
//   node evals/run.js --plan           print which cases would run and which are pending (free)
//
// An unknown option, an unknown or repeated case or a ceiling above USD 1 stops the runner before
// anything starts. Cases whose capability is not searchable yet (`plan.js`) are reported pending,
// never passed. Without `VOYAGE_API_KEY` every case is pending and nothing starts.
//
// A measured run starts the API's end-to-end server on a temporary database seeded with the
// fictional demo seed and one ephemeral key, indexes the seed, ingests and approves every fictional
// supplemental document of the dataset into a local private storage inside the run's scratch
// folder, and records each question's candidate pool through the API's knowledge command on that
// database, then lets Promptfoo send
// every question to the private search route. The run's spend ceiling is the API's monthly
// embedding ceiling on the fresh database, so the provider stops being called once it is reached.
// Promptfoo runs with an allowlisted environment (no provider key, database or other checkout
// setting); its output and state are scanned for credentials and deleted. The redacted summary goes
// to the checkout's `.tmp/evals/memory/<stamp>/summary.json`. Query embeddings are kept in
// `.tmp/evals/memory/query-cache.json` by model, version and text and reused by later runs, so a
// repeated run embeds only new questions. Needs the running Postgres and a build
// of the API's packages (`pnpm --filter @sebela/api... build`).
//
// Exit codes: 0 measured (and the gate passed or is not frozen), 1 a failure or a failed gate,
// 2 nothing was measured (every selected case is pending).
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { aggregate, caseMetrics, caseVerdict } from "./graders/metrics.js";
import { CUTOFF } from "./graders/index.js";
import { allPending, loadDataset, planCases } from "./plan.js";

const PROMPTFOO = "promptfoo@0.126.0";
/** The largest spend of a single run (phase rule: stop a run at USD 1). */
export const RUN_CEILING_USD = 1;
/**
 * The default least time between two provider calls of a run: a little over 20 s, so a key on the
 * provider's lowest limit (3 requests a minute without a payment method) is not refused.
 */
export const DEFAULT_MIN_INTERVAL_MS = 21_000;
const MAX_MIN_INTERVAL_MS = 600_000;
/** Retries of a rate-limited call in the run's processes, each wait at most a minute. */
const RUN_PROVIDER_RETRIES = "6";
const RUN_PROVIDER_MAX_RETRY_WAIT_MS = "60000";
const EVAL_CLIENT = "memory-evals";
const evalsFolder = fileURLToPath(new URL("./", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const apiFolder = join(repositoryRoot, "apps", "api");
const seedFolder = join(repositoryRoot, "packages", "db", "seed", "demo");
const reportRoot = join(repositoryRoot, ".tmp", "evals", "memory");
/** Query embeddings by model, version and text, reused by every later run of this checkout. */
const queryCacheFile = join(reportRoot, "query-cache.json");

/** Retrieval settings recorded with each run, so results name the configuration they measured. */
const RECORDED_SETTINGS = [
  "RETRIEVAL_EMBEDDING_MODEL",
  "RETRIEVAL_CANDIDATE_POOL",
  "RETRIEVAL_FINAL_PASSAGES",
  "RETRIEVAL_RELEVANCE_FLOOR",
  "RETRIEVAL_EMBEDDING_BATCH_SIZE",
];

/**
 * Reads and validates the command line. Throws on anything it does not understand.
 *
 * @param {readonly string[]} argv
 */
export function parseOptions(argv) {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      case: { type: "string", multiple: true },
      publish: { type: "string" },
      "max-cost-usd": { type: "string" },
      "min-interval-ms": { type: "string" },
      plan: { type: "boolean" },
      variant: { type: "string" },
    },
  });
  const ceiling =
    values["max-cost-usd"] === undefined ? RUN_CEILING_USD : Number(values["max-cost-usd"]);
  if (!Number.isFinite(ceiling) || ceiling <= 0 || ceiling > RUN_CEILING_USD) {
    throw new Error(`--max-cost-usd must be above 0 and at most ${String(RUN_CEILING_USD)}.`);
  }
  const interval =
    values["min-interval-ms"] === undefined
      ? DEFAULT_MIN_INTERVAL_MS
      : Number(values["min-interval-ms"]);
  if (!Number.isInteger(interval) || interval < 0 || interval > MAX_MIN_INTERVAL_MS) {
    throw new Error(
      `--min-interval-ms must be a whole number of milliseconds from 0 to ${String(MAX_MIN_INTERVAL_MS)}.`,
    );
  }
  if (values.publish !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(values.publish)) {
    throw new Error("--publish takes a lowercase name of letters, digits and hyphens.");
  }
  return {
    cases: values.case ?? [],
    publish: values.publish ?? null,
    ceilingUsd: ceiling,
    planOnly: values.plan ?? false,
    minIntervalMs: interval,
    variant: "vector",
  };
}

/**
 * The settings the run's API and knowledge command get on top of this checkout's.
 *
 * @param {ReturnType<typeof parseOptions>} options
 * @returns {Record<string, string>}
 */
export function providerEnvironment(options) {
  return {
    RETRIEVAL_MONTHLY_CEILING_USD: String(options.ceilingUsd),
    RETRIEVAL_PROVIDER_RETRIES: RUN_PROVIDER_RETRIES,
    RETRIEVAL_PROVIDER_MAX_RETRY_WAIT_MS: RUN_PROVIDER_MAX_RETRY_WAIT_MS,
    RETRIEVAL_QUERY_CACHE_FILE: queryCacheFile,
  };
}

/**
 * @typedef {{ metric: string, value: number | null, minimum?: number, maximum?: number }} GateFailure
 * @typedef {{ frozen: boolean, applies?: boolean, reason?: string, passed?: boolean, failures?: GateFailure[] }} Gate
 */

/**
 * The gate of a run's metrics against the thresholds (not yet implemented).
 *
 * @type {(thresholds: unknown, metrics: unknown, run: { variant: string, scope: string }) => Gate}
 */
export const gateOf = () => {
  throw new Error("not implemented");
};

/**
 * The knowledge command's arguments that ingest each fictional supplemental document of the
 * dataset under its slug and its safe display title (never the file name).
 *
 * @param {import("./plan.js").Dataset} dataset
 * @returns {string[][]}
 */
export function documentIngests(dataset) {
  return dataset.documents.map(({ sourceId, title, file }) => [
    "ingest",
    join(evalsFolder, "datasets", file),
    "--slug",
    sourceId.replace(/^document:/, ""),
    "--title",
    title,
  ]);
}

/**
 * The private storage of a run: a local root inside its scratch folder, removed with it.
 *
 * @param {string} scratch
 * @returns {Record<string, string>}
 */
export function privateStorageEnvironment(scratch) {
  return { PRIVATE_STORAGE_DRIVER: "local", PRIVATE_STORAGE_LOCAL_ROOT: join(scratch, "private") };
}

/**
 * The redacted summary of a run in which nothing was measured.
 *
 * @param {{ cases: readonly string[] }} options
 * @param {import("./plan.js").PendingCase[]} pending
 */
export function pendingSummary(options, pending) {
  return {
    status: "pending",
    scope: options.cases.length === 0 ? "complete" : "partial",
    measured: 0,
    pending,
  };
}

/**
 * The number of query embeddings in the cache file; an absent file holds none.
 *
 * @type {(file: string) => Promise<number>}
 */
export async function cacheEntryCount(file) {
  /** @type {string} */
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return 0;
    throw error;
  }
  const parsed = /** @type {{ entries?: Record<string, unknown> }} */ (JSON.parse(text));
  return Object.keys(parsed.entries ?? {}).length;
}

/**
 * @typedef {{ queries: number, fromCache: number, embedded: number }} StepCacheUse
 * @typedef {{ entriesAtStart: number, candidates: StepCacheUse, search: StepCacheUse, note: string }} QueryCacheUse
 */

/**
 * Which steps' query embeddings came from the cache, from its entry counts around them.
 *
 * @type {(queries: number, counts: { start: number, afterCandidates: number, end: number }) => QueryCacheUse}
 */
export function queryCacheUse(queries, counts) {
  /** @type {(added: number) => StepCacheUse} */
  const step = (added) => ({ queries, fromCache: queries - added, embedded: added });
  return {
    entriesAtStart: counts.start,
    candidates: step(counts.afterCandidates - counts.start),
    search: step(counts.end - counts.afterCandidates),
    note: "Cached query embeddings cost nothing and take no provider time, so the latency and cost per query leave out the embedding call for every search served from the cache.",
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const dataset = loadDataset();
  const plan = planCases(dataset, options.cases);
  if (options.planOnly) {
    process.stdout.write(
      `${JSON.stringify({ run: plan.run.map((question) => question.id), pending: plan.pending }, null, 2)}\n`,
    );
    return;
  }
  loadSettings();
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\..*$/, "");
  const folder = join(reportRoot, stamp);
  await mkdir(folder, { recursive: true });

  if (plan.run.length === 0 || !process.env["VOYAGE_API_KEY"]) {
    const reason =
      plan.run.length === 0
        ? null
        : "VOYAGE_API_KEY is not set; run through `node harness/with-secrets.mjs`";
    const summary = pendingSummary(options, reason ? allPending(plan, reason) : plan.pending);
    await writeFile(join(folder, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  const summary = await measure(dataset, plan, options, folder);
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  await writeFile(join(folder, "summary.json"), text);
  if (options.publish) {
    await writeFile(join(evalsFolder, "results", `${options.publish}.json`), text);
  }
  process.stdout.write(text);
  process.exitCode = summary.status === "measured" ? 0 : 1;
}

/**
 * Measures the runnable cases on a fresh API and returns the redacted summary.
 *
 * @param {import("./plan.js").Dataset} dataset
 * @param {{ run: import("./plan.js").Question[], pending: import("./plan.js").PendingCase[] }} plan
 * @param {ReturnType<typeof parseOptions>} options
 * @param {string} folder
 */
async function measure(dataset, plan, options, folder) {
  const scratch = await mkdtemp(join(folder, "scratch-"));
  const budget = providerEnvironment(options);
  // Every provider call of the run (the reindex, the candidate batch, each search) waits at least
  // this long after the one before, so a low-limit key is not refused mid-run.
  const pause = () => new Promise((resolve) => setTimeout(resolve, options.minIntervalMs));
  const api = await startApi(scratch, budget);
  const secrets = [
    api.key,
    process.env["VOYAGE_API_KEY"] ?? "",
    process.env["DATABASE_PASSWORD"] ?? "",
  ].filter((value) => value.length >= 8);
  try {
    const knowledge = (/** @type {string[]} */ ...args) =>
      runJson(process.execPath, ["--import", "tsx", "src/cli/knowledge.ts", ...args], {
        cwd: apiFolder,
        env: {
          ...process.env,
          ...budget,
          ...privateStorageEnvironment(scratch),
          DATABASE_NAME: api.database,
        },
      });
    const indexing = await knowledge("reindex");
    await pause();
    // Each supplemental document is ingested (no provider call) and approved by its exact hash,
    // which embeds it; a blocked document stops the run, as the knowledge command exits 1.
    /** @type {unknown[]} */
    const approvals = [];
    for (const args of documentIngests(dataset)) {
      const { version } = /** @type {{ version: { contentHash: string } }} */ (
        await knowledge(...args)
      );
      approvals.push(await knowledge("approve", version.contentHash));
      await pause();
    }
    const questionsFile = join(scratch, "questions.json");
    await writeFile(
      questionsFile,
      JSON.stringify(
        plan.run.map(({ id, query, kinds }) => ({ id, query, ...(kinds ? { kinds } : {}) })),
      ),
    );
    const poolsFile = join(scratch, "pools.json");
    const cacheAtStart = await cacheEntryCount(queryCacheFile);
    const candidates = /** @type {{ pools: Record<string, string[]> }} */ (
      await knowledge("candidates", questionsFile)
    );
    await writeFile(poolsFile, JSON.stringify(candidates.pools));
    const cacheAfterCandidates = await cacheEntryCount(queryCacheFile);
    await pause();

    const raw = join(scratch, "promptfoo.json");
    const state = join(scratch, "promptfoo-state");
    /** @type {any} */
    let report;
    /** @type {string[]} */
    let leaked = [];
    try {
      await promptfoo(
        raw,
        options.minIntervalMs,
        promptfooEnvironment(
          process.env,
          {
            MEMORY_EVAL_API_URL: api.url,
            MEMORY_EVAL_KEY: api.key,
            MEMORY_EVAL_POOLS: poolsFile,
            MEMORY_EVAL_CASES: plan.run.map((question) => question.id).join(","),
          },
          state,
        ),
      );
      report = JSON.parse(await readFile(raw, "utf8"));
    } finally {
      // Promptfoo's raw output and state never outlive the run.
      leaked = await removeLeakingFiles([raw, state], secrets);
    }
    if (leaked.length > 0) {
      throw new Error("Promptfoo's output contained a credential; it was deleted.");
    }
    const usage = /** @type {Usage} */ (await knowledge("usage"));
    const queryCache = queryCacheUse(new Set(plan.run.map((question) => question.query)).size, {
      start: cacheAtStart,
      afterCandidates: cacheAfterCandidates,
      end: await cacheEntryCount(queryCacheFile),
    });
    return summarize(
      dataset,
      plan,
      options,
      report,
      { portfolio: indexing, approvals },
      usage,
      queryCache,
    );
  } finally {
    await api.stop();
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * @typedef {{ tokens: number, costUsd: number }} Spend
 * @typedef {{ tokens: number, costUsd: number, byOperation: Record<string, Spend> }} Usage
 */

/**
 * @param {import("./plan.js").Dataset} dataset
 * @param {{ run: import("./plan.js").Question[], pending: import("./plan.js").PendingCase[] }} plan
 * @param {ReturnType<typeof parseOptions>} options
 * @param {any} report Promptfoo's JSON output.
 * @param {{ portfolio: unknown, approvals: unknown[] }} indexing The reindex report and the
 *   supplemental documents' approvals.
 * @param {Usage} usage The temporary database's recorded provider usage.
 * @param {QueryCacheUse} queryCache Which steps' query embeddings came from the cache.
 */
function summarize(dataset, plan, options, report, indexing, usage, queryCache) {
  /** @type {any[]} */
  const results = report?.results?.results ?? [];
  const cases = plan.run.map((question) => {
    const result = results.find((entry) => entry?.vars?.caseId === question.id);
    /** @type {import("./graders/metrics.js").Observation} */
    const observation = result?.response?.output
      ? JSON.parse(result.response.output)
      : {
          status: "error",
          passages: [],
          pool: [],
          latencyMs: 0,
          error: result?.error ?? "no result",
        };
    const metrics = caseMetrics(question, observation, dataset.sources, CUTOFF);
    return {
      id: question.id,
      language: question.language,
      category: question.category,
      ...caseVerdict(metrics, observation),
      errored: observation.status === "error",
      returned: observation.passages.map((passage) => passage.sourceId),
      metrics,
    };
  });
  const search = usage.byOperation["search"] ?? { tokens: 0, costUsd: 0 };
  // A search that failed (provider unavailable, budget exhausted, no answer) is not a measurement.
  const failed = cases.some((entry) => entry.errored);
  return {
    status: failed ? "failed" : "measured",
    scope: options.cases.length === 0 ? "complete" : "partial",
    variant: "vector",
    runAt: new Date().toISOString(),
    settings: Object.fromEntries(
      RECORDED_SETTINGS.map((name) => [name, process.env[name] ?? null]),
    ),
    pacing: {
      minIntervalMs: options.minIntervalMs,
      providerRetries: Number(RUN_PROVIDER_RETRIES),
      maxRetryWaitMs: Number(RUN_PROVIDER_MAX_RETRY_WAIT_MS),
    },
    measured: cases.length,
    passed: cases.filter((entry) => entry.pass).length,
    metrics: aggregate(
      cases.map((entry) => entry.metrics),
      { queryCostUsd: search.costUsd },
    ),
    gate: { frozen: false },
    spend: { ceilingUsd: options.ceilingUsd, indexing, usage, queryCache },
    cases,
    pending: plan.pending,
  };
}

/**
 * Loads this checkout's settings the way the API's own commands do: `.env.local` first, then the
 * shared defaults. A variable already set wins.
 */
function loadSettings() {
  for (const file of [".env.local", ".env", ".env.example"]) {
    try {
      process.loadEnvFile(join(repositoryRoot, file));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw error;
    }
  }
}

/**
 * Serves the API's end-to-end server on a temporary database seeded with the demo seed and one
 * ephemeral key. Nothing here carries a port, host or database name.
 *
 * @param {string} scratch
 * @param {Record<string, string>} env
 */
async function startApi(scratch, env) {
  const keysFile = join(scratch, "keys.json");
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli/e2e-server.ts", seedFolder], {
    cwd: apiFolder,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
      API_PORT: "0",
      API_WEB_INVALIDATION_URL: "",
      API_WEB_INVALIDATION_SECRET: "",
      API_E2E_KEY_FILE: "",
      API_E2E_KEYS_FILE: keysFile,
      API_E2E_KEY_NAMES: EVAL_CLIENT,
      API_E2E_STORAGE_ROOT: join(scratch, "storage"),
    },
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await exited;
    }
  };
  try {
    const url = await new Promise((resolve, reject) => {
      let output = "";
      let errors = "";
      const timer = setTimeout(
        () => reject(new Error(`The API did not start: ${errors.slice(-500)}`)),
        60_000,
      );
      child.stderr.on("data", (chunk) => (errors += String(chunk)));
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        const match = /e2e API listening on (http:\/\/\S+)/.exec(output);
        if (match?.[1]) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`The API exited with ${String(code)}: ${errors.slice(-500)}`));
      });
    });
    /** @type {{ database: string, keys: { name: string, key: string }[] }} */
    const written = JSON.parse(await readFile(keysFile, "utf8"));
    const key = written.keys.find((entry) => entry.name === EVAL_CLIENT)?.key ?? "";
    return { url: String(url), key, database: written.database, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/**
 * Runs a command that prints one JSON document and returns it.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} options
 * @returns {Promise<any>}
 */
function runJson(command, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (errors += String(chunk)));
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${args.slice(2).join(" ")} exited with ${String(code)}: ${errors.slice(-500)}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error(`${args.slice(2).join(" ")} did not print JSON.`));
      }
    });
  });
}

/**
 * @param {string} output
 * @param {number} delayMs The least time between two questions.
 * @param {Record<string, string>} env The complete environment of the Promptfoo process.
 */
function promptfoo(output, delayMs, env) {
  const args = [
    "dlx",
    PROMPTFOO,
    "eval",
    "--config",
    "promptfooconfig.yaml",
    "--repeat",
    "1",
    "--no-cache",
    "--no-write",
    "--no-table",
    "--delay",
    String(delayMs),
    "--output",
    output,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, {
      cwd: evalsFolder,
      stdio: ["ignore", "ignore", "inherit"],
      env,
    });
    // Promptfoo exits 100 when an assertion failed; the summary carries that outcome.
    child.once("exit", (code) => {
      if (code === 0 || code === 100) resolve(undefined);
      else reject(new Error(`Promptfoo exited with ${String(code)}`));
    });
  });
}

/** Parent variables the Promptfoo process may see: no provider key, database or other setting. */
const INHERITED = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
];

/**
 * @param {NodeJS.ProcessEnv} parent
 * @param {Record<string, string>} values
 * @param {string} stateFolder
 * @returns {Record<string, string>}
 */
export function promptfooEnvironment(parent, values, stateFolder) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const name of INHERITED) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    ...env,
    ...values,
    PROMPTFOO_CONFIG_DIR: stateFolder,
    PROMPTFOO_LOG_DIR: join(stateFolder, "logs"),
    PROMPTFOO_DISABLE_TELEMETRY: "1",
    PROMPTFOO_DISABLE_SHARING: "1",
    PROMPTFOO_DISABLE_UPDATE: "1",
  };
}

/**
 * Reads every file under the given paths, reports those containing a secret and removes all the
 * paths whatever it found.
 *
 * @param {string[]} paths
 * @param {string[]} secrets
 * @returns {Promise<string[]>}
 */
async function removeLeakingFiles(paths, secrets) {
  /** @type {string[]} */
  const leaked = [];
  try {
    for (const path of paths) {
      const info = await stat(path).catch(() => undefined);
      if (!info) continue;
      const files = info.isDirectory()
        ? (await readdir(path, { recursive: true, withFileTypes: true }))
            .filter((entry) => entry.isFile())
            .map((entry) => join(entry.parentPath, entry.name))
        : [path];
      for (const file of files) {
        const text = await readFile(file, "utf8");
        if (secrets.some((secret) => text.includes(secret))) leaked.push(file);
      }
    }
  } finally {
    await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
  }
  return leaked;
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  main().catch((/** @type {unknown} */ error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
