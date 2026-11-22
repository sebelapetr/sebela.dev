// The GitHub side of the work selection (issue #420), without the network: the gateway against a
// stand-in for the GraphQL call, and the command as an agent runs it, with a stand-in for `gh`
// on the PATH that answers from fixtures. Rules: lib/selection.test.mjs, lib/blocked-by.test.mjs.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PhaseWorkError } from "./lib/selection.mjs";
import { assigneeCheck, blockerCheck, phaseWork, phaseWorkOrNull, phases } from "./phase-work.mjs";

const COMMAND = path.join(import.meta.dirname, "phase-work.mjs");
const READY = "ready-for-agent";
const REPOSITORY = "example/site";

// --- fixtures: what GitHub answers ------------------------------------------------

const connection = (nodes, extra = {}) => ({ totalCount: nodes.length, nodes, ...extra });
const labels = (...names) => connection(names.map((name) => ({ name })));
const link = (number, state = "OPEN") => ({ number, state, title: `Issue ${number}` });
const subIssue = (
  number,
  { state = "OPEN", names = [READY, "afk"], blockedBy = [], children = 0 } = {},
) => ({
  number,
  title: `Issue ${number}`,
  state,
  labels: labels(...names),
  subIssues: { totalCount: children },
  blockedBy: connection(blockedBy),
  repository: { nameWithOwner: REPOSITORY },
});
const openIssue = (
  number,
  body,
  { blockedBy = [], names = [], author = "OWNER", assignees = [] } = {},
) => ({
  assignees: connection(assignees.map((login) => ({ login }))),
  number,
  title: `Issue ${number}`,
  body,
  authorAssociation: author,
  labels: labels(...names),
  blockedBy: connection(blockedBy),
});
const page = (nodes, endCursor = null) => ({
  totalCount: nodes.length,
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
  nodes,
});

// A stand-in for the GraphQL call: `open` are pages of open issues, `tracking` maps an issue
// number to pages of its sub-issues, `states` an issue number to its state.
function github({ open = [[]], tracking = {}, states = {} } = {}) {
  const calls = [];
  const graphql = (query, variables) => {
    const operation = /query (\w+)/.exec(query)[1];
    calls.push({ operation, variables });
    const at = variables.after ? Number(variables.after) : 0;
    if (operation === "OpenIssues") {
      const issues = page(open[at], at + 1 < open.length ? String(at + 1) : null);
      return { repository: { issues } };
    }
    if (operation === "TrackingIssue") {
      const found = tracking[variables.number];
      const pages = found.pages;
      const subIssues = page(pages[at] ?? [], at + 1 < pages.length ? String(at + 1) : null);
      subIssues.totalCount = pages.flat().length;
      return {
        repository: {
          issue: {
            number: variables.number,
            title: found.title ?? `Phase ${variables.number}`,
            state: "OPEN",
            body: found.body ?? "",
            repository: { nameWithOwner: REPOSITORY },
            blockedBy: connection(found.blockedBy ?? []),
            subIssues,
          },
        },
      };
    }
    if (operation === "IssueStates") {
      const repository = {};
      for (const number of variables.numbers) {
        repository[`n${number}`] =
          number in states ? { __typename: "Issue", state: states[number] } : null;
      }
      return { repository };
    }
    throw new Error(`unexpected query ${operation}`);
  };
  return { graphql, calls };
}

const PLAN_07 = "Tracking issue.\n\nPlan: .plan/07-ai-service\n";
const PLAN_08 = "Plan: .plan/08-mcp-public";

// --- the gateway --------------------------------------------------------------------

test("a phase runs from its tracking issue alone: no phase label, no text section", () => {
  const { graphql, calls } = github({
    open: [[openIssue(210, "no section"), openIssue(414, PLAN_07)]],
    tracking: {
      414: {
        pages: [
          [
            subIssue(302, { state: "CLOSED" }),
            subIssue(210, { blockedBy: [link(302, "CLOSED")] }),
            subIssue(211, { blockedBy: [link(210)] }),
            subIssue(216, { names: [READY, "hitl"], blockedBy: [link(211)] }),
          ],
        ],
      },
    },
  });
  const work = phaseWork("07-ai-service", { graphql });
  assert.equal(work.status, "next");
  assert.deepEqual(work.next, { number: 210, title: "Issue 210" });
  assert.deepEqual(work.progress, { closed: 1, total: 4 });
  assert.equal(work.tracking.number, 414);
  assert.deepEqual(
    calls.map((call) => call.operation),
    ["OpenIssues", "TrackingIssue"],
  );
});

