// The phase loop's wiring of the steward's stops (issue #384, items 7 and 8), run as the owner
// runs it: `node harness/run-phase.mjs <phase>` in a disposable repository, with stand-ins for
// `claude`, `gh` and `docker` on the PATH and fixture eval ledgers. No model, no network, no
// Docker: the stand-ins answer what the loop asks and record what it does.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRepo } from "./lib/hook-fixtures.mjs";

const LOOP = path.join(import.meta.dirname, "run-phase.mjs");
const PHASE = "07-ai-service";

const fixtures = [];
after(() => {
  for (const fixture of fixtures) {
    // A stand-in that a failing loop left behind must not outlive the test.
    for (const file of ["eval-child.pid", "claude.pid"]) {
      try {
        process.kill(Number(fs.readFileSync(path.join(fixture.dir, file), "utf8")), "SIGKILL");
      } catch {
        // already gone
      }
    }
    fixture.cleanup();
  }
});

const STUB_HEAD = `#!${process.execPath}
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const dir = process.env.STUB_DIR;
const record = (file, entry) =>
  fs.appendFileSync(path.join(dir, file), JSON.stringify(entry) + "\\n");
`;

// `docker info` and a healthy Postgres service.
const DOCKER = `${STUB_HEAD}
if (args[0] === "compose") console.log(JSON.stringify({ Health: "healthy", State: "running" }));
else console.log("27.0.0");
`;

// gh: signed in, no issues, no pull requests, no workflow runs; every call is recorded.
const GH = `${STUB_HEAD}
record("gh-calls.jsonl", args);
if (args[0] === "auth" || args[1] === "comment" || args[1] === "edit") process.exit(0);
console.log("[]");
`;

// claude: the steward agent answers "ok" at once. The orchestrator is recorded and then does what
// CLAUDE_STUB says: "hang" writes a transcript that names its issue worktree, starts a child that
// stands for a paid eval command, writes a ledger that crosses the ceiling into that worktree,
// ignores the first interrupt and waits to be ended. The child ignores every signal it can.
const CLAUDE = `${STUB_HEAD}
import { spawn } from "node:child_process";
const value = (name) => args[args.indexOf(name) + 1];
if (value("--agent") === "steward") {
  console.log(JSON.stringify({ structured_output: { status: "ok", findings: [] } }));
  process.exit(0);
}
record("claude-calls.jsonl", {
  agent: value("--agent"),
  campaign: process.env.SEBELA_EVAL_CAMPAIGN ?? null,
  kept: process.env.SEBELA_EVAL_KEPT_RUNS ?? null,
});
if (process.env.CLAUDE_STUB === "hang") {
  fs.writeFileSync(path.join(dir, "claude.pid"), String(process.pid));
  const root = process.cwd();
  const transcripts = path.join(
    process.env.CLAUDE_CONFIG_DIR,
    "projects",
    root.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  fs.mkdirSync(transcripts, { recursive: true });
  fs.writeFileSync(
    path.join(transcripts, value("--session-id") + ".jsonl"),
    JSON.stringify({
      type: "assistant",
      timestamp: new Date().toISOString(),
      message: {
        id: "m1",
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "Bash",
            input: { command: "node harness/worktree.mjs create feat/301-chat --base origin/phase/${PHASE}" },
          },
        ],
      },
    }) + "\\n",
  );
  const child = spawn(
    process.execPath,
    ["-e", "process.on('SIGINT', () => {}); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
    // Its own session and process group, as Claude Code's Bash tool starts every command: a
    // signal to the orchestrator's process group does not reach it.
    { stdio: "ignore", detached: true },
  );
  child.unref();
  fs.writeFileSync(path.join(dir, "eval-child.pid"), String(child.pid));
  const ledger = path.join(root, ".worktrees", "feat-301-chat", ".tmp", "evals", "llm-agent", "ledger.json");
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(
    ledger,
    JSON.stringify({
      runs: [
        {
          run: "r1",
          at: new Date().toISOString(),
          campaign: "${PHASE}",
          stage: "phase-pr",
          scope: "partial",
          spent_usd: 4,
          uncertain_usd: 0,
        },
      ],
    }),
  );
  let interrupts = 0;
  process.on("SIGINT", () => {
    interrupts += 1;
    fs.writeFileSync(path.join(dir, "interrupted"), String(interrupts));
  });
  setInterval(() => {}, 1000);
} else {
  console.log(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      structured_output: { outcome: "phase_done", issue: null, cause: null, summary: "nothing left" },
    }),
  );
}
`;

