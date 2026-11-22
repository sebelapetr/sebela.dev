import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PhaseWorkError,
  assertComplete,
  phaseLines,
  phaseOrder,
  planFolder,
  untrustedPlanIssues,
  planLine,
  selectWork,
  trackingIssue,
  workLines,
} from "./selection.mjs";

// --- fixtures ---------------------------------------------------------------

const READY = "ready-for-agent";
const blocker = (number, state = "OPEN") => ({ number, state, title: `Issue ${number}` });
const sub = (
  number,
  { labels = [READY, "afk"], state = "OPEN", blockedBy = [], subIssues = 0 } = {},
) => ({
  number,
  title: `Issue ${number}`,
  state,
  labels,
  blockedBy,
  subIssues,
});
const tracking = (subIssues, { blockedBy = [], number = 414 } = {}) => ({
  number,
  title: "Phase 07 · AI service",
  state: "OPEN",
  body: `Tracking issue.\n\n${planLine("07-ai-service")}\n`,
  blockedBy,
  subIssues,
});
const select = (subIssues, options) =>
  selectWork({ phase: "07-ai-service", tracking: tracking(subIssues, options) });

// --- the plan line ----------------------------------------------------------

test("a tracking issue names its plan folder in one line", () => {
  assert.equal(planLine("07-ai-service"), "Plan: .plan/07-ai-service");
  assert.equal(planFolder("Intro\n\nPlan: .plan/07-ai-service\n\nMore"), "07-ai-service");
  assert.equal(planFolder("Plan: .plan/07.1-jev-gateway/"), "07.1-jev-gateway");
  assert.equal(planFolder("Plan: `.plan/15-pages`\r\n"), "15-pages");
});

test("an archived plan still names the same phase folder", () => {
  assert.equal(planFolder("Plan: .plan/done/06-llm-agent"), "06-llm-agent");
});

test("prose that only mentions a plan folder is not the plan line", () => {
  assert.equal(planFolder("- PRD: [`.plan/07-ai-service/prd.md`](https://example.test)"), null);
  assert.equal(planFolder("See Plan: .plan/07-ai-service for details"), null);
  assert.equal(planFolder("Plan: .plan/07-ai-service/prd.md"), null);
  assert.equal(planFolder(""), null);
  assert.equal(planFolder(null), null);
});

// --- the tracking issue of a folder -------------------------------------------

const issueWithPlan = (number, folder, authorAssociation = "OWNER") => ({
  number,
  title: `Phase ${folder}`,
  body: folder ? planLine(folder) : "no plan here",
  authorAssociation,
});

test("a phase folder resolves to the one open issue that names it", () => {
  const issues = [
    issueWithPlan(210, null),
    issueWithPlan(414, "07-ai-service"),
    issueWithPlan(415, "07.1-jev-gateway"),
  ];
  assert.equal(trackingIssue("07-ai-service", issues).number, 414);
  assert.equal(trackingIssue("07.1-jev-gateway", issues).number, 415);
});

test("no tracking issue for a folder is refused with what to do", () => {
  assert.throws(
    () => trackingIssue("08-mcp-public", [issueWithPlan(414, "07-ai-service")]),
    (error) =>
      error instanceof PhaseWorkError &&
      /no open tracking issue/i.test(error.message) &&
      error.message.includes("Plan: .plan/08-mcp-public"),
  );
});

test("several tracking issues for one folder are refused and named", () => {
  const issues = [issueWithPlan(414, "07-ai-service"), issueWithPlan(500, "07-ai-service")];
  assert.throws(
    () => trackingIssue("07-ai-service", issues),
    (error) =>
      error instanceof PhaseWorkError && /#414/.test(error.message) && /#500/.test(error.message),
  );
});

// --- selection ----------------------------------------------------------------

