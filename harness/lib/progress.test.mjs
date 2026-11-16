import { test } from "node:test";
import assert from "node:assert/strict";
import { currentWork, describeWork, phaseProgress, workChange } from "./progress.mjs";

const call = (name, input) =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
const create = call("Bash", {
  command:
    "cd /x && node harness/worktree.mjs create feat/24-generated-api-client --base origin/phase/02-api-db 2>&1 | tail -5",
});
const dispatch = (agent, description, prompt = "") =>
  call("Agent", { subagent_type: agent, description, prompt });

test("before the orchestrator picks an issue nothing is known", () => {
  assert.deepEqual(currentWork([]), { issue: null, branch: null, agent: null });
});

test("the worktree it creates names the branch and the issue", () => {
  assert.deepEqual(currentWork([create]), {
    issue: 24,
    branch: "feat/24-generated-api-client",
    agent: null,
  });
});

test("the latest dispatch names the agent working now", () => {
  const lines = [
    create,
    dispatch("backend-developer", "Implement issue 24"),
    "not json",
    dispatch("reviewer", "Review", "Review branch feat/24-generated-api-client against issue #24"),
  ];
  assert.deepEqual(currentWork(lines), {
    issue: 24,
    branch: "feat/24-generated-api-client",
    agent: "reviewer",
  });
});

test("a dispatch alone still gives the issue, from its description or prompt", () => {
  assert.equal(currentWork([dispatch("backend-developer", "Implement issue 31")]).issue, 31);
  assert.equal(currentWork([dispatch("reviewer", "Review", "… against issue #32 …")]).issue, 32);
});

test("phase progress counts closed issues of all the phase's issues", () => {
  const issues = [{ state: "CLOSED" }, { state: "OPEN" }, { state: "CLOSED" }, { state: "OPEN" }];
  assert.deepEqual(phaseProgress(issues), { closed: 2, total: 4 });
});

test("one line says who works on what, for how long, and how far the phase is", () => {
  const line = describeWork({
    work: { issue: 24, branch: "feat/24-x", agent: "backend-developer" },
    minutes: 16,
    calls: 73,
    context: 135_621,
    progress: { closed: 3, total: 21 },
  });
  assert.equal(line, "backend-developer on #24 · 16 min · 73 calls · context 136k · phase 3/21");
});

test("what is not known yet is left out instead of shown as empty", () => {
  const line = describeWork({
    work: { issue: null, branch: null, agent: null },
    minutes: 1,
    calls: 0,
    context: 0,
    progress: null,
  });
  assert.equal(line, "orchestrator choosing an issue · 1 min");
});

test("the loop prints a line only when the issue or the agent changes", () => {
  const none = { issue: null, branch: null, agent: null };
  const picked = { issue: 24, branch: "feat/24-x", agent: null };
  const dev = { ...picked, agent: "backend-developer" };
  const review = { ...picked, agent: "reviewer" };
  assert.equal(workChange(none, none), null);
  assert.equal(workChange(none, picked), "#24 feat/24-x");
  assert.equal(workChange(picked, dev), "#24 feat/24-x → backend-developer");
  assert.equal(workChange(dev, dev), null);
  assert.equal(workChange(dev, review), "#24 feat/24-x → reviewer");
});
