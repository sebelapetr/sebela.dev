// What a phase's paid model evals have spent, read from the eval runner's ledgers and compared
// with the phase campaign's ceiling. Pure — the caller reads the files (harness/steward.mjs).
//
// The ceilings are the eval runner's own: `packages/llm-agent/evals/campaigns.json`, which
// `evals/budget.py` enforces on every paid run (docs/decisions/0026, point 7). A campaign is named
// after its phase folder, so the loop's phase names its campaign. The ledger is
// `.tmp/evals/llm-agent/ledger.json` of every checkout; a worktree's ledger goes when the worktree
// is removed, so the caller keeps the runs it has seen (`mergeRuns`).
//
// What cannot be read is unknown and says so; it is never counted as zero.

// The campaign of ledger entries written before campaigns were named (`budget.LEGACY_CAMPAIGN`).
export const LEGACY_CAMPAIGN = "06-llm-agent";

// How long a paid run can be under way at most: the runner's 150-minute deadline plus one chunk,
// the 240 minutes its CI step is bounded at (packages/llm-agent/AGENTS.md, Evals, CI). A ledger
// entry still marked `running` after that was interrupted; it is no longer projected.
export const RUN_DEADLINE_MINUTES = 240;

const amount = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const round = (value) => Math.round(value * 1e6) / 1e6;
const usd = (value) => `${value.toFixed(4)} USD`;

// `campaigns.json` → { <name>: { ceilingUsd, issueStopUsd, runStopUsd } }, or null when the text
// is not the expected file.
export function parseCampaigns(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const campaigns = {};
  for (const [name, entry] of Object.entries(data)) {
    const ceilingUsd = amount(entry?.ceiling_usd);
    if (ceilingUsd === null) return null;
    campaigns[name] = {
      ceilingUsd,
      issueStopUsd: amount(entry.issue_stop_usd),
      runStopUsd: amount(entry.run_stop_usd),
    };
  }
  return campaigns;
}

// One ledger file's text → its runs, each named after `source` (the checkout it was read from);
// null when the ledger cannot be read as one.
export function ledgerRuns(text, source) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data?.runs)) return null;
  const runs = [];
  for (const entry of data.runs) {
    const spentUsd = amount(entry?.spent_usd);
    if (spentUsd === null || typeof entry.run !== "string") return null;
    runs.push({
      key: `${source}/${entry.run}`,
      source,
      run: entry.run,
      at: typeof entry.at === "string" ? entry.at : null,
      campaign: entry.campaign || LEGACY_CAMPAIGN,
      stage: entry.stage ?? null,
      scope: entry.scope ?? null,
      spentUsd,
      uncertainUsd: amount(entry.uncertain_usd) ?? 0,
      expectedUsd: amount(entry.expected_usd),
      running: entry.scope === "running",
    });
  }
  return runs;
}