test("more than a hundred sub-issues are read page by page, in order", () => {
  const first = Array.from({ length: 100 }, (_, i) => subIssue(1000 + i, { state: "CLOSED" }));
  const second = [subIssue(2000, { names: [READY, "hitl"] }), subIssue(2001), subIssue(2002)];
  const { graphql, calls } = github({
    open: [[openIssue(414, PLAN_07)]],
    tracking: { 414: { pages: [first, second] } },
  });
  const work = phaseWork("07-ai-service", { graphql });
  assert.equal(work.next.number, 2001);
  assert.deepEqual(work.progress, { closed: 100, total: 103 });
  assert.equal(calls.filter((call) => call.operation === "TrackingIssue").length, 2);
});

test("a sub-issue list that does not add up to its total is refused", () => {
  const { graphql } = github({
    open: [[openIssue(414, PLAN_07)]],
    tracking: { 414: { pages: [[subIssue(1)]] } },
  });
  const short = (query, variables) => {
    const data = graphql(query, variables);
    if (data.repository.issue) data.repository.issue.subIssues.totalCount = 5;
    return data;
  };
  assert.throws(() => phaseWork("07-ai-service", { graphql: short }), PhaseWorkError);
});

test("blockers or labels GitHub returned only in part are refused loudly", () => {
  const cut = subIssue(216);
  cut.blockedBy = {
    totalCount: 101,
    nodes: Array.from({ length: 100 }, (_, i) => link(i + 1, "CLOSED")),
  };
  const { graphql } = github({
    open: [[openIssue(414, PLAN_07)]],
    tracking: { 414: { pages: [[cut]] } },
  });
  assert.throws(
    () => phaseWork("07-ai-service", { graphql }),
    (error) => error instanceof PhaseWorkError && /blockers of #216/.test(error.message),
  );
});

test("the tracking issue is found on a later page of open issues", () => {
  const { graphql } = github({
    open: [[openIssue(1, "x"), openIssue(2, "y")], [openIssue(414, PLAN_07)]],
    tracking: { 414: { pages: [[subIssue(210)]] } },
  });
  assert.equal(phaseWork("07-ai-service", { graphql }).next.number, 210);
});

test("a folder no open issue names is refused, and so is one named twice", () => {
  const none = github({ open: [[openIssue(414, PLAN_07)]] });
  assert.throws(
    () => phaseWork("08-mcp-public", { graphql: none.graphql }),
    (error) => error instanceof PhaseWorkError && /no open tracking issue/i.test(error.message),
  );
  const two = github({ open: [[openIssue(414, PLAN_07), openIssue(500, PLAN_07)]] });
  assert.throws(
    () => phaseWork("07-ai-service", { graphql: two.graphql }),
    (error) => error instanceof PhaseWorkError && /#414.*#500/.test(error.message),
  );
});

test("a phase without issues is empty and waits for the phase it is linked to", () => {
  const { graphql } = github({
    open: [[openIssue(414, PLAN_07), openIssue(418, PLAN_08, { blockedBy: [link(414)] })]],
    tracking: { 418: { pages: [[]], blockedBy: [link(414)] } },
  });
  const work = phaseWork("08-mcp-public", { graphql });
  assert.equal(work.status, "phase-waits");
  assert.deepEqual(work.progress, { closed: 0, total: 0 });
  assert.deepEqual(
    work.phaseBlockers.map((issue) => [issue.number, issue.folder]),
    [[414, "07-ai-service"]],
  );
});

test("the quiet form gives null when GitHub cannot be asked and still refuses a broken structure", () => {
  const down = () => {
    throw new Error("network");
  };
  assert.equal(phaseWorkOrNull("07-ai-service", { graphql: down }), null);
  const none = github({ open: [[]] });
  assert.throws(() => phaseWorkOrNull("07-ai-service", { graphql: none.graphql }), PhaseWorkError);
});

test("the phases and which of them may start come from the tracking issues", () => {
  const { graphql } = github({
    open: [
      [
        openIssue(210, "## Blocked by\n\n- #302"),
        openIssue(414, PLAN_07),
        openIssue(418, PLAN_08, { blockedBy: [link(414)] }),
      ],
    ],
  });
  assert.deepEqual(
    phases({ graphql }).map((phase) => [phase.folder, phase.mayStart]),
    [
      ["07-ai-service", true],
      ["08-mcp-public", false],
    ],
  );
});

