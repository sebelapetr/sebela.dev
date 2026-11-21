import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  LEGACY_CAMPAIGN,
  ledgerRuns,
  mergeRuns,
  parseCampaigns,
  spendChange,
  spendLine,
  summarizeSpend,
} from "./spend.mjs";

const CAMPAIGNS = parseCampaigns(
  JSON.stringify({
    "06-llm-agent": { ceiling_usd: 13, issue_stop_usd: null, run_stop_usd: null },
    "07-ai-service": { ceiling_usd: 4, issue_stop_usd: 1.5, run_stop_usd: 1 },
  }),
);
const PHASE = "07-ai-service";

const entry = (run, spent, extra = {}) => ({
  run,
  at: "2026-11-21T10:00:00+00:00",
  campaign: PHASE,
  stage: "issue",
  scope: "partial",
  spent_usd: spent,
  uncertain_usd: 0,
  ...extra,
});
const ledger = (...runs) => JSON.stringify({ runs });
const summary = (runs, extra = {}) =>
  summarizeSpend({ phase: PHASE, campaigns: CAMPAIGNS, runs, found: 1, ...extra });

// --- the campaigns the Python budget module enforces --------------------------------

test("the campaigns are read from the file the eval runner enforces", () => {
  const file = new URL("../../packages/llm-agent/evals/campaigns.json", import.meta.url);
  const campaigns = parseCampaigns(fs.readFileSync(file, "utf8"));
  assert.deepEqual(campaigns["07-ai-service"], { ceilingUsd: 4, issueStopUsd: 1.5, runStopUsd: 1 });
  assert.equal(campaigns["07.1-jev-gateway"].ceilingUsd, 2);
  assert.equal(campaigns["08-mcp-public"].ceilingUsd, 2.3);
  assert.equal(campaigns[LEGACY_CAMPAIGN].ceilingUsd, 13);
});

test("campaigns that cannot be read are unknown, not empty", () => {
  assert.equal(parseCampaigns("not json"), null);
  assert.equal(parseCampaigns("[]"), null);
  assert.equal(parseCampaigns(JSON.stringify({ x: { ceiling_usd: "a lot" } })), null);
});

// --- ledgers ---------------------------------------------------------------------

test("a ledger gives its runs with their campaign, stage and cost", () => {
  const runs = ledgerRuns(
    ledger(
      entry("r1", 0.25, { uncertain_usd: 0.02, expected_usd: 0.2 }),
      entry("r2", 0.5, { stage: "phase-pr", scope: "running", provisional_usd: 0.3 }),
      { run: "old", spent_usd: 9.5, uncertain_usd: 0.1 },
    ),
    "feat-1-x",
  );
  assert.deepEqual(runs[0], {
    key: "feat-1-x/r1",
    source: "feat-1-x",
    run: "r1",
    at: "2026-11-21T10:00:00+00:00",
    campaign: PHASE,
    stage: "issue",
    scope: "partial",
    spentUsd: 0.25,
    uncertainUsd: 0.02,
    expectedUsd: 0.2,
    running: false,
  });
  assert.equal(runs[1].running, true);
  assert.equal(runs[1].expectedUsd, null);
  // An entry written before campaigns were named belongs to phase 6.
  assert.equal(runs[2].campaign, LEGACY_CAMPAIGN);
  assert.equal(runs[2].stage, null);
});

test("a ledger that cannot be read is unknown, never an empty ledger", () => {
  assert.equal(ledgerRuns("{ broken", "x"), null);
  assert.equal(ledgerRuns(JSON.stringify({ runs: "none" }), "x"), null);
  assert.equal(ledgerRuns(JSON.stringify({ runs: [{ run: "r", spent_usd: "?" }] }), "x"), null);
  assert.deepEqual(ledgerRuns(JSON.stringify({ runs: [] }), "x"), []);
});

test("runs seen again replace what was kept; runs of removed worktrees stay", () => {
  const kept = ledgerRuns(ledger(entry("r1", 0.2), entry("r2", 0.1)), "feat-1-x");
  const seen = [
    ...ledgerRuns(ledger(entry("r2", 0.4)), "feat-1-x"),
    ...ledgerRuns(ledger(entry("r1", 0.3)), "feat-2-y"),
  ];
  const merged = mergeRuns(kept, seen);
  assert.deepEqual(
    merged.map((run) => [run.key, run.spentUsd]),
    [
      ["feat-1-x/r1", 0.2],
      ["feat-1-x/r2", 0.4],
      ["feat-2-y/r1", 0.3],
    ],
  );
});

// --- the spend of a phase --------------------------------------------------------

test("the spend of a phase counts only its own campaign, against its own ceiling", () => {
  const runs = [
    ...ledgerRuns(
      ledger(
        entry("r1", 0.9, { uncertain_usd: 0.1 }),
        entry("r2", 0.4),
        entry("r3", 1.2, { stage: "phase-pr" }),
        { run: "old", spent_usd: 12.5, uncertain_usd: 0.5 },
        entry("other", 2, { campaign: "08-mcp-public" }),
      ),
      "main",
    ),
  ];
  const spend = summary(runs);
  assert.equal(spend.campaign, PHASE);
  assert.equal(spend.ceilingUsd, 4);
  assert.equal(spend.issueStopUsd, 1.5);
  assert.equal(spend.runStopUsd, 1);
  assert.equal(spend.spentUsd, 2.5);
  assert.equal(spend.uncertainUsd, 0.1);
  assert.equal(spend.issueSpentUsd, 1.3);
  assert.equal(spend.remainingUsd, 1.5);
  assert.deepEqual(spend.unknown, []);
});

