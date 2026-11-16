// Behaviour of the CI commit-message check, observed through its command line: a disposable Git
// repository, a GitHub event as Actions would deliver it, what the check reports and its exit
// status.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const CHECK = path.join(import.meta.dirname, "commit-messages.mjs");
const ZERO = "0".repeat(40);

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-commit-check-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-C",
        root,
        ...args,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  let files = 0;
  const commit = (message) => {
    fs.writeFileSync(path.join(root, `file-${++files}.txt`), `${files}\n`);
    git("add", "--all");
    git("commit", "--quiet", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "--quiet", "-b", "master");
  return { root, git, commit };
}

function check(t, root, eventName, event) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-commit-event-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const eventPath = path.join(dir, "event.json");
  fs.writeFileSync(eventPath, JSON.stringify(event));
  const result = spawnSync(process.execPath, [CHECK], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const pullRequest = ({ base, head, headRef, title }) => ({
  pull_request: {
    title,
    base: { sha: base, ref: "phase/01-foundation" },
    head: { sha: head, ref: headRef },
  },
});

const push = ({ before, after, created = false }) => ({
  before,
  after,
  created,
  repository: { default_branch: "master" },
});

// A phase branch with an unconventional commit of its own history, and an issue branch cut from it.
function issueBranch(t) {
  const repo = repository(t);
  repo.commit("Phase 0: plan the project");
  repo.git("switch", "--quiet", "-c", "phase/01-foundation");
  const base = repo.commit("feat(config): bootstrap the workspace (#63)");
  repo.git("switch", "--quiet", "-c", "feat/20-affected-task-ci");
  return { ...repo, base };
}

describe("commit-message check: issue pull requests, squash-merged into the phase branch", () => {
  it("accepts a test-first history with autosquash and merge commits and a Conventional title", (t) => {
    const repo = issueBranch(t);
    repo.commit("test(checks): cover the commit range");
    repo.commit("feat(checks): check the commit range");
    repo.commit("fixup! feat(checks): check the commit range");
    repo.git("switch", "--quiet", "phase/01-foundation");
    // The event carries the phase branch's tip at the time of the event.
    const base = repo.commit("fix(harness): keep the slot (#64)");
    repo.git("switch", "--quiet", "feat/20-affected-task-ci");
    repo.git("merge", "--quiet", "--no-edit", "phase/01-foundation");
    const head = repo.git("rev-parse", "HEAD");

    const result = check(
      t,
      repo.root,
      "pull_request",
      pullRequest({
        base,
        head,
        headRef: "feat/20-affected-task-ci",
        title: "ci: gate pull requests with the affected-task pipeline",
      }),
    );

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /5 commit\(s\)/);
    assert.match(result.output, /title/i);
  });

  it("names each commit of the branch that breaks the rules and ignores the base's history", (t) => {
    const repo = issueBranch(t);
    repo.commit("test(checks): cover the commit range");
    const bad = repo.commit("Implemented the check.");
    const head = repo.commit("docs: describe the check");

    const result = check(
      t,
      repo.root,
      "pull_request",
      pullRequest({ base: repo.base, head, headRef: "feat/20-x", title: "ci: add the check" }),
    );

    assert.equal(result.status, 1, result.output);
    assert.match(result.output, new RegExp(bad.slice(0, 12)));
    assert.match(result.output, /Implemented the check\./);
    assert.doesNotMatch(result.output, /Phase 0/);
  });

  it("rejects a title that would not be a valid squash commit header", (t) => {
    for (const title of [
      "Gate pull requests with the affected-task pipeline",
      "Merge branch 'phase/01-foundation' into feat/20-x",
      "fixup! ci: add the check",
    ]) {
      const repo = issueBranch(t);
      const head = repo.commit("ci: add the check");
      const result = check(
        t,
        repo.root,
        "pull_request",
        pullRequest({ base: repo.base, head, headRef: "feat/20-x", title }),
      );
      assert.equal(result.status, 1, title);
      assert.match(result.output, /title/i, title);
    }
  });
});

describe("commit-message check: phase pull requests, merged into master with a merge commit", () => {
  it("does not check the title and refuses autosquash markers among the commits", (t) => {
    const repo = repository(t);
    const base = repo.commit("Phase 0: plan the project");
    repo.git("switch", "--quiet", "-c", "phase/01-foundation");
    const good = repo.commit("feat(config): bootstrap the workspace (#63)");

    const clean = check(
      t,
      repo.root,
      "pull_request",
      pullRequest({
        base,
        head: good,
        headRef: "phase/01-foundation",
        title: "Phase 1: Foundation",
      }),
    );
    assert.equal(clean.status, 0, clean.output);

    const head = repo.commit("fixup! feat(config): bootstrap the workspace (#63)");
    const marked = check(
      t,
      repo.root,
      "pull_request",
      pullRequest({ base, head, headRef: "phase/01-foundation", title: "Phase 1: Foundation" }),
    );
    assert.equal(marked.status, 1, marked.output);
    assert.match(marked.output, /fixup!/);
  });
});

describe("commit-message check: pushes to a phase branch or master", () => {
  it("checks the pushed commits, accepting merge commits and refusing autosquash markers", (t) => {
    const repo = repository(t);
    const before = repo.commit("Phase 0: plan the project");
    repo.git("switch", "--quiet", "-c", "phase/01-foundation");
    repo.commit("feat(config): bootstrap the workspace (#63)");
    repo.git("switch", "--quiet", "master");
    repo.git(
      "merge",
      "--quiet",
      "--no-ff",
      "-m",
      "Merge pull request #73 from owner/phase/01-foundation",
      "phase/01-foundation",
    );
    const merged = repo.git("rev-parse", "HEAD");

    const accepted = check(t, repo.root, "push", push({ before, after: merged }));
    assert.equal(accepted.status, 0, accepted.output);
    assert.match(accepted.output, /2 commit\(s\)/);

    const after = repo.commit("squash! feat(config): bootstrap the workspace (#63)");
    const refused = check(t, repo.root, "push", push({ before: merged, after }));
    assert.equal(refused.status, 1, refused.output);
    assert.match(refused.output, /squash!/);
  });

  it("checks only the commits a new branch adds to the default branch", (t) => {
    const repo = repository(t);
    repo.commit("Phase 0: plan the project");
    repo.git("update-ref", "refs/remotes/origin/master", "HEAD");
    repo.git("switch", "--quiet", "-c", "phase/02-api-db");
    const after = repo.commit("Started phase two");

    const result = check(t, repo.root, "push", push({ before: ZERO, after, created: true }));
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /1 commit\(s\)/);
    assert.match(result.output, /Started phase two/);
    assert.doesNotMatch(result.output, /Phase 0/);
  });

  it("fails and says why when the comparison base is not in the checkout", (t) => {
    const repo = repository(t);
    const after = repo.commit("feat: add something");
    const result = check(t, repo.root, "push", push({ before: "1".repeat(40), after }));
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /fetch-depth/);
  });
});

it("refuses an event it does not know how to check", (t) => {
  const repo = repository(t);
  repo.commit("feat: add something");
  const result = check(t, repo.root, "workflow_dispatch", {});
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /workflow_dispatch/);
});
