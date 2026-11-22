import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PhaseWorkError,
  assertComplete,
  phaseOrder,
  planFolder,
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

const issueWithPlan = (number, folder) => ({
  number,
  title: `Phase ${folder}`,
  body: folder ? planLine(folder) : "no plan here",
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
  assert.equal(work.status, "waiting");
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

test("the order between phases is read from the links between tracking issues", () => {
  const phases = phaseOrder([
    { number: 414, title: "Phase 07", body: planLine("07-ai-service"), blockedBy: [] },
    { number: 418, title: "Phase 08", body: planLine("08-mcp-public"), blockedBy: [blocker(414)] },
    {
      number: 416,
      title: "Phase 09.1",
      body: planLine("09.1-rag-integration"),
      blockedBy: [blocker(414), blocker(418), blocker(7, "CLOSED")],
    },
    { number: 210, title: "An issue", body: "## Blocked by\n\n- #302", blockedBy: [] },
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
  const [phase] = phaseOrder([
    { number: 418, title: "Phase 08", body: planLine("08-mcp-public"), blockedBy: [blocker(99)] },
  ]);
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
