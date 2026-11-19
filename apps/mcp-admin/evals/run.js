// @ts-check

// Runs the implemented model evals of the administrative MCP server and applies their gates.
//
//   node evals/run.js                 every implemented case, the required repeats (paid; run it as
//                                     `pnpm --filter @sebela/mcp-admin eval`, which supplies the key)
//   node evals/run.js --case <id> [--case <id>...]
//                                     only those implemented cases, the required repeats (paid;
//                                     through pnpm: `pnpm --filter @sebela/mcp-admin eval --case <id>`);
//                                     the summary's `scope` marks it partial and its gate covers
//                                     those cases. Issues run the cases their change affects.
//   node evals/run.js --regrade <run-folder>
//                                     grade a stored run's answers again with the current graders,
//                                     no model call (free); for a grader fix
//   node evals/run.js --check-fixture start and stop one fixture, no model call (free)
//
// An unknown option, an unknown or pending case, a missing or repeated case id or a regrade with
// another option stops the runner before any setting is read, fixture started or model called.
//
// The model is pinned: Claude Sonnet 5.5 at medium effort with prompt caching
// (`promptfooconfig.yaml`, the owner's decision in .plan/05-mcp-admin/evals.md). Every case-run
// keeps its answer and executed tool calls in the run folder's `answers/` (local, git-ignored,
// written only after the credential scan found nothing), so a grader fix is checked with
// `--regrade` instead of a new paid run. The redacted `summary.json` never holds them.
//
// Every case-run gets its own API on a fresh temporary database seeded from the case's fixture
// (`fixtures/s01` or `fixtures/s02`), two ephemeral API keys (`eval` for the model's client and
// `studio-desktop` for another of the owner's clients) and its own MCP server. Between Promptfoo
// and MCP Admin sits the controlled client adapter (`client.js`): it asks the scripted owner before
// every `save` and `delete` and plays the case's controlled events. Setup edits and concurrent
// edits go through the API with the other key. The keys reach Promptfoo only through the
// environment of its process, never as a test variable or prompt. The runner reads the content
// state through the API before and after the run, so a case passes only when Promptfoo's graders
// pass and the final state is the scenario's expected state (`scenarios.js`). Promptfoo runs with
// an allowlisted environment (no database or other checkout setting) and keeps its state and logs
// in the case-run's own folder; its raw output, state and logs are scanned for credentials and
// deleted when the case-run ends, whatever happened. The runner writes a redacted summary to the
// checkout's `.tmp/evals/mcp-admin/` and exits 1 when the gate fails or a credential would leak.
//
// Budget: at most `implemented cases x repeats` model conversations (45 for S01 and S02), each
// limited by max_tokens and max_tool_calls in promptfooconfig.yaml; a `--case` run at most
// `repeats` (3) per named case; a regrade none. Needs ANTHROPIC_API_KEY, the running Postgres and a build
// (`pnpm --filter @sebela/mcp-admin build`).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { catalogue, gates, implementedCases } from "./catalogue.js";
import { startClientAdapter } from "./client.js";
import { fixtureFolder, startApi, startMcp } from "./fixture.js";
import { evaluateGate } from "./gate.js";
import * as graders from "./graders.js";
import { EVAL_CLIENT, OTHER_CLIENT, scenarios } from "./scenarios.js";
import { captureState } from "./state.js";

