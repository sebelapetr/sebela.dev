#!/usr/bin/env node
// What a phase works on next, read from GitHub's native structure (issue #420):
//
//   node harness/phase-work.mjs next <phase-folder> [--json]   the next issue of the phase, or
//                                                              why there is none
//   node harness/phase-work.mjs phases [--json]                the open phases and which may start
//   node harness/phase-work.mjs blockers [--json]              open issues whose `## Blocked by`
//                                                              text and native blockers disagree;
//                                                              exits 1 when any does
//
// The orchestrator, the phase loop, the steward and the phase report all ask here, so nothing
// selects by `phase:` label, by issue number or by reading an issue's text. Read-only: three
// GraphQL queries through `gh api graphql`, on what belongs to issues (body, labels, sub-issues,
// blockers). The token needs the `repo` scope and nothing else; no project is read.
// Rules: lib/selection.mjs, lib/blocked-by.mjs. Intent: docs/agents.md, "Work selection".

import { execFileSync } from "node:child_process";
import { blockerDisagreements, disagreementLines, textOnlyBlockers } from "./lib/blocked-by.mjs";
import {
  PhaseWorkError,
  assertComplete,
  phaseLines,
  phaseOrder,
  selectWork,
  trackingIssue,
  workLines,
} from "./lib/selection.mjs";

// --- GitHub ---------------------------------------------------------------------------------

const PAGE = 100;

// Labels and blockers of one issue. A list longer than a page is refused, never cut
// (assertComplete): an unseen blocker or label would change the selection silently.
const ISSUE_FACTS = `
  labels(first: ${PAGE}) { totalCount nodes { name } }
  blockedBy(first: ${PAGE}) { totalCount nodes { number state title } }`;

const OPEN_ISSUES = `query OpenIssues($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(first: ${PAGE}, after: $after, states: OPEN, orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes { number title body ${ISSUE_FACTS} }
    }
  }
}`;

const TRACKING_ISSUE = `query TrackingIssue($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number title state body
      blockedBy(first: ${PAGE}) { totalCount nodes { number state title } }
      subIssues(first: ${PAGE}, after: $after) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { number title state subIssues { totalCount } ${ISSUE_FACTS} }
      }
    }
  }
}`;

function issueStatesQuery(numbers) {
  const fields = numbers.map(
    (number) =>
      `n${number}: issueOrPullRequest(number: ${number}) { __typename ... on Issue { state } }`,
  );
  return `query IssueStates($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    ${fields.join("\n    ")}
  }
}`;
}

// The seam to GitHub: one GraphQL query → its `data`, or an error. `gh` fills in the repository
// of the current checkout (`{owner}`, `{repo}`); of `variables` it sends those the query declares.
export function ghGraphql(query, variables = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  args.push("-F", "owner={owner}", "-F", "name={repo}");
  for (const [key, value] of Object.entries(variables)) {
    if (value === null || value === undefined || !query.includes(`$${key}:`)) continue;
    args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
  }
  let out;
  try {
    out = execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const detail = String(error.stderr ?? "").trim() || error.message;
    throw new Error(`GitHub could not be asked (gh api graphql): ${detail}`, { cause: error });
  }
  let data;
  try {
    data = JSON.parse(out)?.data;
  } catch {
    data = null;
  }
  if (!data?.repository) throw new Error("GitHub could not be asked: gh api graphql gave no data");
  return data;
}

function issueFacts(node) {
  assertComplete(node.labels, `labels of #${node.number}`);
  assertComplete(node.blockedBy, `blockers of #${node.number}`);
  return {
    number: node.number,
    title: node.title,
    labels: node.labels.nodes.map((label) => label.name),
    blockedBy: node.blockedBy.nodes,
  };
}

// Every page of a connection: `read(after)` gives { pageInfo, nodes }.
function everyPage(read) {
  const nodes = [];
  let after = null;
  let connection;
  do {
    connection = read(after);
    nodes.push(...connection.nodes);
    after = connection.pageInfo?.endCursor ?? null;
  } while (connection.pageInfo?.hasNextPage && after !== null);
  return { nodes, last: connection };
}