test("the next issue is the first eligible one in sub-issue order, not the lowest number", () => {
  const work = select([sub(302), sub(210), sub(211)]);
  assert.equal(work.status, "next");
  assert.deepEqual(work.next, { number: 302, title: "Issue 302" });
  assert.equal(work.tracking.number, 414);
  assert.equal(work.phase, "07-ai-service");
});

test("closed sub-issues are passed over and counted as progress", () => {
  const work = select([sub(302, { state: "CLOSED" }), sub(210), sub(211)]);
  assert.equal(work.next.number, 210);
  assert.deepEqual(work.progress, { closed: 1, total: 3 });
});

test("an issue with an open native blocker is skipped", () => {
  const work = select([sub(210, { blockedBy: [blocker(302)] }), sub(211)]);
  assert.equal(work.next.number, 211);
  const skipped = work.open.find((issue) => issue.number === 210);
  assert.equal(skipped.kind, "blocked");
  assert.deepEqual(skipped.openBlockers, [302]);
});

test("a link to a closed blocker does not block", () => {
  const work = select([sub(210, { blockedBy: [blocker(302, "CLOSED")] }), sub(211)]);
  assert.equal(work.next.number, 210);
});

test("an issue is blocked while any one of its blockers is open", () => {
  const work = select([sub(216, { blockedBy: [blocker(215, "CLOSED"), blocker(393)] })]);
  assert.equal(work.status, "waiting");
  assert.deepEqual(work.open[0].openBlockers, [393]);
});

test("hitl and agent-failed issues are skipped", () => {
  const work = select([
    sub(1, { labels: [READY, "hitl"] }),
    sub(2, { labels: [READY, "afk", "agent-failed"] }),
    sub(3),
  ]);
  assert.equal(work.next.number, 3);
  assert.deepEqual(
    work.open.map((issue) => issue.kind),
    ["hitl", "failed", "eligible"],
  );
});

test("an issue without ready-for-agent is not work for an agent", () => {
  const work = select([sub(364, { labels: ["enhancement"] }), sub(210)]);
  assert.equal(work.next.number, 210);
  assert.equal(work.open[0].kind, "not-ready");
});

test("an agent-retry issue is still taken", () => {
  assert.equal(select([sub(5, { labels: [READY, "afk", "agent-retry"] })]).next.number, 5);
});

test("an issue with sub-issues of its own is never selected, whatever its labels", () => {
  const work = select([sub(414, { subIssues: 3 }), sub(210)]);
  assert.equal(work.next.number, 210);
  assert.equal(work.open[0].kind, "parent");
  assert.equal(select([sub(414, { subIssues: 1 })]).next, null);
});

test("a phase whose sub-issues are all closed is finished", () => {
  const work = select([sub(1, { state: "CLOSED" }), sub(2, { state: "CLOSED" })]);
  assert.equal(work.status, "finished");
  assert.equal(work.next, null);
  assert.deepEqual(work.open, []);
});

test("a phase without sub-issues is empty, not finished", () => {
  const work = select([]);
  assert.equal(work.status, "empty");
  assert.equal(work.next, null);
  assert.deepEqual(work.progress, { closed: 0, total: 0 });
});

