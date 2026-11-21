// Behaviour of the decision whether an event may start paid model evals by itself (docs/testing.md,
// CI): only a phase pull request, head branch `phase/<phase-folder>`, and a run started by hand.
// Observed through the command line the workflow uses, which reads the event and the head branch
// from the environment. The last tests read the repository's own model evals workflow, so a suite
// that could start without this decision fails `node --test scripts/`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { workflowJob } from "./mcp-admin-evals-affected.mjs";
import { phaseCampaign, startsPaidEvals } from "./paid-evals-trigger.mjs";

const CHECK = path.join(import.meta.dirname, "paid-evals-trigger.mjs");
const REPOSITORY = path.resolve(import.meta.dirname, "..", "..");
const WORKFLOW = path.join(REPOSITORY, ".github", "workflows", "model-evals.yml");

/** Runs the check as the workflow does, with only the given variables set. */
function run(variables) {
  const result = spawnSync(process.execPath, [CHECK], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...variables },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("paid model evals: which events may start them", () => {
  it("starts on a pull request whose head is a phase branch", () => {
    for (const headRef of ["phase/06-llm-agent", "phase/07.1-gateway", "phase/00-overview"]) {
      assert.equal(startsPaidEvals({ event: "pull_request", headRef }), true, headRef);
    }
  });

  it("does not start on any other pull request, whatever its branch is called", () => {
    for (const headRef of [
      "fix/337-paid-evals-phase-only",
      "feat/12-mcp-admin-tools",
      "dependabot/npm_and_yarn/production-1a2b3c",
      "chore/06-llm-agent-plan-done",
      "master",
      "phase",
      "phase/",
      "phase/06-llm-agent/extra",
      "fix/phase/06-llm-agent",
      "Phase/06-llm-agent",
      "phase/06 llm-agent",
      "phase/06-llm-agent\nphase/x",
      " phase/06-llm-agent",
      "",
      undefined,
    ]) {
      assert.equal(
        startsPaidEvals({ event: "pull_request", headRef }),
        false,
        JSON.stringify(headRef),
      );
    }
  });

  it("starts on a run started by hand, which has no head branch", () => {
    assert.equal(startsPaidEvals({ event: "workflow_dispatch", headRef: "" }), true);
    assert.equal(startsPaidEvals({ event: "workflow_dispatch", headRef: undefined }), true);
  });

  it("does not start on any other event, a phase branch included", () => {
    for (const event of ["push", "pull_request_target", "schedule", "merge_group", "", undefined]) {
      assert.equal(startsPaidEvals({ event, headRef: "phase/06-llm-agent" }), false, String(event));
    }
  });
});

describe("paid model evals: the eval campaign of a phase pull request", () => {
  it("is the phase folder of the head branch", () => {
    assert.equal(
      phaseCampaign({ event: "pull_request", headRef: "phase/07-ai-service" }),
      "07-ai-service",
    );
    assert.equal(
      phaseCampaign({ event: "pull_request", headRef: "phase/07.1-jev-gateway" }),
      "07.1-jev-gateway",
    );
  });

  it("is none for anything that is not a phase pull request", () => {
    for (const [event, headRef] of [
      ["workflow_dispatch", "phase/07-ai-service"],
      ["pull_request", "fix/371-thing"],
      ["pull_request", "phase/07-ai-service/extra"],
      ["pull_request", "phase/07 ai\ncampaign=06-llm-agent"],
      ["pull_request", undefined],
      ["push", "phase/07-ai-service"],
    ]) {
      assert.equal(phaseCampaign({ event, headRef }), null, `${event} ${headRef}`);
    }
  });
});

describe("paid model evals: the command the workflow runs", () => {
  it("prints paid-evals=true for a phase pull request and names the branch", () => {
    const result = run({ EVENT: "pull_request", HEAD_REF: "phase/06-llm-agent" });
    assert.equal(result.status, 0, result.output);
    // The second line names the eval campaign of the phase: its phase folder.
    assert.equal(result.stdout, "paid-evals=true\ncampaign=06-llm-agent\n");
    assert.match(result.output, /phase\/06-llm-agent/);
  });

  it("names no campaign for a run started by hand or for any other pull request", () => {
    for (const variables of [
      { EVENT: "workflow_dispatch" },
      { EVENT: "workflow_dispatch", HEAD_REF: "phase/07-ai-service" },
      { EVENT: "pull_request", HEAD_REF: "fix/371-thing" },
      { EVENT: "push", HEAD_REF: "phase/07-ai-service" },
    ]) {
      assert.doesNotMatch(run(variables).stdout, /campaign=/, JSON.stringify(variables));
    }
  });

  it("prints paid-evals=false for an ordinary pull request and says how to run a suite by hand", () => {
    const result = run({ EVENT: "pull_request", HEAD_REF: "fix/337-paid-evals-phase-only" });
    assert.equal(result.status, 0, result.output);
    assert.equal(result.stdout, "paid-evals=false\n");
    assert.match(result.output, /not a phase pull request/);
    assert.match(result.output, /by hand/);
  });

  it("prints paid-evals=true for a run started by hand", () => {
    const result = run({ EVENT: "workflow_dispatch" });
    assert.equal(result.status, 0, result.output);
    assert.equal(result.stdout, "paid-evals=true\n");
  });

  it("prints paid-evals=false when the event is unknown or missing", () => {
    for (const variables of [{}, { HEAD_REF: "phase/06-llm-agent" }, { EVENT: "push" }]) {
      const result = run(variables);
      assert.equal(result.status, 0, result.output);
      assert.equal(result.stdout, "paid-evals=false\n");
    }
  });

  it("keeps a head branch with line breaks out of the output file", () => {
    const result = run({ EVENT: "pull_request", HEAD_REF: "x\npaid-evals=true\nmcp-admin=true" });
    assert.equal(result.status, 0, result.output);
    assert.equal(result.stdout, "paid-evals=false\n");
  });
});

/** The steps of a job's text: each from its `      - ` line to the next. */
function stepsOf(job) {
  const steps = [];
  for (const line of job.split("\n")) {
    if (/^ {6}- /.test(line)) steps.push([line]);
    else if (steps.length > 0) steps.at(-1).push(line);
  }
  return steps.map((lines) => lines.join("\n"));
}

/** The keys of the jobs of a workflow, in order. */
function jobsOf(workflow) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  return lines
    .slice(start + 1)
    .map((line) => /^ {2}([\w-]+):\s*$/.exec(line)?.[1])
    .filter(Boolean);
}

