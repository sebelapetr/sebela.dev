// Behaviour of the release decisions around a deployment (docs/release-workflow.md,
// "Deployment" and "Versions"): the forced-command input built from the verified tag set, the
// next version from Conventional Commits, and the changelog of the GitHub release.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deployInput, nextVersion, releaseNotes } from "./deployment.mjs";

const sha = (character) => character.repeat(40);

describe("deploy input", () => {
  it("names every service with its tag, in a fixed order", () => {
    assert.equal(
      deployInput({ "mcp-admin": sha("c"), web: sha("b"), api: sha("a") }),
      `deploy api=${sha("a")} web=${sha("b")} mcp-admin=${sha("c")}`,
    );
  });

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
      assert.throws(() => deployInput(tags));
    });
  }

  it("refuses something that is not a tag set", () => {
    assert.throws(() => deployInput(null));
    assert.throws(() => deployInput([sha("a")]));
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