test("a run still under way projects its expected cost onto the spend", () => {
  const runs = ledgerRuns(
    ledger(
      entry("r1", 3.2),
      entry("r2", 0.3, { scope: "running", expected_usd: 1.1, provisional_usd: 0.2 }),
    ),
    "main",
  );
  const spend = summary(runs);
  assert.equal(spend.spentUsd, 3.5);
  assert.equal(spend.projectedUsd, 4.3);
  // A finished run projects nothing more.
  assert.equal(summary(ledgerRuns(ledger(entry("r1", 3.2)), "main")).projectedUsd, 3.2);
});

test("no ledger anywhere is unknown spend, never zero", () => {
  const spend = summary([], { found: 0 });
  assert.equal(spend.spentUsd, null);
  assert.equal(spend.uncertainUsd, null);
  assert.equal(spend.remainingUsd, null);
  assert.equal(spend.projectedUsd, null);
  assert.deepEqual(
    spend.unknown.map((reason) => reason.code),
    ["no-ledger"],
  );
  // A ledger that holds no run of this campaign is a known zero.
  assert.equal(summary([]).spentUsd, 0);
});

test("an unreadable ledger leaves the total incomplete and says which", () => {
  const spend = summary(ledgerRuns(ledger(entry("r1", 0.5)), "main"), {
    unreadable: ["feat-3-z"],
  });
  assert.equal(spend.spentUsd, 0.5);
  assert.deepEqual(
    spend.unknown.map((reason) => reason.code),
    ["unreadable-ledger"],
  );
  assert.match(spend.unknown[0].message, /feat-3-z/);
});

test("a phase without a campaign, or unreadable campaigns, has no ceiling to compare with", () => {
  const none = summarizeSpend({
    phase: "11-knowledge-graph",
    campaigns: CAMPAIGNS,
    runs: [],
    found: 1,
  });
  assert.equal(none.ceilingUsd, null);
  assert.equal(none.remainingUsd, null);
  assert.deepEqual(
    none.unknown.map((reason) => reason.code),
    ["no-campaign"],
  );
  const unread = summarizeSpend({ phase: PHASE, campaigns: null, runs: [], found: 1 });
  assert.equal(unread.ceilingUsd, null);
  assert.deepEqual(
    unread.unknown.map((reason) => reason.code),
    ["no-campaigns"],
  );
});

test("runs written since a moment are listed", () => {
  const runs = ledgerRuns(
    ledger(
      entry("early", 0.2, { at: "2026-11-21T08:00:00+00:00" }),
      entry("late", 0.3, { at: "2026-11-21T10:30:00+00:00", expected_usd: 0.25 }),
    ),
    "main",
  );
  const spend = summary(runs, { since: Date.parse("2026-11-21T10:00:00Z") });
  assert.deepEqual(
    spend.recent.map((run) => run.run),
    ["late"],
  );
});

// --- the spend line --------------------------------------------------------------

test("the spend line of an iteration states expected, actual and the remainder", () => {
  const before = summary(ledgerRuns(ledger(entry("r1", 0.5)), "main"));
  const after = summary(
    ledgerRuns(
      ledger(entry("r1", 0.5), entry("r2", 0.22, { uncertain_usd: 0.02, expected_usd: 0.3 })),
      "main",
    ),
  );
  const change = spendChange(before, after);
  assert.deepEqual(change, { paidRuns: 1, expectedUsd: 0.3, actualUsd: 0.22, uncertainUsd: 0.02 });
  assert.equal(
    spendLine(after, change),
    "spend: expected 0.3000 USD, actual 0.2200 USD (uncertain 0.0200) in 1 paid run; 3.2800 USD of the 07-ai-service ceiling (4.00 USD) remain",
  );
});

test("a run continued across the iteration counts only what it added", () => {
  const before = summary(ledgerRuns(ledger(entry("r1", 0.5, { scope: "running" })), "main"));
  const after = summary(ledgerRuns(ledger(entry("r1", 0.75, { expected_usd: 0.7 })), "main"));
  assert.deepEqual(spendChange(before, after), {
    paidRuns: 1,
    expectedUsd: 0.7,
    actualUsd: 0.25,
    uncertainUsd: 0,
  });
});

test("an iteration without a paid run still reports the remainder", () => {
  const same = summary(ledgerRuns(ledger(entry("r1", 0.5)), "main"));
  assert.equal(spendChange(same, same), null);
  assert.equal(
    spendLine(same, null),
    "spend: no paid eval run; 3.5000 USD of the 07-ai-service ceiling (4.00 USD) remain",
  );
});

test("a paid run without an expected cost says so", () => {
  const before = summary([]);
  const after = summary(ledgerRuns(ledger(entry("r1", 0.1)), "main"));
  assert.match(
    spendLine(after, spendChange(before, after)),
    /^spend: expected unknown, actual 0\.1000 USD/,
  );
});

test("unknown spend is reported as unknown", () => {
  const unknown = summary([], { found: 0 });
  assert.equal(
    spendLine(unknown, spendChange(unknown, unknown)),
    "spend: unknown (no eval ledger was found on this machine); the 07-ai-service ceiling is 4.00 USD",
  );
  const incomplete = summary(ledgerRuns(ledger(entry("r1", 0.5)), "main"), {
    unreadable: ["feat-3-z"],
  });
  assert.match(spendLine(incomplete, null), /at least 0\.5000 USD spent/);
  assert.match(spendLine(incomplete, null), /unknown: the eval ledger of feat-3-z cannot be read/);
  const none = summarizeSpend({
    phase: "11-knowledge-graph",
    campaigns: CAMPAIGNS,
    runs: [],
    found: 1,
  });
  assert.equal(
    spendLine(none, null),
    "spend: no eval campaign is defined for 11-knowledge-graph; the eval runner refuses a paid run",
  );
});