describe("paid model evals: the repository's workflow", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");
  const changes = workflowJob(workflow, "changes");
  const steps = stepsOf(changes);

  it("asks this check before it selects any suite", () => {
    const trigger = steps.findIndex((step) => /^ {6}- id: trigger$/m.test(step));
    assert.notEqual(trigger, -1, "the changes job has no step with id `trigger`");
    assert.match(
      steps[trigger],
      /^ {8}run: node scripts\/checks\/paid-evals-trigger\.mjs >> "\$GITHUB_OUTPUT"$/m,
    );
    assert.match(steps[trigger], /^ {10}EVENT: \$\{\{ github\.event_name \}\}$/m);
    assert.match(steps[trigger], /^ {10}HEAD_REF: \$\{\{ github\.head_ref \}\}$/m);
    assert.doesNotMatch(steps[trigger], /^ {8}if:/m, "the trigger step must always run");

    const selecting = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step, index }) => index !== trigger && step.includes("GITHUB_OUTPUT"));
    assert.ok(selecting.length > 0, "no step of the changes job selects suites");
    for (const { step, index } of selecting) {
      assert.ok(index > trigger, "a step selects suites before the trigger step");
      assert.match(
        step,
        /^ {8}if: steps\.trigger\.outputs\.paid-evals == 'true'$/m,
        `a step selects suites without asking the trigger step:\n${step}`,
      );
    }
  });

  it("runs every suite only behind the selection of the changes job", () => {
    const suites = jobsOf(workflow).filter((job) => job !== "changes");
    assert.ok(suites.includes("mcp-admin"));
    for (const suite of suites) {
      const job = workflowJob(workflow, suite);
      assert.match(job, /^ {4}needs: changes$/m, `${suite} does not need the changes job`);
      assert.ok(
        job.includes(`\n    if: needs.changes.outputs.${suite} == 'true'\n`),
        `${suite} does not depend on its selection by the changes job`,
      );
    }
  });

  it("starts by itself only on pull requests into master, and by hand", () => {
    const on = workflow.slice(workflow.indexOf("\non:\n"), workflow.indexOf("\npermissions:"));
    const events = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map(([, event]) => event);
    assert.deepEqual(events, ["pull_request", "workflow_dispatch"]);
    assert.match(
      on,
      /^ {4}branches:\n {6}- master\n {4}types: \[opened, reopened, ready_for_review\]$/m,
    );
    assert.match(
      changes,
      /^ {4}if: github\.event_name != 'pull_request' \|\| !github\.event\.pull_request\.draft$/m,
      "a draft pull request must run no evals",
    );
  });

  it("never puts the head branch into a shell line, only into an environment variable", () => {
    const uses = workflow.split("\n").filter((line) => /head_ref|head\.ref/.test(line));
    assert.deepEqual(uses, ["          HEAD_REF: ${{ github.head_ref }}"]);
  });

  it("gives the Python agent job the campaign this check names, and a stage", () => {
    assert.match(changes, /^ {6}campaign: \$\{\{ steps\.trigger\.outputs\.campaign \}\}$/m);
    const job = workflowJob(workflow, "llm-agent");
    assert.match(job, /^ {10}PHASE_CAMPAIGN: \$\{\{ needs\.changes\.outputs\.campaign \}\}$/m);
    const command = job.split("\n").find((line) => line.includes("python -m evals.run --all"));
    assert.match(command, /--campaign "\$CAMPAIGN" --stage "\$STAGE" --allowance "\$ALLOWANCE"$/);
    assert.match(
      job,
      /No eval campaign is named/,
      "a run without a campaign must be a visible block",
    );
  });
});