function fixture(name) {
  const created = createRepo(`sebela-loop-${name}-`);
  fixtures.push(created);
  const main = created.repo;
  const stubs = path.join(created.dir, "stubs");
  fs.mkdirSync(stubs);
  for (const [tool, source] of Object.entries({ docker: DOCKER, gh: GH, claude: CLAUDE })) {
    fs.writeFileSync(path.join(stubs, tool), source, { mode: 0o755 });
    // Node reads a script without an extension as CommonJS unless a package says otherwise.
  }
  fs.writeFileSync(path.join(stubs, "package.json"), JSON.stringify({ type: "module" }));
  const campaigns = path.join(main, "packages", "llm-agent", "evals", "campaigns.json");
  fs.mkdirSync(path.dirname(campaigns), { recursive: true });
  fs.writeFileSync(
    campaigns,
    JSON.stringify({ [PHASE]: { ceiling_usd: 4, issue_stop_usd: 1.5, run_stop_usd: 1 } }),
  );
  const lines = (file) => {
    try {
      return fs
        .readFileSync(path.join(created.dir, file), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  };
  const loop = (stub, extra = []) =>
    spawnSync(
      process.execPath,
      [LOOP, PHASE, "--no-notify", "--max-iterations", "1", "--wait-minutes", "0.01", ...extra],
      {
        cwd: main,
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          PATH: `${stubs}:${path.dirname(process.execPath)}:${process.env.PATH}`,
          STUB_DIR: created.dir,
          CLAUDE_STUB: stub,
          CLAUDE_CONFIG_DIR: path.join(created.dir, "claude"),
        },
      },
    );
  // The same loop started without waiting for it, for a test that signals it.
  const start = (stub, extra = []) =>
    spawn(process.execPath, [LOOP, PHASE, "--no-notify", "--max-iterations", "1", ...extra], {
      cwd: main,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${stubs}:${path.dirname(process.execPath)}:${process.env.PATH}`,
        STUB_DIR: created.dir,
        CLAUDE_STUB: stub,
        CLAUDE_CONFIG_DIR: path.join(created.dir, "claude"),
      },
    });
  return { main, dir: created.dir, lines, loop, start };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("a ledger at the ceiling stops the loop before an orchestrator is started", () => {
  const { main, lines, loop } = fixture("ceiling");
  const ledger = path.join(main, ".tmp", "evals", "llm-agent", "ledger.json");
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(
    ledger,
    JSON.stringify({
      runs: [{ run: "r1", campaign: PHASE, stage: "phase-pr", spent_usd: 4, uncertain_usd: 0 }],
    }),
  );
  const run = loop("report");
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /stopping: the steward's rules stopped the loop: the 4\.00 USD ceiling/);
  assert.deepEqual(lines("claude-calls.jsonl"), [], "no orchestrator was started");
  assert.ok(!lines("gh-calls.jsonl").some((call) => call[1] === "edit"), "no label was set");
});

test("without a stop the loop starts the orchestrator with the phase's campaign and kept runs", () => {
  const { main, lines, loop } = fixture("normal");
  const run = loop("report");
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(lines("claude-calls.jsonl"), [
    {
      agent: "orchestrator",
      campaign: PHASE,
      kept: path.join(main, ".worktrees", "logs", PHASE, "eval-spend.json"),
    },
  ]);
  assert.match(run.stdout, /spend: unknown \(no eval ledger was found on this machine\)/);
});

test("a ceiling crossed during a check ends the run, sets no label and keeps the worktree", () => {
  const { main, dir, lines, loop } = fixture("crossed");
  // A check every 1.2 seconds; one second between interrupt, terminate and kill.
  const run = loop("hang", ["--steward-minutes", "0.02", "--stop-grace-seconds", "1"]);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /stopping: the steward's rules stopped the loop on #301: /);
  assert.match(run.stdout, /ceiling/);
  // The orchestrator ignored the interrupt and was ended anyway; so was the command it had started.
  assert.equal(fs.readFileSync(path.join(dir, "interrupted"), "utf8"), "1");
  const child = Number(fs.readFileSync(path.join(dir, "eval-child.pid"), "utf8"));
  assert.equal(alive(child), false, "the eval child outlived the orchestrator");
  const gh = lines("gh-calls.jsonl");
  assert.ok(!gh.some((call) => call[0] === "issue" && call[1] === "edit"), "a label was set");
  assert.ok(fs.existsSync(path.join(main, ".worktrees", "feat-301-chat")), "the worktree is kept");
  // The stop is noted on the issue, without the place the checkout lives in.
  const comment = gh.find((call) => call[0] === "issue" && call[1] === "comment");
  assert.deepEqual(comment.slice(0, 3), ["issue", "comment", "301"]);
  const body = comment[comment.indexOf("--body") + 1];
  assert.match(body, /Loop note: the steward's rules stopped the phase loop/);
  assert.ok(!body.includes(dir), "the comment names the checkout's path");
  assert.ok(!run.stdout.split("\n").some((line) => /stopping:/.test(line) && line.includes(main)));
  // The iteration's record says what stopped it.
  const logs = path.join(main, ".worktrees", "logs", PHASE);
  const record = fs.readdirSync(logs).find((name) => /-1\.json$/.test(name));
  const logged = JSON.parse(fs.readFileSync(path.join(logs, record), "utf8"));
  assert.equal(logged.decision.reason, "steward");
  assert.equal(logged.stewardStopped.by, "rules");
});

test("Ctrl+C ends the run through the same path, and the loop says it was interrupted", async () => {
  const { dir, lines, start } = fixture("interrupt");
  // No steward: only the owner's interrupt ends this run.
  const loop = start("hang", ["--steward-minutes", "0", "--stop-grace-seconds", "1"]);
  let stdout = "";
  loop.stdout.on("data", (chunk) => (stdout += chunk));
  const exited = new Promise((resolve) => loop.on("close", resolve));
  const pidFile = path.join(dir, "eval-child.pid");
  for (let waited = 0; !fs.existsSync(pidFile) && waited < 20_000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(fs.existsSync(pidFile), "the orchestrator stand-in never started");
  loop.kill("SIGINT");
  const timeout = setTimeout(() => loop.kill("SIGKILL"), 30_000);
  await exited;
  clearTimeout(timeout);
  // The stand-in ignored the interrupt and its child every signal it could: both are gone.
  assert.equal(alive(Number(fs.readFileSync(path.join(dir, "claude.pid"), "utf8"))), false);
  assert.equal(alive(Number(fs.readFileSync(pidFile, "utf8"))), false);
  assert.match(stdout, /interrupted; run the same command again to continue/);
  assert.ok(!lines("gh-calls.jsonl").some((call) => call[1] === "edit"), "a label was set");
});
