#!/usr/bin/env node
// CI commit-message check: the commits a pull request or a push brings, and the title of an issue
// pull request, against the Conventional Commits rules of the commit-msg hook
// (../../harness/lib/commit-message.mjs; docs/git-workflow.md, "Commits").
//
//   node scripts/checks/commit-messages.mjs
//
// Reads the event GitHub Actions describes in GITHUB_EVENT_NAME and GITHUB_EVENT_PATH and needs a
// checkout with the history of the range (actions/checkout with fetch-depth: 0).
//
// - Issue pull request (head is not a `phase/` branch): squash-merged into the phase branch, so the
//   title becomes the commit header and must itself be in Conventional form; its commits may
//   include merge and autosquash commits, which the squash removes.
// - Phase pull request (head is a `phase/` branch) and push to a phase branch or master: the commits
//   reach the target as they are, so autosquash markers are refused; merge commits pass. A push
//   that creates a branch checks the commits it adds to the default branch.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { checkCommitMessage } from "../../harness/lib/commit-message.mjs";

const ZERO = /^0+$/;
const FIELD = "\x1f";
const RECORD = "\x1e";

// What to check for an event: the commit range base..head, the title to check (or null) and
// whether autosquash commits may stay in the range.
export function planCommitCheck(eventName, event) {
  if (eventName === "pull_request") {
    const pr = event.pull_request;
    const squashMerged = !String(pr.head.ref).startsWith("phase/");
    return {
      base: pr.base.sha,
      head: pr.head.sha,
      title: squashMerged ? pr.title : null,
      autosquash: squashMerged,
    };
  }
  if (eventName === "push") {
    const created = event.created || !event.before || ZERO.test(event.before);
    return {
      base: created ? `origin/${event.repository.default_branch}` : event.before,
      head: event.after,
      title: null,
      autosquash: false,
    };
  }
  throw new Error(`The event "${eventName}" is not checked; expected pull_request or push.`);
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1 << 28,
  });
}

function requireCommit(cwd, ref) {
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    throw new Error(
      `The commit ${ref} is not in this checkout. Check out the full history ` +
        "(actions/checkout with fetch-depth: 0); if it is, the push rewrote the branch and " +
        `${ref} no longer exists on it, which a shared branch never allows (no force-push).`,
    );
  }
}

// Returns { checked, problems } where each problem is { commit, header, errors }; the title, when
// checked, is reported with commit null.
export function checkCommits(cwd, { base, head, title, autosquash }) {
  requireCommit(cwd, base);
  requireCommit(cwd, head);
  const log = git(cwd, ["log", "--reverse", `--format=%H${FIELD}%B${RECORD}`, `${base}..${head}`]);
  const commits = log
    .split(RECORD)
    .map((entry) => entry.replace(/^\n+/, ""))
    .filter(Boolean)
    .map((entry) => {
      const [commit, message] = entry.split(FIELD);
      return { commit, message };
    });
  const problems = [];
  for (const { commit, message } of commits) {
    const { errors } = checkCommitMessage(message, { autosquash });
    if (errors.length) problems.push({ commit, header: message.split("\n")[0], errors });
  }
  if (title !== null) {
    const { errors } = checkCommitMessage(title, { autosquash: false, merge: false });
    if (/\n/.test(title)) errors.push("The title must be a single line.");
    if (errors.length) problems.push({ commit: null, header: title, errors });
  }
  return { checked: commits.length, problems };
}

function main() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventName || !eventPath) {
    throw new Error("GITHUB_EVENT_NAME and GITHUB_EVENT_PATH must describe a GitHub event.");
  }
  const plan = planCommitCheck(eventName, JSON.parse(fs.readFileSync(eventPath, "utf8")));
  const { checked, problems } = checkCommits(process.cwd(), plan);
  const titleNote = plan.title === null ? "" : " and the pull request title";
  if (!problems.length) {
    process.stdout.write(
      `Checked ${checked} commit(s) of ${plan.base}..${plan.head}${titleNote}: all follow ` +
        "Conventional Commits (docs/git-workflow.md).\n",
    );
    return 0;
  }
  const lines = problems.map(({ commit, header, errors }) => {
    const label = commit === null ? "pull request title" : commit.slice(0, 12);
    return `${label} ${header}\n${errors.map((error) => `  - ${error}\n`).join("")}`;
  });
  process.stderr.write(
    `Checked ${checked} commit(s) of ${plan.base}..${plan.head}${titleNote}; ` +
      `${problems.length} do(es) not follow Conventional Commits (docs/git-workflow.md):\n` +
      lines.join(""),
  );
  return 1;
}

if (import.meta.main) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`commit-messages: ${error.message}\n`);
    process.exitCode = 1;
  }
}
