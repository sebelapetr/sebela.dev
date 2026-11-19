// @ts-check

// Runs the implemented model evals of the administrative MCP server and applies their gates.
//
//   node evals/run.js                 every implemented case, the required repeats (paid)
//   node evals/run.js --check-fixture start and stop one fixture, no model call (free)
//
// Every case-run gets its own API on a fresh temporary database seeded from `fixtures/s01`, its
// own ephemeral API key and its own MCP server. The key reaches Promptfoo only through the
// environment of its process, never as a test variable or prompt. The runner snapshots the
// fixture's content before and after the run, so a case passes only when Promptfoo's graders pass
// and nothing changed. Promptfoo runs with an allowlisted environment (no database or other
// checkout setting) and keeps its state and logs in the case-run's own folder; its raw output,
// state and logs are scanned for credentials and deleted when the case-run ends, whatever happened.
// The runner writes a redacted summary to the checkout's `.tmp/evals/mcp-admin/` and exits 1 when
// the gate fails or a credential would leak.
//
// Budget: at most `implemented cases x repeats` model conversations (9 for S01), each limited by
// max_tokens in promptfooconfig.yaml. Needs ANTHROPIC_API_KEY, the running Postgres and a build
// (`pnpm --filter @sebela/mcp-admin build`).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { gates, implementedCases } from "./catalogue.js";
import { fixtureFolder, startApi, startMcp } from "./fixture.js";
import { evaluateGate } from "./gate.js";

const PROMPTFOO = "promptfoo@0.126.0";
const evalsFolder = fileURLToPath(new URL("./", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const reportRoot = join(repositoryRoot, ".tmp", "evals", "mcp-admin");

/**
 * The content a case could change, read through the public API: the person and the projects.
 *
 * @param {string} apiUrl
 * @returns {Promise<string>}
 */
export async function snapshot(apiUrl) {
  const [person, projects] = await Promise.all(
    ["/v1/person", "/v1/projects"].map(async (path) => {
      const response = await fetch(new URL(path, apiUrl), { redirect: "error" });
      return { status: response.status, body: await response.text() };
    }),
  );
  return JSON.stringify({ person, projects });
}

/**
 * Runs one repeat of one case in a fresh fixture.
 *
 * @param {import("./catalogue.js").EvalCase} entry
 * @param {number} repeat
 * @param {string} folder The run's report folder.
 */
async function runCase(entry, repeat, folder) {
  const api = await startApi({ seedFolder: fixtureFolder("s01"), keyNames: ["eval"] });
  const key = api.keys["eval"]?.key ?? "";
  try {
    const mcp = await startMcp({ apiUrl: api.url });
    const name = `${entry.id}-${String(repeat)}`;
    const raw = join(folder, `${name}.raw.json`);
    const state = join(folder, `${name}.promptfoo`);
    /** @type {unknown} */
    let report;
    let unchanged = false;
    /** @type {unknown} */
    let failure;
    /** @type {string[]} */
    let leaked = [];
    try {
      const before = await snapshot(api.url);
      await promptfoo(
        entry.id,
        raw,
        promptfooEnvironment(
          process.env,
          {
            MCP_ADMIN_EVAL_URL: new URL("/mcp", mcp.url).href,
            MCP_ADMIN_EVAL_KEY: key,
            MCP_ADMIN_EVAL_SENTINELS: JSON.stringify(sentinels(key)),
          },
          state,
        ),
      );
      const after = await snapshot(api.url);
      report = /** @type {unknown} */ (JSON.parse(await readFile(raw, "utf8")));
      unchanged = before === after;
    } catch (error) {
      failure = error;
    } finally {
      await mcp.stop();
      // Promptfoo's raw output, state and logs never outlive the case-run.
      leaked = await removeLeakingFiles([raw, state], sentinels(key));
    }
    // A leak outranks any other failure of the case-run.
    if (leaked.length > 0) {
      throw new Error(
        `${entry.id}: Promptfoo's output or logs contained a credential; they were deleted.`,
      );
    }
    if (failure !== undefined) throw failure;
    return summarize(entry, repeat, report, unchanged);
  } finally {
    await api.stop();
  }
}

/**
 * Values that must never appear in an answer, a tool argument or a report: the case's key and the
 * database password of this checkout.
 *
 * @param {string} key
 */
function sentinels(key) {
  return [
    key,
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
 * @param {boolean} unchanged
 */
export function summarize(entry, repeat, report, unchanged) {
  /** @type {any[]} */
  const results = report?.results?.results ?? [];
  const result = results[0];
  if (results.length !== 1 || !result) {
    return {
      caseId: entry.id,
      repeat,
      pass: false,
      reason: "Promptfoo ran no single result.",
      unchanged,
    };
  }
  /** @type {{ name: string, is_error?: boolean }[]} */
  const calls = result.response?.metadata?.toolCalls ?? [];
  const graded = Boolean(result.success);
  const reasons = [];
  if (!graded)
    reasons.push(String(result.gradingResult?.reason ?? result.error ?? "Grading failed."));
  if (!unchanged) reasons.push("The fixture's content changed.");
  return {
    caseId: entry.id,
    repeat,
    pass: graded && unchanged,
    reason: reasons.join(" ") || "Passed.",
    unchanged,
    toolCalls: calls.map((call) => ({ name: call.name, error: Boolean(call.is_error) })),
    latencyMs: result.latencyMs ?? null,
    tokens: result.response?.tokenUsage ?? null,
    cost: result.cost ?? null,
  };
}

async function main() {
  // The process environment wins, then this checkout's files, then the documented examples.
  for (const name of [".env.local", ".env", ".env.example"]) {
    const file = join(repositoryRoot, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
  const args = process.argv.slice(2);
  if (args.includes("--check-fixture")) {
    const api = await startApi({ seedFolder: fixtureFolder("s01"), keyNames: ["eval"] });
    try {
      const mcp = await startMcp({ apiUrl: api.url });
      await mcp.stop();
      await snapshot(api.url);
    } finally {
      await api.stop();
    }
    process.stdout.write("The eval fixture started and stopped cleanly.\n");
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
  for (const entry of implementedCases()) {
    for (let repeat = 1; repeat <= gates.repeats; repeat += 1) {
      runs.push(await runCase(entry, repeat, folder));
    }
  }
  const gate = evaluateGate(runs);
  const summary = {
    startedAt,
    pinned: {
      promptfoo: PROMPTFOO,
      provider: "anthropic:messages:claude-opus-5-5",
      maxTokens: 4096,
      maxToolCalls: 4,
      timeoutMs: 120000,
      clock: "2026-11-17T12:00:00+01:00 Europe/Prague (prompt only)",
      dataset: "fixtures/s01",
      repeats: gates.repeats,
      noncriticalFloor: gates.noncriticalFloor,
    },
    gate,
    runs,
  };
  await writeFile(join(folder, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ gate, report: join(folder, "summary.json") }, null, 2)}\n`,
  );
  if (!gate.pass) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((/** @type {unknown} */ error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