test("a phase with open issues and none eligible is waiting, with the blockers and the human issues named", () => {
  const work = select([
    sub(210, { state: "CLOSED" }),
    sub(211, { blockedBy: [blocker(900)] }),
    sub(216, { labels: [READY, "hitl"], blockedBy: [blocker(211)] }),
    sub(217, { labels: [READY, "agent-failed"] }),
    sub(364, { labels: [] }),
  ]);
  assert.equal(work.status, "waiting");
  assert.equal(work.next, null);
  const text = workLines(work).join("\n");
  assert.match(text, /waiting/);
  assert.match(text, /blocked: #211 \(by #900\)/);
  assert.match(text, /waiting for a human \(hitl\): #216 \(blocked by #211\)/);
  assert.match(text, /agent-failed: #217/);
  assert.match(text, /not ready-for-agent: #364/);
});

test("the lines name the tracking issue, the progress and the next issue", () => {
  const lines = workLines(select([sub(302, { state: "CLOSED" }), sub(210), sub(211)]));
  assert.match(lines[0], /07-ai-service/);
  assert.match(lines[0], /#414/);
  assert.match(lines[0], /1\/3/);
  assert.ok(lines.includes("next: #210 Issue 210"));
});

test("the lines say finished and empty in plain words", () => {
  assert.match(workLines(select([sub(1, { state: "CLOSED" })])).join("\n"), /finished/);
  assert.match(workLines(select([])).join("\n"), /no sub-issues/);
});

// --- order between phases -----------------------------------------------------

test("a phase whose tracking issue has an open blocker waits, and nothing of it is selected", () => {
  const work = select([sub(1)], { blockedBy: [blocker(414), blocker(300, "CLOSED")], number: 418 });
  assert.equal(work.status, "phase-waits");
  assert.equal(work.next, null);
  assert.deepEqual(
    work.phaseBlockers.map((issue) => issue.number),
    [414],
  );
  assert.match(workLines(work).join("\n"), /the phase waits for #414/);
});

test("a phase whose tracking issue's blockers are closed may start", () => {
  const work = select([sub(1)], { blockedBy: [blocker(414, "CLOSED")] });
  assert.equal(work.status, "next");
  assert.deepEqual(work.phaseBlockers, []);
});

const phaseIssue = (number, folder, blockedBy = [], authorAssociation = "OWNER") => ({
  ...issueWithPlan(number, folder, authorAssociation),
  blockedBy,
});

test("the order between phases is read from the links between tracking issues", () => {
  const phases = phaseOrder([
    phaseIssue(414, "07-ai-service"),
    phaseIssue(418, "08-mcp-public", [blocker(414)]),
    phaseIssue(416, "09.1-rag-integration", [blocker(414), blocker(418), blocker(7, "CLOSED")]),
    { ...phaseIssue(210, null), body: "## Blocked by\n\n- #302" },
  ]);
  assert.deepEqual(
    phases.map((phase) => [phase.folder, phase.number, phase.mayStart]),
    [
      ["07-ai-service", 414, true],
      ["08-mcp-public", 418, false],
      ["09.1-rag-integration", 416, false],
    ],
  );
  assert.deepEqual(phases[2].waitsFor, [
    { number: 414, folder: "07-ai-service" },
    { number: 418, folder: "08-mcp-public" },
  ]);
});

test("a phase may also wait for an issue that is no tracking issue", () => {
  const [phase] = phaseOrder([phaseIssue(418, "08-mcp-public", [blocker(99)])]);
  assert.deepEqual(phase.waitsFor, [{ number: 99, folder: null }]);
  assert.equal(phase.mayStart, false);
});

// --- incomplete answers ---------------------------------------------------------

test("a list GitHub returned only in part is refused loudly", () => {
  assert.doesNotThrow(() => assertComplete({ totalCount: 2, nodes: [1, 2] }, "labels of #1"));
  assert.throws(
    () => assertComplete({ totalCount: 101, nodes: new Array(100).fill(0) }, "blockers of #216"),
    (error) =>
      error instanceof PhaseWorkError &&
      /blockers of #216/.test(error.message) &&
      /100 of 101/.test(error.message),
  );
});

// --- review of pull request #423 ----------------------------------------------------

// The status is said in a line of its own, so nothing is ever read from a missing line.
test("every selection says its status in a line of its own", () => {
  const status = (work) => workLines(work).find((line) => line.startsWith("status: "));
  assert.equal(status(select([sub(1)])), "status: next");
  assert.equal(status(select([sub(1, { labels: [READY, "hitl"] })])), "status: waiting");
  assert.equal(status(select([sub(1, { state: "CLOSED" })])), "status: finished");
  assert.equal(status(select([])), "status: empty");
  assert.equal(status(select([sub(1)], { blockedBy: [blocker(414)] })), "status: phase-waits");
});

test("a phase that waits for another phase is not empty or waiting on issues: it has not started", () => {
  assert.equal(select([], { blockedBy: [blocker(414)] }).status, "phase-waits");
  assert.equal(
    select([sub(1, { labels: [READY, "hitl"] })], { blockedBy: [blocker(414)] }).status,
    "phase-waits",
  );
});

test("the blocking phases are named with their folders when known", () => {
  const work = select([sub(1)], {
    blockedBy: [{ ...blocker(414), folder: "07-ai-service" }],
    number: 418,
  });
  assert.deepEqual(work.phaseBlockers, [
    { number: 414, title: "Issue 414", folder: "07-ai-service" },
  ]);
  assert.match(workLines(work).join("\n"), /the phase waits for #414 \(07-ai-service\)/);
});

// --- the plan line, strictly ----------------------------------------------------------

test("a plan line inside a fenced code block is an example, not the plan line", () => {
  assert.equal(planFolder("Write this:\n\n```\nPlan: .plan/07-ai-service\n```\n"), null);
  assert.equal(planFolder("~~~text\nPlan: .plan/07-ai-service\n~~~"), null);
  assert.equal(
    planFolder("```\nPlan: .plan/00-example\n```\n\nPlan: .plan/07-ai-service\n"),
    "07-ai-service",
  );
});

test("a plan line inside an HTML comment is not the plan line", () => {
  assert.equal(planFolder("<!--\nPlan: .plan/07-ai-service\n-->\nText"), null);
  assert.equal(planFolder("<!-- hint -->\nPlan: .plan/07-ai-service"), "07-ai-service");
});

test("a comment that only forms once another is removed still hides its plan line", () => {
  // Removing the inner comment leaves `<!--` … `-->` around the line: one pass is not enough.
  assert.equal(planFolder("<!<!-- x -->--\nPlan: .plan/07-ai-service\n-->\nText"), null);
  assert.equal(planFolder("<!<!-- x -->-- open, never closed\nPlan: .plan/07-ai-service"), null);
});

test("an indented or quoted plan line is not the plan line", () => {
  assert.equal(planFolder("    Plan: .plan/07-ai-service"), null);
  assert.equal(planFolder("> Plan: .plan/07-ai-service"), null);
});

// --- who may name a phase ----------------------------------------------------------------

test("only the owner, a member or a collaborator can name a phase's tracking issue", () => {
  const issues = [
    issueWithPlan(414, "07-ai-service"),
    issueWithPlan(900, "07-ai-service", "NONE"),
    issueWithPlan(901, "07-ai-service", "CONTRIBUTOR"),
    issueWithPlan(902, "08-mcp-public", "FIRST_TIME_CONTRIBUTOR"),
  ];
  assert.equal(trackingIssue("07-ai-service", issues).number, 414);
  assert.deepEqual(
    untrustedPlanIssues(issues, "07-ai-service").map((issue) => issue.number),
    [900, 901],
  );
  assert.deepEqual(
    untrustedPlanIssues(issues).map((issue) => issue.number),
    [900, 901, 902],
  );
  for (const association of ["OWNER", "MEMBER", "COLLABORATOR"]) {
    assert.equal(trackingIssue("x", [issueWithPlan(1, "x", association)]).number, 1);
  }
});

test("an outsider's issue alone does not make a phase, and the refusal says it was ignored", () => {
  assert.throws(
    () => trackingIssue("08-mcp-public", [issueWithPlan(902, "08-mcp-public", "NONE")]),
    (error) =>
      error instanceof PhaseWorkError &&
      /no open tracking issue/i.test(error.message) &&
      /#902.*ignored/.test(error.message),
  );
});

test("the selection reports the issues it ignored", () => {
  const work = selectWork({
    phase: "07-ai-service",
    tracking: tracking([sub(210)]),
    ignored: [{ number: 900, authorAssociation: "NONE" }],
  });
  assert.equal(work.next.number, 210);
  assert.deepEqual(work.ignored, [{ number: 900, authorAssociation: "NONE" }]);
  assert.match(
    workLines(work).join("\n"),
    /ignored: #900 .*not the owner, a member or a collaborator/,
  );
});

test("the phases are those a trusted author named", () => {
  const phases = phaseOrder([
    phaseIssue(414, "07-ai-service"),
    phaseIssue(900, "99-outsider", [], "NONE"),
  ]);
  assert.deepEqual(
    phases.map((phase) => phase.folder),
    ["07-ai-service"],
  );
});

// --- phases and epics (the owner's decision of 2026-11-22) ---------------------------------

test("an epic — a tracking issue without a plan line — is no phase: no folder resolves to it", () => {
  const epic = { ...issueWithPlan(500, null), body: "Tracking issue of the audit fixes." };
  assert.throws(() => trackingIssue("audit-fixes", [epic]), PhaseWorkError);
  assert.throws(() => trackingIssue("500", [epic]), PhaseWorkError);
  assert.deepEqual(phaseOrder([{ ...epic, blockedBy: [] }]), []);
});

test("an epic among a phase's sub-issues is never selected as work", () => {
  const work = select([sub(500, { subIssues: 4 }), sub(210)]);
  assert.equal(work.next.number, 210);
  assert.equal(work.open[0].kind, "parent");
});

// --- sub-issues of another repository ------------------------------------------------------

test("a sub-issue from another repository is refused loudly", () => {
  const own = { ...tracking([]), repository: "owner/site" };
  own.subIssues = [
    { ...sub(210), repository: "owner/site" },
    { ...sub(7), repository: "someone/else" },
  ];
  assert.throws(
    () => selectWork({ phase: "07-ai-service", tracking: own }),
    (error) =>
      error instanceof PhaseWorkError &&
      /#7/.test(error.message) &&
      /someone\/else/.test(error.message),
  );
  own.subIssues.pop();
  assert.equal(selectWork({ phase: "07-ai-service", tracking: own }).next.number, 210);
});

// --- cycles ----------------------------------------------------------------------------------

test("issues of a phase that block each other are named as a cycle", () => {
  const work = select([
    sub(211, { blockedBy: [blocker(213)] }),
    sub(212, { blockedBy: [blocker(211)] }),
    sub(213, { blockedBy: [blocker(212)] }),
    sub(214, { blockedBy: [blocker(900)] }),
  ]);
  assert.equal(work.status, "waiting");
  assert.deepEqual(work.cycles, [[211, 213, 212]]);
  const text = workLines(work).join("\n");
  assert.match(text, /cycle: #211 → #213 → #212 → #211/);
});

test("a chain of blockers is no cycle", () => {
  const work = select([sub(210), sub(211, { blockedBy: [blocker(210)] })]);
  assert.deepEqual(work.cycles, []);
  assert.doesNotMatch(workLines(work).join("\n"), /cycle/);
});

test("tracking issues that block each other are named as a cycle in the phases", () => {
  const phases = phaseOrder([
    phaseIssue(414, "07-ai-service", [blocker(418)]),
    phaseIssue(418, "08-mcp-public", [blocker(414)]),
    phaseIssue(417, "15-pages"),
  ]);
  assert.deepEqual(phases[0].cycle, [414, 418]);
  assert.deepEqual(phases[1].cycle, [418, 414]);
  assert.equal(phases[2].cycle, null);
  const lines = phaseLines(phases);
  assert.match(lines[0], /cycle: #414 → #418 → #414/);
  assert.doesNotMatch(lines[2], /cycle/);
});

test("a phase caught in a cycle says so when asked for its next issue", () => {
  const work = selectWork({
    phase: "07-ai-service",
    tracking: tracking([sub(210)], { blockedBy: [blocker(418)] }),
    phaseCycle: [414, 418],
  });
  assert.equal(work.status, "phase-waits");
  assert.match(workLines(work).join("\n"), /cycle: #414 → #418 → #414/);
});