// Every open issue with its text, labels and blockers.
function openIssues(graphql) {
  const { nodes } = everyPage((after) => graphql(OPEN_ISSUES, { after }).repository.issues);
  return nodes.map((node) => ({ ...issueFacts(node), body: node.body ?? "" }));
}

// A tracking issue with every sub-issue, in sub-issue order.
function trackingWithSubIssues(number, graphql) {
  let issue = null;
  const { nodes, last } = everyPage((after) => {
    issue = graphql(TRACKING_ISSUE, { number, after }).repository.issue;
    if (!issue) throw new PhaseWorkError(`issue #${number} does not exist`);
    return issue.subIssues;
  });
  assertComplete({ totalCount: last.totalCount, nodes }, `sub-issues of #${number}`);
  assertComplete(issue.blockedBy, `blockers of #${number}`);
  return {
    number: issue.number,
    title: issue.title,
    blockedBy: issue.blockedBy.nodes,
    subIssues: nodes.map((node) => ({
      ...issueFacts(node),
      state: node.state,
      subIssues: node.subIssues.totalCount,
    })),
  };
}

// --- what callers ask -----------------------------------------------------------------------

// The selection for a phase folder (selectWork in lib/selection.mjs). Throws PhaseWorkError when
// the structure cannot answer (no or several tracking issues, a list cut short) and a plain
// Error when GitHub cannot be asked. Nothing is kept between calls.
export function phaseWork(phase, { graphql = ghGraphql } = {}) {
  const tracking = trackingIssue(phase, openIssues(graphql));
  return selectWork({ phase, tracking: trackingWithSubIssues(tracking.number, graphql) });
}

// The same for callers that go on without GitHub (the loop's progress, the steward): null when
// GitHub cannot be asked. A structure that cannot answer is still thrown.
export function phaseWorkOrNull(phase, options) {
  try {
    return phaseWork(phase, options);
  } catch (error) {
    if (error instanceof PhaseWorkError) throw error;
    return null;
  }
}

// The open phases and which may start (phaseOrder in lib/selection.mjs).
export function phases({ graphql = ghGraphql } = {}) {
  return phaseOrder(openIssues(graphql));
}

// The open issues whose `## Blocked by` text and native blockers disagree
// (blockerDisagreements in lib/blocked-by.mjs).
export function blockerCheck({ graphql = ghGraphql } = {}) {
  const issues = openIssues(graphql);
  const numbers = textOnlyBlockers(issues);
  const states = new Map();
  for (let at = 0; at < numbers.length; at += PAGE) {
    const some = numbers.slice(at, at + PAGE);
    const { repository } = graphql(issueStatesQuery(some), { numbers: some });
    for (const number of some) states.set(number, repository[`n${number}`]?.state ?? null);
  }
  return blockerDisagreements(issues, states);
}

// --- the command ----------------------------------------------------------------------------

const USAGE = `usage: phase-work.mjs next <phase-folder> [--json]
       phase-work.mjs phases [--json]
       phase-work.mjs blockers [--json]`;

function main(argv) {
  const json = argv.includes("--json");
  const [command, phase] = argv.filter((arg) => !arg.startsWith("--"));
  const print = (value, lines) =>
    console.log(json ? JSON.stringify(value, null, 2) : lines.join("\n"));
  if (command === "next" && phase) {
    const work = phaseWork(phase);
    print(work, workLines(work));
    return 0;
  }
  if (command === "phases") {
    const found = phases();
    print(found, found.length > 0 ? phaseLines(found) : ["no open tracking issue names a plan"]);
    return 0;
  }
  if (command === "blockers") {
    const found = blockerCheck();
    print(
      found,
      found.length > 0
        ? disagreementLines(found)
        : ["every open issue's `## Blocked by` text and native blockers agree"],
    );
    return found.length > 0 ? 1 : 0;
  }
  console.error(USAGE);
  return 64;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
