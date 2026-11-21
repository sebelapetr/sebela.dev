// Behaviour of the release decisions around a deployment (docs/release-workflow.md,
// "Deployment" and "Versions"): the forced-command input built from the verified tag set, the
// next version from Conventional Commits, and the changelog of the GitHub release.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { deployInput, nextVersion, releasedVersion, releaseNotes } from "./deployment.mjs";

const sha = (character) => character.repeat(40);

describe("deploy input", () => {
  const release = sha("f");

  it("names the release commit, then every service with its tag, in a fixed order", () => {
    assert.equal(
      deployInput({ "mcp-admin": sha("c"), web: sha("b"), api: sha("a") }, release),
      `deploy release=${release} api=${sha("a")} web=${sha("b")} mcp-admin=${sha("c")}`,
    );
  });

  const tags = { api: sha("a"), web: sha("b"), "mcp-admin": sha("c") };
  const invalidReleases = {
    "a missing release commit": undefined,
    "a short release commit": "abc1234",
    "a branch name": "master",
    "an injected release commit": `${release} api=${sha("d")}`,
  };
  for (const [name, value] of Object.entries(invalidReleases)) {
    it(`refuses ${name}`, () => {
      assert.throws(() => deployInput(tags, value));
    });
  }

  const invalid = {
    "a missing service": { api: sha("a"), web: sha("b") },
    "an unknown service": { api: sha("a"), web: sha("b"), "mcp-admin": sha("c"), x: sha("d") },
    "a moving tag": { api: "current", web: sha("b"), "mcp-admin": sha("c") },
    "a short tag": { api: "abc1234", web: sha("b"), "mcp-admin": sha("c") },
    "an injection": { api: `${sha("a")};id`, web: sha("b"), "mcp-admin": sha("c") },
    "a tag that is not a string": { api: 1, web: sha("b"), "mcp-admin": sha("c") },
  };
  for (const [name, tags] of Object.entries(invalid)) {
    it(`refuses ${name}`, () => {
      assert.throws(() => deployInput(tags, release));
    });
  }

  it("refuses something that is not a tag set", () => {
    assert.throws(() => deployInput(null, release));
    assert.throws(() => deployInput([sha("a")], release));
  });
});

const commit = (subject, body = "") => ({ sha: sha("e"), subject, body });

describe("next version", () => {
  it("starts from v0.0.0 when there is no version yet", () => {
    assert.equal(nextVersion(null, [commit("feat(web): add a page")]), "v0.1.0");
  });

  it("raises the patch version for fixes and everything else", () => {
    assert.equal(nextVersion("v1.2.3", [commit("fix(api): a fix")]), "v1.2.4");
    assert.equal(nextVersion("v1.2.3", [commit("docs: a note"), commit("ci: a job")]), "v1.2.4");
  });

  it("raises the minor version for a feature", () => {
    assert.equal(
      nextVersion("v1.2.3", [commit("fix(api): a fix"), commit("feat(web): a page")]),
      "v1.3.0",
    );
  });

  it("raises the major version for a breaking change, marked either way", () => {
    assert.equal(nextVersion("v1.2.3", [commit("feat(api)!: drop a route")]), "v2.0.0");
    assert.equal(
      nextVersion("v1.2.3", [commit("refactor: rename", "BREAKING CHANGE: the route moved")]),
      "v2.0.0",
    );
  });

  it("ignores merge commits", () => {
    assert.equal(
      nextVersion("v1.2.3", [commit("Merge pull request #1 from x/feat"), commit("fix: a")]),
      "v1.2.4",
    );
  });

  it("refuses a previous version it cannot read", () => {
    assert.throws(() => nextVersion("1.2", [commit("fix: a")]));
  });
});

describe("released version", () => {
  it("is null when no version tag points at the commit", () => {
    assert.equal(releasedVersion([]), null);
    assert.equal(releasedVersion(["latest", "v1.2", "1.2.3", "v1.2.3-rc.1"]), null);
  });

  it("is the version tag that already points at the commit, so nothing is released again", () => {
    assert.equal(releasedVersion(["v0.2.0"]), "v0.2.0");
    assert.equal(releasedVersion(["latest", "v0.2.0"]), "v0.2.0");
  });

  it("is the highest version when several point at the commit", () => {
    assert.equal(releasedVersion(["v0.9.0", "v0.10.0", "v0.2.1"]), "v0.10.0");
  });
});

