// What the steward gathers from disk: the eval spend of a phase from the ledgers of every
// checkout and the runs it kept, and the machine's state. Fixture folders only.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hardStops } from "./lib/steward.mjs";
import { keptRunsFile, machineFacts, phaseSpend } from "./steward.mjs";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-steward-"));
after(() => fs.rmSync(fixture, { recursive: true, force: true }));

const PHASE = "07-ai-service";
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const run = (id, spent, extra = {}) => ({
  run: id,
  at: "2026-11-21T10:00:00+00:00",
  campaign: PHASE,
  stage: "issue",
  scope: "partial",
  spent_usd: spent,
  uncertain_usd: 0,
  ...extra,
});
const ledgerOf = (root) => path.join(root, ".tmp", "evals", "llm-agent", "ledger.json");

function checkout(name) {
  const mainRoot = path.join(fixture, name);
  write(
    path.join(mainRoot, "packages", "llm-agent", "evals", "campaigns.json"),
    JSON.stringify({ [PHASE]: { ceiling_usd: 4, issue_stop_usd: 1.5, run_stop_usd: 1 } }),
  );
  const logDir = path.join(mainRoot, ".worktrees", "logs", PHASE);
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(path.join(mainRoot, ".worktrees", "locks"), { recursive: true });
  return { mainRoot, logDir, worktree: (w) => path.join(mainRoot, ".worktrees", w) };
}

test("the spend of a phase adds up the ledgers of the main checkout and every worktree", () => {
  const { mainRoot, logDir, worktree } = checkout("adds-up");
  write(
    ledgerOf(mainRoot),
    JSON.stringify({ runs: [run("m1", 0.5), { run: "old", spent_usd: 9 }] }),
  );
  write(ledgerOf(worktree("feat-1-x")), JSON.stringify({ runs: [run("w1", 0.25)] }));
  fs.mkdirSync(worktree("feat-2-y"), { recursive: true });
  const spend = phaseSpend({ mainRoot, phase: PHASE, logDir });
  assert.equal(spend.spentUsd, 0.75);
  assert.equal(spend.remainingUsd, 3.25);
  assert.deepEqual(spend.unknown, []);
});

test("the spend of a removed worktree is kept", () => {
  const { mainRoot, logDir, worktree } = checkout("kept");
  write(ledgerOf(worktree("feat-1-x")), JSON.stringify({ runs: [run("w1", 0.25)] }));
  assert.equal(phaseSpend({ mainRoot, phase: PHASE, logDir }).spentUsd, 0.25);
  fs.rmSync(worktree("feat-1-x"), { recursive: true });
  write(ledgerOf(worktree("feat-2-y")), JSON.stringify({ runs: [run("w1", 0.5)] }));
  const spend = phaseSpend({ mainRoot, phase: PHASE, logDir });
  assert.equal(spend.spentUsd, 0.75);
  assert.deepEqual(spend.unknown, []);
});

test("no ledger anywhere is unknown spend", () => {
  const { mainRoot, logDir } = checkout("none");
  const spend = phaseSpend({ mainRoot, phase: PHASE, logDir });
  assert.equal(spend.spentUsd, null);
  assert.equal(spend.unknown[0].code, "no-ledger");
  assert.ok(!fs.existsSync(path.join(logDir, "eval-spend.json")), "nothing is kept for nothing");
});

test("an unreadable ledger or kept record is named and never overwritten", () => {
  const { mainRoot, logDir, worktree } = checkout("unreadable");
  write(ledgerOf(mainRoot), JSON.stringify({ runs: [run("m1", 0.5)] }));
  write(ledgerOf(worktree("feat-3-z")), "{ broken");
  const spend = phaseSpend({ mainRoot, phase: PHASE, logDir });
  assert.equal(spend.spentUsd, 0.5);
  assert.match(spend.unknown[0].message, /feat-3-z/);

  write(path.join(logDir, "eval-spend.json"), "not json");
  const again = phaseSpend({ mainRoot, phase: PHASE, logDir });
  assert.ok(again.unknown.some((item) => /kept runs/.test(item.message)));
  assert.equal(fs.readFileSync(path.join(logDir, "eval-spend.json"), "utf8"), "not json");
});

test("missing campaigns leave the ceiling unknown", () => {
  const { mainRoot, logDir } = checkout("no-campaigns");
  fs.rmSync(path.join(mainRoot, "packages"), { recursive: true });
  write(ledgerOf(mainRoot), JSON.stringify({ runs: [run("m1", 0.5)] }));
  const spend = phaseSpend({ mainRoot, phase: PHASE, logDir });
  assert.equal(spend.ceilingUsd, null);
  assert.equal(spend.unknown[0].code, "no-campaigns");
});

test("runs written since a moment are listed for the check", () => {
  const { mainRoot, logDir } = checkout("recent");
  write(
    ledgerOf(mainRoot),
    JSON.stringify({ runs: [run("m1", 0.5), run("m2", 1.2, { at: "2026-11-21T11:00:00+00:00" })] }),
  );
  const spend = phaseSpend({
    mainRoot,
    phase: PHASE,
    logDir,
    since: Date.parse("2026-11-21T10:30:00Z"),
  });
  assert.deepEqual(
    spend.recent.map((item) => [item.run, item.source, item.spentUsd]),
    [["m2", "the main checkout", 1.2]],
  );
});

test("the machine's load, cores and free disk space are read", () => {
  const facts = machineFacts(fixture);
  assert.ok(facts.cores >= 1);
  assert.ok(facts.freeDiskGb === null || facts.freeDiskGb >= 0);
  assert.ok(facts.load1 === null || facts.load1 >= 0);
  assert.equal(machineFacts(path.join(fixture, "missing")).cores, facts.cores);
});

// --- the gaps of the first guards (issue #384) -------------------------------------

test("three issue worktrees of USD 1.00 each stop the loop at the issue stop", () => {
  const { mainRoot, logDir, worktree } = checkout("issue-stop");
  for (const name of ["feat-1-x", "feat-2-y", "feat-3-z"]) {
    write(ledgerOf(worktree(name)), JSON.stringify({ runs: [run("r1", 1)] }));
  }
  const spend = phaseSpend({ mainRoot, phase: PHASE, logDir });
  assert.equal(spend.issueSpentUsd, 3);
  const stops = hardStops({ spend });
  assert.deepEqual(
    stops.map((stop) => stop.code),
    ["issue-stop"],
  );
  // The record the eval runner reads names every worktree's run.
  const kept = JSON.parse(fs.readFileSync(keptRunsFile(logDir), "utf8")).runs;
  assert.deepEqual(
    kept.map((item) => [item.source, item.run, item.campaign, item.stage, item.spentUsd]),
    ["feat-1-x", "feat-2-y", "feat-3-z"].map((name) => [name, "r1", PHASE, "issue", 1]),
  );
});

test("a run interrupted long ago is no longer projected", () => {
  const { mainRoot, logDir } = checkout("stale");
  const stale = run("m1", 3.5, {
    stage: "phase-pr",
    scope: "running",
    expected_usd: 4.4,
    at: "2026-01-01T10:00:00+00:00",
  });
  write(ledgerOf(mainRoot), JSON.stringify({ runs: [stale] }));
  const spend = phaseSpend({ mainRoot, phase: PHASE, logDir });
  assert.equal(spend.projectedUsd, 3.5);
  assert.deepEqual(hardStops({ spend }), []);
});