test("the blocker check asks for the state of what only the text names", () => {
  const { graphql, calls } = github({
    open: [
      [
        openIssue(210, "## Blocked by\n\n- #183\n- #302", { blockedBy: [link(302, "CLOSED")] }),
        openIssue(216, "## Blocked by\n\n- #215", { blockedBy: [link(215), link(393)] }),
        openIssue(404, "## Blocked by\n\n- #345"),
      ],
    ],
    states: { 183: "CLOSED", 345: "OPEN" },
  });
  const found = blockerCheck({ graphql });
  assert.deepEqual(
    found.map((entry) => [entry.number, entry.missingInText, entry.missingNatively]),
    [
      [216, [393], []],
      [404, [], [345]],
    ],
  );
  assert.deepEqual(calls.at(-1).variables.numbers, [183, 345]);
});

// --- review of pull request #423 ---------------------------------------------------------

test("an outsider's issue that names the folder is ignored and reported", () => {
  const { graphql } = github({
    open: [[openIssue(414, PLAN_07), openIssue(900, PLAN_07, { author: "NONE" })]],
    tracking: { 414: { pages: [[subIssue(210)]] } },
  });
  const work = phaseWork("07-ai-service", { graphql });
  assert.equal(work.tracking.number, 414);
  assert.equal(work.next.number, 210);
  assert.deepEqual(
    work.ignored.map((issue) => issue.number),
    [900],
  );
});

test("an outsider cannot make or halt a phase with a plan line", () => {
  const { graphql } = github({ open: [[openIssue(900, PLAN_08, { author: "CONTRIBUTOR" })]] });
  assert.throws(
    () => phaseWork("08-mcp-public", { graphql }),
    (error) => error instanceof PhaseWorkError && /#900.*ignored/.test(error.message),
  );
  assert.deepEqual(phases({ graphql }), []);
});

test("a sub-issue that lives in another repository is refused", () => {
  const foreign = subIssue(7);
  foreign.repository = { nameWithOwner: "someone/else" };
  const { graphql } = github({
    open: [[openIssue(414, PLAN_07)]],
    tracking: { 414: { pages: [[subIssue(210), foreign]] } },
  });
  assert.throws(
    () => phaseWork("07-ai-service", { graphql }),
    (error) => error instanceof PhaseWorkError && /#7.*someone\/else/.test(error.message),
  );
});

test("another phase's empty tracking issue, nested and labelled by mistake, is never the next issue", () => {
  const { graphql } = github({
    open: [[openIssue(414, PLAN_07), openIssue(418, PLAN_08)]],
    tracking: { 414: { pages: [[subIssue(418), subIssue(210)]] } },
  });
  const work = phaseWork("07-ai-service", { graphql });
  assert.equal(work.next.number, 210);
  assert.equal(work.open[0].kind, "parent");
});

test("a tracking issue without a plan line is an epic: the loop's folder never resolves to it", () => {
  const { graphql, calls } = github({
    open: [[openIssue(500, "Tracking issue of the audit fixes."), openIssue(414, PLAN_07)]],
  });
  assert.throws(() => phaseWork("audit-fixes", { graphql }), PhaseWorkError);
  assert.ok(!calls.some((call) => call.operation === "TrackingIssue"));
  assert.deepEqual(
    phases({ graphql }).map((phase) => phase.number),
    [414],
  );
});

test("phases that block each other are a cycle, named when either is asked for", () => {
  const { graphql } = github({
    open: [
      [
        openIssue(414, PLAN_07, { blockedBy: [link(418)] }),
        openIssue(418, PLAN_08, { blockedBy: [link(414)] }),
      ],
    ],
    tracking: { 414: { pages: [[subIssue(210)]], blockedBy: [link(418)] } },
  });
  const work = phaseWork("07-ai-service", { graphql });
  assert.equal(work.status, "phase-waits");
  assert.deepEqual(work.phaseCycle, [414, 418]);
  assert.deepEqual(phases({ graphql })[1].cycle, [418, 414]);
});

// --- the command, with a stand-in for gh ----------------------------------------------

const dirs = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

// gh: answers `api graphql` from answers.json by the query's name and records every call.
const GH = `#!${process.execPath}
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const dir = process.env.STUB_DIR;
fs.appendFileSync(path.join(dir, "gh-calls.jsonl"), JSON.stringify(args) + "\\n");
const query = args.find((arg) => arg.startsWith("query="));
const answers = JSON.parse(fs.readFileSync(path.join(dir, "answers.json"), "utf8"));
const operation = /query (\\w+)/.exec(query ?? "")?.[1];
if (!answers[operation]) process.exit(1);
console.log(JSON.stringify({ data: answers[operation] }));
`;