describe("release notes", () => {
  const tags = { api: sha("a"), web: sha("b"), "mcp-admin": sha("c") };

  it("groups the commits by kind and lists the deployed images", () => {
    const notes = releaseNotes({
      commits: [
        { sha: sha("1"), subject: "feat(web): add the services page (#12)", body: "" },
        { sha: sha("2"), subject: "fix(api): keep the order (#13)", body: "" },
        { sha: sha("3"), subject: "feat(api)!: drop the old route (#14)", body: "" },
        { sha: sha("4"), subject: "Merge pull request #15 from owner/phase", body: "" },
        { sha: sha("5"), subject: "docs: explain the release", body: "" },
        { sha: sha("6"), subject: "an old commit without a type", body: "" },
      ],
      tags,
    });
    const order = [
      "## Breaking changes",
      "## Features",
      "## Fixes",
      "## Other changes",
      "## Images",
    ];
    const positions = order.map((heading) => notes.indexOf(heading));
    assert.ok(
      positions.every((position) => position >= 0),
      notes,
    );
    assert.deepEqual(
      [...positions].sort((a, b) => a - b),
      positions,
      "in this order",
    );
    assert.match(notes, /- \*\*api:\*\* drop the old route \(#14\) \(3333333\)/);
    assert.match(notes, /- \*\*web:\*\* add the services page \(#12\) \(1111111\)/);
    assert.match(notes, /- \*\*api:\*\* keep the order \(#13\) \(2222222\)/);
    assert.match(notes, /- explain the release \(5555555\)/);
    assert.match(notes, /- an old commit without a type \(6666666\)/);
    assert.doesNotMatch(notes, /Merge pull request/);
    assert.match(notes, new RegExp(`sebela-api:${sha("a")}`));
    assert.match(notes, new RegExp(`sebela-web:${sha("b")}`));
    assert.match(notes, new RegExp(`sebela-mcp-admin:${sha("c")}`));
  });

  it("leaves out empty groups", () => {
    const notes = releaseNotes({ commits: [commit("fix: a")], tags });
    assert.doesNotMatch(notes, /## Features/);
    assert.match(notes, /## Fixes/);
  });
});

describe("notes command", () => {
  const script = path.join(import.meta.dirname, "deployment.mjs");
  const tags = { api: sha("a"), web: sha("b"), "mcp-admin": sha("c") };

  function repository() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-notes-"));
    const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
    git("init", "--quiet");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    git("config", "tag.gpgsign", "false");
    const commitAs = (subject) => {
      git("commit", "--quiet", "--allow-empty", "--message", subject);
      return git("rev-parse", "HEAD");
    };
    return { directory, git, commitAs };
  }

  function notes(directory, commitSha) {
    const notesFile = path.join(directory, "notes.md");
    const summary = path.join(directory, "summary.md");
    const stdout = execFileSync(process.execPath, [script, "notes"], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        SHA: commitSha,
        TAGS: JSON.stringify(tags),
        NOTES_FILE: notesFile,
        GITHUB_STEP_SUMMARY: summary,
      },
    });
    const outputs = Object.fromEntries(
      stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("=")),
    );
    const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
    return { outputs, notes: read(notesFile), summary: read(summary) };
  }

  it("releases the next version of a commit without a version tag", () => {
    const { directory, git, commitAs } = repository();
    commitAs("feat(web): a page");
    git("tag", "v0.2.0");
    const head = commitAs("fix(api): a fix");
    const result = notes(directory, head);
    assert.deepEqual(result.outputs, { release: "true", version: "v0.2.1" });
    assert.match(result.notes, /a fix/);
  });

  it("releases nothing again when the commit already carries a version tag", () => {
    const { directory, git, commitAs } = repository();
    commitAs("feat(web): a page");
    const head = commitAs("fix(api): a fix");
    git("tag", "v0.2.0");
    const result = notes(directory, head);
    assert.deepEqual(result.outputs, { release: "false", version: "v0.2.0" });
    assert.equal(result.notes, "");
    assert.match(result.summary, /v0\.2\.0/);
    assert.match(result.summary, /already/);
  });
});
