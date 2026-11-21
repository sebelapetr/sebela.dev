// Behaviour of the decision whether CI's quality job runs the tests of every package for the full
// coverage figure (docs/testing.md, Coverage): only on a push to master that changes something
// other than documentation. Observed through the command line the workflow uses, in a disposable
// Git repository. The last tests read the repository's own CI workflow, so the full run and the
// coverage site cannot start without this decision.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { fullCoverageRun } from "./coverage-full-run.mjs";
import { workflowJob } from "./mcp-admin-evals-affected.mjs";

const CHECK = path.join(import.meta.dirname, "coverage-full-run.mjs");
const REPOSITORY = path.resolve(import.meta.dirname, "..", "..");
const WORKFLOW = path.join(REPOSITORY, ".github", "workflows", "ci.yml");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function write(root, file, text) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

/** A repository with a base commit; `change` edits it for the head. Removed after the test `t`. */
function repository(t, change) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-full-run-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "Fixture");
  write(root, "apps/api/src/app.ts", "export const app = 1;\n");
  write(root, "docs/testing.md", "# Testing\n");
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "--message", "base");
  const base = git(root, "rev-parse", "HEAD");
  change(root);
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "--message", "head", "--allow-empty");
  return { root, base };
}

/** Runs the check as the workflow does: the event from the environment, the base as argument. */
function run(cwd, event, base) {
  const result = spawnSync(process.execPath, [CHECK, base], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH, EVENT: event },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("full coverage run: when the quality job tests every package", () => {
  it("runs on a push that changes anything but documentation", () => {
    assert.equal(fullCoverageRun({ event: "push", files: ["apps/api/src/app.ts"] }), true);
    assert.equal(fullCoverageRun({ event: "push", files: ["harness/worktree.mjs"] }), true);
  });

  it("does not run on a push that changes documentation alone, or nothing", () => {
    assert.equal(fullCoverageRun({ event: "push", files: [] }), false);
  });

  it("runs on a push whose base cannot be resolved", () => {
    assert.equal(fullCoverageRun({ event: "push", files: null }), true);
  });

  it("never runs for a pull request or a run started by hand", () => {
    for (const event of ["pull_request", "workflow_dispatch", "", undefined]) {
      assert.equal(fullCoverageRun({ event, files: ["apps/api/src/app.ts"] }), false, event);
      assert.equal(fullCoverageRun({ event, files: null }), false, event);
    }
  });

  it("prints full-run=false for a push of documentation alone, such as a changelog", (t) => {
    const { root, base } = repository(t, (dir) => {
      write(dir, "docs/testing.md", "# Testing\n\nMore.\n");
      write(dir, "CHANGELOG.md", "# Changelog\n");
    });
    const { status, stdout, stderr } = run(root, "push", base);
    assert.equal(status, 0);
    assert.equal(stdout, "full-run=false\n");
    assert.match(stderr, /documentation/i);
  });

  it("prints full-run=true for a push that changes code", (t) => {
    const { root, base } = repository(t, (dir) => {
      write(dir, "apps/api/src/app.ts", "export const app = 2;\n");
      write(dir, "docs/testing.md", "# Testing\n\nMore.\n");
    });
    assert.equal(run(root, "push", base).stdout, "full-run=true\n");
  });

  it("prints full-run=true for a push without a usable base", (t) => {
    const { root } = repository(t, () => {});
    for (const base of ["", "0000000000000000000000000000000000000000", "not-a-commit"]) {
      const { status, stdout } = run(root, "push", base);
      assert.equal(status, 0, base);
      assert.equal(stdout, "full-run=true\n", base);
    }
  });

  it("prints full-run=false for a pull request whatever it changes", (t) => {
    const { root, base } = repository(t, (dir) => {
      write(dir, "apps/api/src/app.ts", "export const app = 2;\n");
    });
    assert.equal(run(root, "pull_request", base).stdout, "full-run=false\n");
  });
});

describe("the CI workflow applies the decision", () => {
  const job = workflowJob(fs.readFileSync(WORKFLOW, "utf8"), "quality");

  /** The `if:` of the step with this name in the quality job, or undefined. */
  function condition(name) {
    const lines = job.split("\n");
    const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
    if (start === -1) return undefined;
    for (const line of lines.slice(start + 1)) {
      if (/^\s*- /.test(line)) return undefined;
      const match = /^\s*if: (.*)$/.exec(line);
      if (match) return match[1].trim();
    }
    return undefined;
  }

  it("decides with this check", () => {
    assert.match(job, /node scripts\/checks\/coverage-full-run\.mjs "\$TURBO_SCM_BASE"/);
  });

  it("runs every package's tests and keeps the coverage site only after a yes", () => {
    for (const step of [
      "Tests of every package, for the full coverage figure (master only)",
      "Coverage site (master only)",
    ]) {
      assert.equal(condition(step), "steps.coverage.outputs.full-run == 'true'", step);
    }
  });
});

describe("the coverage site workflow publishes only what a full run kept", () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY, ".github", "workflows", "coverage-pages.yml"),
    "utf8",
  );
  const site = workflowJob(workflow, "site");
  const publish = workflowJob(workflow, "publish");

  it("looks at a successful push run of this repository only", () => {
    for (const term of [
      "github.event.workflow_run.conclusion == 'success'",
      "github.event.workflow_run.event == 'push'",
      "github.event.workflow_run.head_repository.full_name == github.repository",
    ]) {
      assert.ok(site.includes(term), term);
    }
  });

  it("deploys only when that run kept the coverage site, and ends green otherwise", () => {
    assert.match(publish, /^ {4}needs: site$/m);
    assert.match(publish, /^ {4}if: needs\.site\.outputs\.kept == 'true'$/m);
    assert.match(site, /kept=false/);
    assert.doesNotMatch(site, /exit 1/);
  });

  it("keeps the Pages permissions and the environment to the deploying job", () => {
    assert.doesNotMatch(site, /pages: write|id-token: write|environment:/);
    assert.match(publish, /pages: write/);
    assert.match(publish, /name: github-pages/);
    assert.doesNotMatch(workflow.slice(0, workflow.indexOf("\njobs:")), /: write/);
  });
});