function command(answers, args, script = () => COMMAND) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-phase-work-"));
  dirs.push(dir);
  const stubs = path.join(dir, "stubs");
  fs.mkdirSync(stubs);
  fs.writeFileSync(path.join(stubs, "gh"), GH, { mode: 0o755 });
  fs.writeFileSync(path.join(stubs, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(dir, "answers.json"), JSON.stringify(answers));
  const run = spawnSync(process.execPath, [script(dir), ...args], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      PATH: `${stubs}:${path.dirname(process.execPath)}:${process.env.PATH}`,
      STUB_DIR: dir,
    },
  });
  const calls = fs.existsSync(path.join(dir, "gh-calls.jsonl"))
    ? fs
        .readFileSync(path.join(dir, "gh-calls.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  return { ...run, calls };
}

const ANSWERS = {
  OpenIssues: {
    repository: {
      issues: page([
        openIssue(414, PLAN_07),
        openIssue(418, PLAN_08, { blockedBy: [link(414)] }),
        openIssue(216, "## Blocked by\n\n- #215", { blockedBy: [link(215), link(393)] }),
      ]),
    },
  },
  TrackingIssue: {
    repository: {
      issue: {
        number: 414,
        title: "Phase 07 · AI service",
        state: "OPEN",
        body: PLAN_07,
        repository: { nameWithOwner: REPOSITORY },
        blockedBy: connection([]),
        subIssues: page([
          subIssue(302, { state: "CLOSED" }),
          subIssue(210, { blockedBy: [link(302, "CLOSED")] }),
          subIssue(216, { names: [READY, "hitl"], blockedBy: [link(215), link(393)] }),
        ]),
      },
    },
  },
};

test("`next` prints the issue to take and reads GitHub only through GraphQL queries", () => {
  const run = command(ANSWERS, ["next", "07-ai-service"]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /phase 07-ai-service · tracking issue #414/);
  assert.match(run.stdout, /^status: next$/m);
  assert.match(run.stdout, /^next: #210 Issue 210$/m);
  assert.match(run.stdout, /waiting for a human \(hitl\): #216 \(blocked by #215, #393\)/);
  assert.ok(run.calls.length > 0);
  for (const call of run.calls) {
    assert.deepEqual(call.slice(0, 2), ["api", "graphql"]);
    const query = call.find((arg) => arg.startsWith("query="));
    assert.doesNotMatch(query, /mutation|projectItems|projectsV2|phase:/);
  }
});

test("`next --json` prints the selection for a program", () => {
  const run = command(ANSWERS, ["next", "07-ai-service", "--json"]);
  assert.equal(run.status, 0, run.stderr);
  const work = JSON.parse(run.stdout);
  assert.equal(work.status, "next");
  assert.equal(work.next.number, 210);
  assert.equal(work.tracking.number, 414);
});

test("`next` for a folder without a tracking issue fails with what to do", () => {
  const run = command(ANSWERS, ["next", "09.2-rag-upgrades"]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /no open tracking issue/i);
  assert.match(run.stderr, /Plan: \.plan\/09\.2-rag-upgrades/);
  assert.equal(run.stdout, "");
});

test("`phases` lists the phases and what each waits for", () => {
  const run = command(ANSWERS, ["phases"]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /07-ai-service · #414 · may start/);
  assert.match(run.stdout, /08-mcp-public · #418 · waits for #414 \(07-ai-service\)/);
});

test("`blockers` fails while a text section and the native links disagree", () => {
  const run = command(ANSWERS, ["blockers"]);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /#216.*text does not name #393/);
  const agreed = structuredClone(ANSWERS);
  agreed.OpenIssues.repository.issues.nodes[2].body = "## Blocked by\n\n- #215\n- #393";
  const clean = command(agreed, ["blockers"]);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /agree/);
});

test("GitHub not answering is an error, never an empty phase", () => {
  const run = command({}, ["next", "07-ai-service"]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /GitHub/);
});

test("without a command or a folder it prints the usage", () => {
  assert.equal(command(ANSWERS, []).status, 64);
  assert.equal(command(ANSWERS, ["next"]).status, 64);
});

// --- review of pull request #423: the command ----------------------------------------------

const withAnswers = (change) => {
  const answers = structuredClone(ANSWERS);
  change(answers);
  return answers;
};

test("`next` says the status in a line of its own, whatever it is", () => {
  const waiting = withAnswers((answers) => {
    const { subIssues } = answers.TrackingIssue.repository.issue;
    answers.TrackingIssue.repository.issue.subIssues = page(
      subIssues.nodes.filter((issue) => issue.number !== 210),
    );
  });
  assert.match(command(waiting, ["next", "07-ai-service"]).stdout, /^status: waiting$/m);
  const finished = withAnswers((answers) => {
    answers.TrackingIssue.repository.issue.subIssues = page([subIssue(302, { state: "CLOSED" })]);
  });
  assert.match(command(finished, ["next", "07-ai-service"]).stdout, /^status: finished$/m);
  const empty = withAnswers((answers) => {
    answers.TrackingIssue.repository.issue.subIssues = page([]);
  });
  assert.match(command(empty, ["next", "07-ai-service"]).stdout, /^status: empty$/m);
  const blocked = withAnswers((answers) => {
    answers.TrackingIssue.repository.issue.blockedBy = connection([link(418)]);
  });
  const run = command(blocked, ["next", "07-ai-service"]);
  assert.match(run.stdout, /^status: phase-waits$/m);
  assert.match(run.stdout, /the phase waits for #418 \(08-mcp-public\)/);
  assert.doesNotMatch(run.stdout, /^next:/m);
});

test("the command answers when it is started through a link or from a folder with a space", () => {
  const linked = (dir) => {
    const folder = path.join(dir, "a folder");
    fs.mkdirSync(folder);
    const link = path.join(folder, "phase work.mjs");
    fs.symlinkSync(COMMAND, link);
    return link;
  };
  const run = command(ANSWERS, ["next", "07-ai-service"], linked);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^status: next$/m);
  assert.match(run.stdout, /^next: #210 Issue 210$/m);
});

test("`next` reports an outsider's issue that names the folder as ignored", () => {
  const answers = withAnswers((data) => {
    data.OpenIssues.repository.issues.nodes.push(openIssue(900, PLAN_07, { author: "NONE" }));
  });
  const run = command(answers, ["next", "07-ai-service"]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^next: #210 Issue 210$/m);
  assert.match(run.stdout, /^ignored: #900 /m);
});

test("`phases` names a cycle and the issues it ignored", () => {
  const answers = withAnswers((data) => {
    const nodes = data.OpenIssues.repository.issues.nodes;
    nodes[0].blockedBy = connection([link(418)]);
    nodes.push(openIssue(900, "Plan: .plan/99-outsider", { author: "NONE" }));
  });
  const run = command(answers, ["phases"]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(
    run.stdout,
    /07-ai-service · #414 · waits for #418 \(08-mcp-public\) · cycle: #414 → #418 → #414/,
  );
  assert.match(run.stdout, /^ignored: #900 /m);
  assert.doesNotMatch(run.stdout, /99-outsider ·/);
});

// --- assignees against the hitl label (the owner's decision of 2026-11-22) -------------------

const ASSIGNED = {
  OpenIssues: {
    repository: {
      issues: page([
        openIssue(216, "x", { names: [READY, "hitl"], assignees: ["owner"] }),
        openIssue(189, "x", { names: ["hitl"] }),
        openIssue(210, "x", { names: [READY, "afk"], assignees: ["owner"] }),
        openIssue(211, "x", { names: [READY, "afk"] }),
      ]),
    },
  },
};

test("the assignee check reports open issues where `hitl` and an assignee disagree", () => {
  const { graphql } = github({ open: [ASSIGNED.OpenIssues.repository.issues.nodes] });
  assert.deepEqual(
    assigneeCheck({ graphql }).map((entry) => [entry.number, entry.hitl, entry.assignees]),
    [
      [189, true, []],
      [210, false, ["owner"]],
    ],
  );
});

test("`assignees` prints the report and fails while there is a disagreement", () => {
  const run = command(ASSIGNED, ["assignees"]);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /#189 .*labelled `hitl` but has no assignee/);
  assert.match(run.stdout, /#210 .*assigned to owner but not labelled `hitl`/);
  const agreed = structuredClone(ASSIGNED);
  agreed.OpenIssues.repository.issues.nodes.splice(1, 2);
  const clean = command(agreed, ["assignees"]);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /agree/);
});

test("the selection is the same whoever an issue is assigned to", () => {
  const withAssignee = structuredClone(ANSWERS);
  for (const issue of withAssignee.OpenIssues.repository.issues.nodes) {
    issue.assignees = connection([{ login: "someone" }]);
  }
  assert.equal(
    command(withAssignee, ["next", "07-ai-service"]).stdout,
    command(ANSWERS, ["next", "07-ai-service"]).stdout,
  );
});