// The runs kept from earlier checks with the runs seen now: a run seen again is replaced by what
// its ledger says now, a run whose worktree is gone stays as it was last seen.
export function mergeRuns(kept, seen) {
  const byKey = new Map();
  for (const run of [...(kept ?? []), ...(seen ?? [])]) byKey.set(run.key, run);
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const reason = (code, message) => ({ code, message });

// The spend of the campaign of `phase`:
//   campaigns   from parseCampaigns, null when the file could not be read
//   runs        every known run (mergeRuns), of any campaign
//   found       how many ledgers and kept records were read; 0 means nothing says what was spent
//   unreadable  the checkouts whose ledger exists but cannot be read
//   since       list the runs written at or after this time (ms): this campaign's under
//               `recent`, every other campaign's under `foreign`
//   now         the time (ms) against which a `running` entry counts as interrupted; without
//               it every running entry is projected
// Amounts are null when unknown; `unknown` says why ({ code, message }).
export function summarizeSpend({
  phase,
  campaigns,
  runs,
  found,
  unreadable = [],
  since = null,
  now = null,
}) {
  const campaign = campaigns?.[phase] ?? null;
  const unknown = [];
  if (campaigns === null) {
    unknown.push(reason("no-campaigns", "the eval campaigns and their ceilings cannot be read"));
  } else if (campaign === null) {
    unknown.push(reason("no-campaign", `no eval campaign is defined for ${phase}`));
  }
  for (const source of unreadable) {
    unknown.push(reason("unreadable-ledger", `the eval ledger of ${source} cannot be read`));
  }
  const own = (runs ?? []).filter((run) => run.campaign === phase);
  const nothingKnown = own.length === 0 && found === 0;
  if (nothingKnown) {
    unknown.push(reason("no-ledger", "no eval ledger was found on this machine"));
  }
  const sum = (list, field) => round(list.reduce((total, run) => total + run[field], 0));
  const spentUsd = nothingKnown ? null : sum(own, "spentUsd");
  const ceilingUsd = campaign?.ceilingUsd ?? null;
  const writtenAt = (run) => Date.parse(run.at ?? "");
  // A run still under way is expected to cost what it said before it started — unless its
  // entry is older than any run can last, which is what an interrupted run leaves behind.
  const underWay = (run) =>
    run.running &&
    run.expectedUsd !== null &&
    (now === null || now - writtenAt(run) <= RUN_DEADLINE_MINUTES * 60_000);
  const stillExpected = (list) =>
    list
      .filter(underWay)
      .reduce((total, run) => total + Math.max(0, run.expectedUsd - run.spentUsd), 0);
  const issueRuns = own.filter((run) => run.stage === "issue");
  const listed = ({
    source,
    run,
    at,
    campaign: of,
    stage,
    scope,
    spentUsd: spent,
    uncertainUsd,
    expectedUsd,
  }) => ({
    source,
    run,
    at,
    campaign: of,
    stage,
    scope,
    spentUsd: spent,
    uncertainUsd,
    expectedUsd,
  });
  const sinceThen = (run) =>
    since !== null && Number.isFinite(writtenAt(run)) && writtenAt(run) >= since;
  return {
    campaign: phase,
    ceilingUsd,
    issueStopUsd: campaign?.issueStopUsd ?? null,
    runStopUsd: campaign?.runStopUsd ?? null,
    spentUsd,
    uncertainUsd: nothingKnown ? null : sum(own, "uncertainUsd"),
    issueSpentUsd: nothingKnown ? null : sum(issueRuns, "spentUsd"),
    issueProjectedUsd: nothingKnown
      ? null
      : round(sum(issueRuns, "spentUsd") + stillExpected(issueRuns)),
    remainingUsd:
      spentUsd === null || ceilingUsd === null ? null : round(Math.max(0, ceilingUsd - spentUsd)),
    projectedUsd: spentUsd === null ? null : round(spentUsd + stillExpected(own)),
    runs: own.map(({ key, spentUsd: spent, uncertainUsd, expectedUsd }) => ({
      key,
      spentUsd: spent,
      uncertainUsd,
      expectedUsd,
    })),
    recent: own.filter(sinceThen).map(listed),
    // Paid runs of other campaigns written since then, in any checkout: another loop's or the
    // owner's, unless they are in the worktree this loop works in (lib/steward.mjs, hardStops).
    foreign: (runs ?? []).filter((run) => run.campaign !== phase && sinceThen(run)).map(listed),
    unknown,
  };
}

// What the paid runs between two summaries cost: the runs that are new or grew, with what they
// expected and what they added. Null when no run changed or the spend is unknown.
export function spendChange(before, after) {
  if (!before || !after || after.spentUsd === null) return null;
  const earlier = new Map((before.runs ?? []).map((run) => [run.key, run]));
  const changed = after.runs.filter((run) => {
    const was = earlier.get(run.key);
    return !was || run.spentUsd !== was.spentUsd || run.uncertainUsd !== was.uncertainUsd;
  });
  if (changed.length === 0) return null;
  const added = (field) =>
    round(
      changed.reduce((total, run) => total + run[field] - (earlier.get(run.key)?.[field] ?? 0), 0),
    );
  return {
    paidRuns: changed.length,
    expectedUsd: changed.every((run) => run.expectedUsd !== null)
      ? round(changed.reduce((total, run) => total + run.expectedUsd, 0))
      : null,
    actualUsd: added("spentUsd"),
    uncertainUsd: added("uncertainUsd"),
  };
}

// The spend line of a loop report or issue comment: expected before, actual after, the remainder
// of the phase ceiling. `change` is spendChange's result for the reported stretch of work.
export function spendLine(summary, change) {
  const { campaign, ceilingUsd, spentUsd, remainingUsd } = summary;
  const incomplete = summary.unknown.filter((item) => item.code === "unreadable-ledger");
  if (ceilingUsd === null) {
    const why = summary.unknown.find((item) => item.code.startsWith("no-campaign"));
    return summary.unknown.some((item) => item.code === "no-campaign")
      ? `spend: ${why.message}; the eval runner refuses a paid run`
      : `spend: unknown (${why?.message ?? "no ceiling"})`;
  }
  const ceiling = `the ${campaign} ceiling (${ceilingUsd.toFixed(2)} USD)`;
  if (spentUsd === null) {
    const why = summary.unknown.map((item) => item.message).join("; ");
    return `spend: unknown (${why}); the ${campaign} ceiling is ${ceilingUsd.toFixed(2)} USD`;
  }
  const what = change
    ? `expected ${change.expectedUsd === null ? "unknown" : usd(change.expectedUsd)}, actual ${usd(change.actualUsd)} (uncertain ${change.uncertainUsd.toFixed(4)}) in ${change.paidRuns} paid run${change.paidRuns === 1 ? "" : "s"}`
    : "no paid eval run";
  if (incomplete.length > 0) {
    return `spend: ${what}; at least ${usd(spentUsd)} spent of ${ceiling}; unknown: ${incomplete.map((item) => item.message).join("; ")}`;
  }
  return `spend: ${what}; ${usd(remainingUsd)} of ${ceiling} remain`;
}