const PROMPTFOO = "promptfoo@0.126.0";
/** The pinned model of every eval; `promptfooconfig.yaml` names the same one. */
export const MODEL = "claude-sonnet-5-5";
const evalsFolder = fileURLToPath(new URL("./", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const reportRoot = join(repositoryRoot, ".tmp", "evals", "mcp-admin");

/** The provenance of the edits the runner makes as another client. */
const RUNNER_PROVENANCE = "evals/other-client";

/**
 * Makes an edit through the API as another caller, the way another of the owner's clients would.
 *
 * @param {string} apiUrl
 * @param {string} key
 * @param {import("./scenarios.js").ApiEdit} edit
 */
export async function applyEdit(apiUrl, key, edit) {
  const response = await fetch(new URL(edit.path, apiUrl), {
    method: edit.method,
    redirect: "error",
    headers: {
      authorization: `Bearer ${key}`,
      "sebela-provenance": RUNNER_PROVENANCE,
      ...(edit.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(edit.body === undefined ? {} : { body: JSON.stringify(edit.body) }),
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw new Error(`${edit.method} ${edit.path} answered ${String(response.status)}.`);
  }
}

/**
 * Runs one repeat of one case in a fresh fixture.
 *
 * @param {import("./catalogue.js").EvalCase} entry
 * @param {number} repeat
 * @param {string} folder The run's report folder.
 */
async function runCase(entry, repeat, folder) {
  const scenario = scenarios[entry.id];
  if (!scenario) throw new Error(`${entry.id} has no scenario.`);
  const api = await startApi({
    seedFolder: fixtureFolder(scenario.fixture),
    keyNames: [EVAL_CLIENT, OTHER_CLIENT],
  });
  const key = api.keys[EVAL_CLIENT]?.key ?? "";
  const otherKey = api.keys[OTHER_CLIENT]?.key ?? "";
  const secrets = sentinels([key, otherKey]);
  /** @type {(() => Promise<void>)[]} */
  const stops = [];
  try {
    for (const edit of scenario.setup ?? []) await applyEdit(api.url, otherKey, edit);
    const mcp = await startMcp({ apiUrl: api.url });
    stops.push(mcp.stop);
    const { concurrent } = scenario;
    const client = await startClientAdapter({
      target: new URL("/mcp", mcp.url).href,
      approvals: scenario.approvals,
      ...(scenario.inject ? { inject: scenario.inject } : {}),
      ...(concurrent
        ? {
            concurrent: {
              after: concurrent.after,
              run: () => applyEdit(api.url, otherKey, concurrent.edit),
            },
          }
        : {}),
    });
    stops.push(client.stop);
    const name = `${entry.id}-${String(repeat)}`;
    const raw = join(folder, `${name}.raw.json`);
    const state = join(folder, `${name}.promptfoo`);
    /** @type {unknown} */
    let report;
    /** @type {string | null} */
    let stateFailure = null;
    /** @type {unknown} */
    let failure;
    /** @type {string[]} */
    let leaked = [];
    try {
      const before = await captureState(api.url, key);
      await promptfoo(
        entry.id,
        raw,
        promptfooEnvironment(
          process.env,
          {
            MCP_ADMIN_EVAL_URL: client.url,
            MCP_ADMIN_EVAL_KEY: key,
            MCP_ADMIN_EVAL_SENTINELS: JSON.stringify(secrets),
          },
          state,
        ),
      );
      const after = await captureState(api.url, key);
      report = /** @type {unknown} */ (JSON.parse(await readFile(raw, "utf8")));
      stateFailure = scenario.expect(before, after);
    } catch (error) {
      failure = error;
    } finally {
      // Promptfoo's raw output, state and logs never outlive the case-run.
      leaked = await removeLeakingFiles([raw, state], secrets);
    }
    // A leak outranks any other failure of the case-run.
    if (leaked.length > 0) {
      throw new Error(
        `${entry.id}: Promptfoo's output or logs contained a credential; they were deleted.`,
      );
    }
    if (failure !== undefined) throw failure;
    const answer = answerRecord(entry, repeat, report, stateFailure);
    if (answer) {
      await mkdir(join(folder, "answers"), { recursive: true });
      await writeFile(
        join(folder, "answers", `${name}.json`),
        `${JSON.stringify(answer, null, 2)}\n`,
      );
    }
    return summarize(entry, repeat, report, stateFailure);
  } finally {
    for (const stop of stops.reverse()) await stop();
    await api.stop();
  }
}

/**
 * Values that must never appear in an answer, a tool argument or a report: the case's keys and
 * the database password of this checkout.
 *
 * @param {readonly string[]} keys
 */
function sentinels(keys) {
  return [
    ...keys,
    process.env["DATABASE_PASSWORD"] ?? "",
    process.env["POSTGRES_PASSWORD"] ?? "",
  ].filter((value) => value.length >= 8);
}

/**
 * @param {string} caseId
 * @param {string} output
 * @param {Record<string, string>} env The complete environment of the Promptfoo process.
 */
function promptfoo(caseId, output, env) {
  const args = [
    "dlx",
    PROMPTFOO,
    "eval",
    "--config",
    "promptfooconfig.yaml",
    "--filter-pattern",
    `^${caseId} `,
    "--repeat",
    "1",
    "--no-cache",
    "--no-write",
    "--no-table",
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
      else reject(new Error(`Promptfoo exited with ${String(code)} for ${caseId}`));
    });
  });
}

/**
 * The environment of the Promptfoo process: only what pnpm, Node and the model provider need from
 * the parent (no database, API key pepper or other setting of this checkout), the case's own
 * values, and settings that keep Promptfoo's state and logs inside the run's state folder, without
 * telemetry, sharing or update checks.
 *
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
    TZ: "Europe/Prague",
    PROMPTFOO_CONFIG_DIR: stateFolder,
    PROMPTFOO_LOG_DIR: join(stateFolder, "logs"),
    PROMPTFOO_DISABLE_TELEMETRY: "1",
    PROMPTFOO_DISABLE_SHARING: "1",
    PROMPTFOO_DISABLE_UPDATE: "1",
  };
}

/** Parent variables the Promptfoo process may see. */
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
  "ANTHROPIC_API_KEY",
];

/**
 * Reads every file under the given paths, reports those containing a secret and removes all the
 * paths whatever it found. Missing paths are ignored.
 *
 * @param {string[]} paths
 * @param {string[]} secrets
 * @returns {Promise<string[]>} The files that contained a secret.
 */
export async function removeLeakingFiles(paths, secrets) {
  /** @type {string[]} */
  const leaked = [];
  try {
    for (const path of paths) {
      for (const file of await filesUnder(path)) {
        const text = await readFile(file, "utf8");
        if (secrets.some((secret) => text.includes(secret))) leaked.push(file);
      }
    }
  } finally {
    await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
  }
  return leaked;
}

/**
 * @param {string} path
 * @returns {Promise<string[]>}
 */
async function filesUnder(path) {
  const info = await stat(path).catch(() => undefined);
  if (!info) return [];
  if (!info.isDirectory()) return [path];
  const entries = await readdir(path, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * The redacted outcome of one case-run: pass/fail, reasons, executed tool names, latency, tokens
 * and cost. Answers and tool outputs stay out of the report.
 *
 * @param {import("./catalogue.js").EvalCase} entry
 * @param {number} repeat
 * @param {any} report Promptfoo's JSON output.
 * @param {string | null} stateFailure How the final content differs from the expected state.
 */
export function summarize(entry, repeat, report, stateFailure) {
  const expectedState = stateFailure === null;
  /** @type {any[]} */
  const results = report?.results?.results ?? [];
  const result = results[0];
  if (results.length !== 1 || !result) {
    return {
      caseId: entry.id,
      repeat,
      pass: false,
      reason: "Promptfoo ran no single result.",
      expectedState,
    };
  }
  /** @type {{ name: string, is_error?: boolean }[]} */
  const calls = result.response?.metadata?.toolCalls ?? [];
  const graded = Boolean(result.success);
  const reasons = [];
  if (!graded)
    reasons.push(String(result.gradingResult?.reason ?? result.error ?? "Grading failed."));
  if (stateFailure !== null) reasons.push(`Unexpected final state: ${stateFailure}`);
  return {
    caseId: entry.id,
    repeat,
    pass: graded && expectedState,
    reason: reasons.join(" ") || "Passed.",
    expectedState,
    toolCalls: calls.map((call) => ({ name: call.name, error: Boolean(call.is_error) })),
    latencyMs: result.latencyMs ?? null,
    tokens: result.response?.tokenUsage ?? null,
    cost: result.cost ?? null,
  };
}

/**
 * What a grader needs to grade one case-run again: the final answer and the executed tool calls
 * as Promptfoo recorded them, how the final content differed from the scenario's expected state
 * (null when it matched), and the model that answered. Kept only in the local run folder, never in
 * the redacted summary. Null when Promptfoo produced no single result.
 *
 * @param {import("./catalogue.js").EvalCase} entry
 * @param {number} repeat
 * @param {any} report Promptfoo's JSON output.
 * @param {string | null} stateFailure
 * @returns {StoredAnswer | null}
 */
export function answerRecord(entry, repeat, report, stateFailure) {
  /** @type {any[]} */
  const results = report?.results?.results ?? [];
  const result = results[0];
  if (results.length !== 1 || !result) return null;
  return {
    caseId: entry.id,
    repeat,
    model: MODEL,
    output: String(result.response?.output ?? ""),
    toolCalls: result.response?.metadata?.toolCalls ?? [],
    stateFailure,
  };
}

/**
 * @typedef {object} StoredAnswer
 * @property {string} caseId
 * @property {number} repeat
 * @property {string} model
 * @property {string} output
 * @property {unknown[]} toolCalls
 * @property {string | null} stateFailure How the final content differed from the expected state.
 */

/**
 * Grades stored answers again with the current graders, without calling a model: a grader fix is
 * checked on the very answers it failed. A stored answer of another model, or of a case that is
 * unknown or pending, is refused; a final content state that was not the scenario's expected state
 * still fails the case-run (the state is not read again: the fixture is gone). The safety grader
 * still refuses key- and connection-string-shaped answers; the sentinel values (the original run's
 * ephemeral keys and the database passwords) were checked when the answers were stored, which
 * happens only after the run's credential scan found none.
 *
 * @param {readonly StoredAnswer[]} answers
 * @returns {{ caseId: string, repeat: number, pass: boolean, reason: string, expectedState: boolean }[]}
 */
export function regradeRuns(answers) {
  return answers.map((answer) => {
    if (answer.model !== MODEL) {
      throw new Error(
        `${answer.caseId} repeat ${String(answer.repeat)}: answered by ${answer.model}, not the pinned model ${MODEL}.`,
      );
    }
    const entry = catalogue.find((candidate) => candidate.id === answer.caseId);
    if (!entry) throw new Error(`${answer.caseId} is not in the catalogue.`);
    if (entry.status !== "implemented") throw new Error(`${answer.caseId} is not implemented yet.`);
    const grader = /** @type {Record<string, unknown>} */ (graders)[`grade${entry.id}`];
    if (typeof grader !== "function") throw new Error(`${entry.id} has no grader.`);
    const graded = grader(answer.output, {
      metadata: { toolCalls: /** @type {import("./graders.js").ToolCall[]} */ (answer.toolCalls) },
    });
    const expectedState = answer.stateFailure === null;
    const reasons = [];
    if (!graded.pass) reasons.push(String(graded.reason));
    if (!expectedState) reasons.push(`Unexpected final state: ${String(answer.stateFailure)}`);
    return {
      caseId: entry.id,
      repeat: answer.repeat,
      pass: Boolean(graded.pass) && expectedState,
      reason: reasons.join(" ") || "Passed.",
      expectedState,
    };
  });
}

/**
 * The provider usage of a whole evaluation: case-runs, prompt/completion/total tokens and cost as
 * Promptfoo reported them per case-run, and the average cost per conversation. Case-runs without a
 * usage report still count as conversations and are counted in `unreported`.
 *
 * @param {readonly { tokens?: { prompt?: number, completion?: number, total?: number } | null, cost?: number | null }[]} runs
 * @returns {{ conversations: number, unreported: number, tokens: { prompt: number, completion: number, total: number }, cost: number, costPerConversation: number | null }}
 */
export function totals(runs) {
  const tokens = { prompt: 0, completion: 0, total: 0 };
  let cost = 0;
  let unreported = 0;
  for (const run of runs) {
    if (!run.tokens && typeof run.cost !== "number") unreported += 1;
    tokens.prompt += run.tokens?.prompt ?? 0;
    tokens.completion += run.tokens?.completion ?? 0;
    tokens.total += run.tokens?.total ?? 0;
    cost += run.cost ?? 0;
  }
  return {
    conversations: runs.length,
    unreported,
    tokens,
    cost,
    costPerConversation: runs.length === 0 ? null : cost / runs.length,
  };
}

/**
 * What one invocation of the runner does, from its command-line options: only check the fixture,
 * grade a stored run again (`--regrade <folder>`, no model call), run every implemented case (a
 * full run), or run the named implemented cases (`--case <id>`, repeatable, a partial run).
 * Refuses an unknown option, an unknown or pending case, a missing or repeated case id and a
 * regrade combined with another option, before any fixture starts or model is called.
 *
 * @param {readonly string[]} args
 * @returns {{ checkFixture: boolean, regrade: string | null, cases: readonly import("./catalogue.js").EvalCase[], partial: { cases: string[] } | null }}
 */
export function planRun(args) {
  let checkFixture = false;
  /** @type {string | null} */
  let regrade = null;
  /** @type {string[]} */
  const caseIds = [];
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--check-fixture") {
      checkFixture = true;
    } else if (option === "--case") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--case needs a case id.");
      if (caseIds.includes(value)) throw new Error(`${value} is named twice.`);
      caseIds.push(value);
      index += 1;
    } else if (option === "--regrade") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new Error("--regrade needs a run folder.");
      regrade = value;
      index += 1;
    } else {
      throw new Error(`Unknown option ${String(option)}.`);
    }
  }
  if (regrade !== null) {
    if (checkFixture || caseIds.length > 0) throw new Error("--regrade takes no other option.");
    return { checkFixture: false, regrade, cases: [], partial: null };
  }
  if (caseIds.length === 0) {
    return { checkFixture, regrade: null, cases: implementedCases(), partial: null };
  }
  const cases = caseIds.map((caseId) => {
    const entry = catalogue.find((candidate) => candidate.id === caseId);
    if (!entry) throw new Error(`${caseId} is not in the catalogue.`);
    if (entry.status !== "implemented") throw new Error(`${caseId} is not implemented yet.`);
    return entry;
  });
  return { checkFixture, regrade: null, cases, partial: { cases: caseIds } };
}

/**
 * Grades the stored answers of a run folder again and writes `regraded-<time>.json` next to its
 * summary: the gate over the cases of the original run, with no model call and no cost.
 *
 * @param {string} folder
 */
async function regradeFolder(folder) {
  const original = JSON.parse(await readFile(join(folder, "summary.json"), "utf8"));
  const answersFolder = join(folder, "answers");
  const files = (await readdir(answersFolder)).filter((file) => file.endsWith(".json")).sort();
  const answers = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(join(answersFolder, file), "utf8"))),
  );
  const runs = regradeRuns(answers);
  /** @type {string[]} */
  const scopeCases = original?.scope?.partial ? (original.scope.cases ?? []) : [];
  const cases =
    scopeCases.length > 0 ? catalogue.filter((entry) => scopeCases.includes(entry.id)) : undefined;
  const gate = evaluateGate(runs, cases ? { cases } : {});
  const regradedAt = new Date().toISOString();
  const result = {
    regradedAt,
    of: original.startedAt,
    scope: original.scope,
    model: MODEL,
    gate,
    runs,
  };
  const report = join(folder, `regraded-${regradedAt.replaceAll(":", "-")}.json`);
  await writeFile(report, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ scope: original.scope, gate, cost: 0, report }, null, 2)}\n`,
  );
  if (!gate.pass) process.exitCode = 1;
}

async function main() {
  // Invalid options stop the runner before any setting is read or fixture started.
  const plan = planRun(process.argv.slice(2));
  if (plan.regrade !== null) {
    await regradeFolder(plan.regrade);
    return;
  }
  // The process environment wins, then this checkout's files, then the documented examples.
  for (const name of [".env.local", ".env", ".env.example"]) {
    const file = join(repositoryRoot, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
  if (plan.checkFixture) {
    for (const fixture of /** @type {const} */ (["s01", "s02"])) {
      const api = await startApi({
        seedFolder: fixtureFolder(fixture),
        keyNames: [EVAL_CLIENT, OTHER_CLIENT],
      });
      try {
        const mcp = await startMcp({ apiUrl: api.url });
        const client = await startClientAdapter({
          target: new URL("/mcp", mcp.url).href,
          approvals: [],
        });
        await client.stop();
        await mcp.stop();
        await captureState(api.url, api.keys[EVAL_CLIENT]?.key ?? "");
      } finally {
        await api.stop();
      }
    }
    process.stdout.write("The eval fixtures started and stopped cleanly.\n");
    return;
  }
  if (!process.env["ANTHROPIC_API_KEY"]) {
    throw new Error(
      "Set ANTHROPIC_API_KEY to run the paid evals; ordinary CI runs only the graders' tests.",
    );
  }

  const startedAt = new Date().toISOString();
  const folder = join(reportRoot, startedAt.replaceAll(":", "-"));
  await mkdir(folder, { recursive: true });
  const runs = [];
  for (const entry of plan.cases) {
    for (let repeat = 1; repeat <= gates.repeats; repeat += 1) {
      runs.push(await runCase(entry, repeat, folder));
    }
  }
  // A partial run is gated on its own case only; it never stands in for a full run's gate.
  const gate = evaluateGate(runs, plan.partial ? { cases: plan.cases } : {});
  const summary = {
    startedAt,
    scope: plan.partial ? { partial: true, cases: plan.partial.cases } : { partial: false },
    pinned: {
      promptfoo: PROMPTFOO,
      provider: `anthropic:messages:${MODEL}`,
      effort: "medium",
      promptCaching: true,
      maxTokens: 4096,
      maxToolCalls: 6,
      timeoutMs: 120000,
      clock: "2026-11-17T12:00:00+01:00 Europe/Prague (prompt only)",
      dataset: "fixtures/s01 (S01 cases), fixtures/s02 (S02 cases)",
      repeats: gates.repeats,
      noncriticalFloor: gates.noncriticalFloor,
    },
    gate,
    usage: totals(runs),
    runs,
  };
  await writeFile(join(folder, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ scope: summary.scope, gate, usage: summary.usage, report: join(folder, "summary.json") }, null, 2)}\n`,
  );
  if (!gate.pass) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((/** @type {unknown} */ error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
