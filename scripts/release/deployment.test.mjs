// Behaviour of the release decisions around a deployment (docs/release-workflow.md,
// "Deployment" and "Versions"): the forced-command input built from the verified tag set, the
// next version from Conventional Commits, and the changelog of the GitHub release.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  addToChangelog,
  changelogDocument,
  deployInput,
  nextVersion,
  phasePullRequests,
  phaseSummary,
  releasedVersion,
  releaseNotes,
} from "./deployment.mjs";

const sha = (character) => character.repeat(40);

describe("deploy input", () => {
  const release = sha("f");

  it("names the release commit, then every service with its tag, in a fixed order", () => {
    assert.equal(
      deployInput(
        { "ai-service": sha("d"), "mcp-admin": sha("c"), web: sha("b"), api: sha("a") },
        release,
      ),
      `deploy release=${release} api=${sha("a")} web=${sha("b")} mcp-admin=${sha("c")} ai-service=${sha("d")}`,
    );
  });

  const tags = { api: sha("a"), web: sha("b"), "mcp-admin": sha("c"), "ai-service": sha("d") };
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
    "a moving tag": {
      api: "current",
      web: sha("b"),
      "mcp-admin": sha("c"),
      "ai-service": sha("d"),
    },
    "a short tag": { api: "abc1234", web: sha("b"), "mcp-admin": sha("c"), "ai-service": sha("d") },
    "an injection": {
      api: `${sha("a")};id`,
      web: sha("b"),
      "mcp-admin": sha("c"),
      "ai-service": sha("d"),
    },
    "a tag that is not a string": {
      api: 1,
      web: sha("b"),
      "mcp-admin": sha("c"),
      "ai-service": sha("d"),
    },
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

const REPOSITORY = "owner/site";
const GITHUB = `https://github.com/${REPOSITORY}`;
const images = { api: sha("a"), web: sha("b"), "mcp-admin": sha("c"), "ai-service": sha("d") };

describe("release notes", () => {
  const render = (commits, options = {}) =>
    releaseNotes({
      commits,
      tags: images,
      version: "v1.3.0",
      previous: "v1.2.3",
      repository: REPOSITORY,
      ...options,
    });

  const commits = [
    { sha: sha("1"), subject: "feat(web): add the services page (#12)", body: "" },
    { sha: sha("2"), subject: "fix(api): keep the order (#13)", body: "" },
    { sha: sha("3"), subject: "feat(api)!: drop the old route (#14)", body: "" },
    { sha: sha("4"), subject: "Merge pull request #15 from owner/phase", body: "" },
    { sha: sha("5"), subject: "docs: explain the release", body: "" },
    { sha: sha("6"), subject: "an old commit without a type", body: "" },
    { sha: sha("7"), subject: "Phase 09: RAG knowledge base (#16)", body: "" },
  ];

  it("puts the highlights first, breaking changes before the rest, then the compare link and the images last", () => {
    const notes = render(commits);
    const order = [
      "### Highlights",
      "### Breaking changes",
      "### Features",
      "### Fixes",
      "### Other changes",
      "**Full Changelog**",
      "### Images",
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
    assert.doesNotMatch(notes, /Merge pull request/);
    assert.ok(notes.endsWith("\n") && !notes.endsWith("\n\n"), "one final newline");
  });

  it("links pull request numbers, and the commit when there is no pull request", () => {
    const notes = render(commits);
    assert.match(notes, new RegExp(`keep the order \\(\\[#13\\]\\(${GITHUB}/pull/13\\)\\)`));
    assert.match(
      notes,
      new RegExp(`- explain the release \\(\\[5555555\\]\\(${GITHUB}/commit/${sha("5")}\\)\\)`),
    );
    assert.match(notes, /- an old commit without a type \(\[6666666\]/);
  });

  it("groups features and fixes by scope, scopes in alphabetical order and unscoped entries last", () => {
    const notes = render([
      { sha: sha("1"), subject: "feat(web): a page (#1)", body: "" },
      { sha: sha("2"), subject: "feat(api): a route (#2)", body: "" },
      { sha: sha("3"), subject: "feat(web): a menu (#3)", body: "" },
      { sha: sha("4"), subject: "feat: something general (#4)", body: "" },
      { sha: sha("5"), subject: "fix(api): a fix (#5)", body: "" },
    ]);
    const features = notes.slice(notes.indexOf("### Features"), notes.indexOf("### Fixes"));
    assert.equal(
      features,
      [
        "### Features",
        "",
        "- **api**",
        `  - a route ([#2](${GITHUB}/pull/2))`,
        "- **web**",
        `  - a page ([#1](${GITHUB}/pull/1))`,
        `  - a menu ([#3](${GITHUB}/pull/3))`,
        `- something general ([#4](${GITHUB}/pull/4))`,
        "",
        "",
      ].join("\n"),
    );
    assert.match(notes, new RegExp(`### Fixes\\n\\n- \\*\\*api\\*\\*\\n  - a fix \\(\\[#5\\]`));
  });

  it("says what a phase brought, from its pull request's summary, and lists it nowhere else", () => {
    const notes = render(commits, {
      phases: { 16: "## Summary\n\nSearch over approved sources.\n\n## Issues\n\n- #1" },
    });
    assert.match(
      notes,
      new RegExp(
        `### Highlights\\n\\n\\*\\*Phase 09: RAG knowledge base\\*\\* \\(\\[#16\\]\\(${GITHUB}/pull/16\\)\\): Search over approved sources\\.\\n`,
      ),
    );
    assert.equal(notes.match(/Phase 09/g)?.length, 1);
  });

  it("names the phase alone when its pull request's summary is unavailable", () => {
    const notes = render(commits);
    assert.match(
      notes,
      /### Highlights\n\n\*\*Phase 09: RAG knowledge base\*\* \(\[#16\]\([^)]+\)\)\.\n/,
    );
  });

  it("recognises a phase merged with GitHub's default header by its phase branch", () => {
    const notes = render([
      {
        sha: sha("8"),
        subject: "Merge pull request #21 from owner/phase/11-knowledge-graph",
        body: "Phase 11: Knowledge graph\n",
      },
      { sha: sha("9"), subject: "Merge pull request #22 from owner/fix/a-fix", body: "fix: a" },
      commit("fix: a (#1)"),
    ]);
    assert.match(notes, /### Highlights\n\n\*\*Phase 11: Knowledge graph\*\* \(\[#21\]/);
    assert.doesNotMatch(notes, /#22/);
  });

  it("leaves out the changelog commits of earlier releases", () => {
    const notes = render([
      commit("chore(release): changelog for v1.2.3 (#40)"),
      commit("fix(api): a fix (#41)"),
    ]);
    assert.doesNotMatch(notes, /changelog for/);
    assert.doesNotMatch(notes, /### Other changes/);
    assert.match(notes, /a fix/);
  });

  it("has no highlights without a phase merge", () => {
    assert.doesNotMatch(render([commit("fix: a (#1)")]), /Highlights/);
  });

  it("links the comparison with the previous version, or the history of the first one", () => {
    assert.match(
      render(commits),
      new RegExp(
        `\\*\\*Full Changelog\\*\\*: \\[v1\\.2\\.3\\.\\.\\.v1\\.3\\.0\\]\\(${GITHUB}/compare/v1\\.2\\.3\\.\\.\\.v1\\.3\\.0\\)`,
      ),
    );
    assert.match(
      render(commits, { version: "v0.1.0", previous: null }),
      new RegExp(`\\*\\*Full Changelog\\*\\*: \\[v0\\.1\\.0\\]\\(${GITHUB}/commits/v0\\.1\\.0\\)`),
    );
  });

  it("lists the deployed image of every service at the end", () => {
    const notes = render(commits);
    const imagesSection = notes.slice(notes.indexOf("### Images"));
    for (const service of ["api", "web", "mcp-admin", "ai-service"]) {
      assert.match(imagesSection, new RegExp(`sebela-${service}:${images[service]}`));
    }
  });

  it("leaves out empty groups", () => {
    const notes = render([commit("fix: a")]);
    assert.doesNotMatch(notes, /### Features/);
    assert.match(notes, /### Fixes/);
  });

  it("says in one line that a release without new commits re-releases the same commit", () => {
    const notes = render([commit("Merge branch 'master' into phase/x")], {
      version: "v0.2.1",
      previous: "v0.2.0",
    });
    const [first, ...rest] = notes.split("\n\n");
    assert.equal(first, "No changes since v0.2.0; re-release of the same commit.");
    assert.deepEqual(
      rest.filter((part) => part.startsWith("###")).map((part) => part.split("\n")[0]),
      ["### Images"],
    );
    assert.doesNotMatch(notes, /Full Changelog/);
  });

  it("puts a note given for the release first", () => {
    const notes = render([], {
      version: "v0.2.1",
      previous: "v0.2.0",
      note: "After a rollback test.",
    });
    assert.ok(notes.startsWith("After a rollback test.\n\nNo changes since v0.2.0"), notes);
  });

  it("can leave out the images when they are not known", () => {
    assert.doesNotMatch(render(commits, { tags: null }), /### Images/);
  });

  it("names the attached files of each image the release built and says the reused ones are attested where they were built", () => {
    const notes = render(commits, { built: ["api", "mcp-admin"] });
    const imagesSection = notes.slice(notes.indexOf("### Images"));
    assert.ok(
      imagesSection.includes(
        `- \`ghcr.io/sebelapetr/sebela-api:${images.api}\`, built for this release: \`sebela-api-v1.3.0.spdx.json\` and \`sebela-api-v1.3.0.intoto.jsonl\` are attached.\n`,
      ),
      imagesSection,
    );
    assert.ok(
      imagesSection.includes(
        `- \`ghcr.io/sebelapetr/sebela-mcp-admin:${images["mcp-admin"]}\`, built for this release: \`sebela-mcp-admin-v1.3.0.spdx.json\` and \`sebela-mcp-admin-v1.3.0.intoto.jsonl\` are attached.\n`,
      ),
      imagesSection,
    );
    assert.ok(
      imagesSection.includes(
        `- \`ghcr.io/sebelapetr/sebela-web:${images.web}\`, reused unchanged: no files are attached for it; its SBOM and provenance attestations were made by the release run that built it and are stored beside it in GHCR.\n`,
      ),
      imagesSection,
    );
    assert.match(
      imagesSection,
      new RegExp(
        `How to verify the files and the images: \\[docs/release-workflow\\.md\\]\\(${GITHUB}/blob/master/docs/release-workflow\\.md#release-files\\)\\.\n$`,
      ),
    );
  });

  it("keeps the plain list of images when it is not known which were built", () => {
    const notes = render(commits);
    assert.ok(
      notes.endsWith(`- \`ghcr.io/sebelapetr/sebela-ai-service:${images["ai-service"]}\`\n`),
    );
    assert.doesNotMatch(notes, /attached|reused/);
  });

  it("refuses a built list that names an unknown service", () => {
    assert.throws(() => render(commits, { built: ["api", "worker"] }), /unknown service/i);
  });
});

describe("phase merges", () => {
  it("are the commits whose subject names a phase and its pull request", () => {
    assert.deepEqual(
      phasePullRequests([
        commit("Phase 09: RAG knowledge base (#280)"),
        commit("Phase 03-web (#125)"),
        commit("feat(web): a phase page (#3)"),
        commit("Phase 1 without a pull request"),
        commit("Merge pull request #300 from owner/phase/11-knowledge-graph"),
        commit("Merge pull request #301 from owner/feat/1-a-page"),
      ]),
      [280, 125, 300],
    );
  });
});

describe("phase summary", () => {
  it("is the first paragraph of the Summary or Highlights section, on one line", () => {
    assert.equal(
      phaseSummary(
        "Draft.\n\n## Summary\n\nSearch over\napproved sources.\n\nMore.\n\n## Issues\n- #1",
      ),
      "Search over approved sources.",
    );
    assert.equal(
      phaseSummary("## Highlights\n\n- a list first\n\nThe site goes live.\n"),
      "The site goes live.",
    );
  });

  it("ends the section at a heading of any level, with or without a blank line before it", () => {
    assert.equal(
      phaseSummary("## Summary\n\nThe site goes live.\n### Issues\n\n- #1"),
      "The site goes live.",
    );
    assert.equal(phaseSummary("## Summary\n### Notes\n\nNot the summary."), null);
    assert.equal(phaseSummary("## Summary\n\n#### Notes\n\nNot the summary."), null);
  });

  it("never lets an HTML comment opener through, closed, unclosed or nested", () => {
    for (const body of [
      "## Summary\n\n<!-- draft: write this later\n\nThe phase adds search.",
      "## Summary\n\n<!<!-- x -->-- hidden",
      "## Summary\n\nSearch <!<!-- x -->-- arrives.",
      "## Summary\n\n<!--\n\nhidden\n\n-->\n\nThe phase adds search.",
    ]) {
      const summary = phaseSummary(body);
      assert.ok(
        summary === null || !summary.includes("<!--"),
        `${JSON.stringify(body)} gave ${summary}`,
      );
      assert.ok(summary === null || !summary.includes("<"), `no raw HTML: ${summary}`);
    }
    assert.equal(
      phaseSummary("## Summary\n\n<!-- draft: write this later\n\nThe phase adds search."),
      null,
    );
    assert.equal(
      phaseSummary("## Summary\n\n<!--\n\nhidden\n\n-->\n\nThe phase adds search."),
      "The phase adds search.",
    );
    assert.equal(
      phaseSummary("## Summary\n\nSearch for a <b>term</b>."),
      "Search for a &lt;b>term&lt;/b>.",
    );
  });

  it("is null without such a section: status notes and issue lists are no summary", () => {
    assert.equal(
      phaseSummary(
        "Phase 10 — Continuous delivery.\n\nMerged issues:\n- #232\n\nSkipped/failed: none.",
      ),
      null,
    );
    assert.equal(phaseSummary("## Summary\n\n- only a list\n\n## Issues\n\nText."), null);
    assert.equal(
      phaseSummary(
        "## Summary\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n",
      ),
      null,
    );
    assert.equal(phaseSummary(""), null);
    assert.equal(phaseSummary(undefined), null);
  });
});

describe("changelog", () => {
  const notesOf = (version) => `### Fixes\n\n- a fix in ${version}\n`;

  it("starts the file with its header, the section and the link to the release", () => {
    const changelog = addToChangelog("", {
      version: "v0.1.0",
      date: "2026-11-21",
      notes: notesOf("v0.1.0"),
      repository: REPOSITORY,
    });
    assert.match(changelog, /^# Changelog\n\n/);
    assert.match(changelog, /keepachangelog\.com/);
    assert.ok(
      changelog.includes(`## [v0.1.0] - 2026-11-21\n\n${notesOf("v0.1.0")}`),
      "the section is the release notes under the version heading",
    );
    assert.ok(changelog.endsWith(`\n[v0.1.0]: ${GITHUB}/releases/tag/v0.1.0\n`), changelog);
  });

  it("puts a newer version first, its section and its link", () => {
    const first = addToChangelog("", {
      version: "v0.1.0",
      date: "2026-11-20",
      notes: notesOf("v0.1.0"),
      repository: REPOSITORY,
    });
    const second = addToChangelog(first, {
      version: "v0.2.0",
      date: "2026-11-21",
      notes: notesOf("v0.2.0"),
      repository: REPOSITORY,
    });
    assert.ok(second.indexOf("## [v0.2.0]") < second.indexOf("## [v0.1.0]"));
    assert.ok(
      second.endsWith(
        `\n[v0.2.0]: ${GITHUB}/releases/tag/v0.2.0\n[v0.1.0]: ${GITHUB}/releases/tag/v0.1.0\n`,
      ),
      second,
    );
    assert.equal(second.match(/^# Changelog/gm)?.length, 1);
  });

  it("refuses a version it already has", () => {
    const changelog = addToChangelog("", {
      version: "v0.1.0",
      date: "2026-11-21",
      notes: notesOf("v0.1.0"),
      repository: REPOSITORY,
    });
    assert.throws(
      () =>
        addToChangelog(changelog, {
          version: "v0.1.0",
          date: "2026-11-21",
          notes: notesOf("v0.1.0"),
          repository: REPOSITORY,
        }),
      /already/,
    );
  });

  it("is the same document whether built at once or one release at a time", () => {
    const releases = [
      { version: "v0.1.0", date: "2026-11-20", notes: notesOf("v0.1.0") },
      { version: "v0.2.0", date: "2026-11-21", notes: notesOf("v0.2.0") },
    ];
    const stepwise = releases.reduce(
      (changelog, release) => addToChangelog(changelog, { ...release, repository: REPOSITORY }),
      "",
    );
    assert.equal(changelogDocument({ releases, repository: REPOSITORY }), stepwise);
  });
});

describe("release commands", () => {
  const script = path.join(import.meta.dirname, "deployment.mjs");

  function repository() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-notes-"));
    const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
    git("init", "--quiet");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    git("config", "tag.gpgsign", "false");
    const commitAs = (subject, date = "2026-11-20T12:00:00Z") => {
      execFileSync("git", ["commit", "--quiet", "--allow-empty", "--message", subject], {
        cwd: directory,
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      });
      return git("rev-parse", "HEAD");
    };
    return { directory, git, commitAs };
  }

  // A stand-in `gh` first on PATH: `pr view <number> ...` prints the body in bodies/<number>, or
  // fails like an unreachable GitHub when there is none. It records each call.
  function fakeGh(directory, bodies = {}) {
    const bin = path.join(directory, "bin");
    fs.mkdirSync(path.join(bin, "bodies"), { recursive: true });
    for (const [number, body] of Object.entries(bodies)) {
      fs.writeFileSync(path.join(bin, "bodies", number), body);
    }
    fs.writeFileSync(
      path.join(bin, "gh"),
      [
        "#!/bin/sh",
        `echo "$*" >> "${path.join(bin, "calls")}"`,
        `body="${path.join(bin, "bodies")}/$3"`,
        '[ "$1 $2" = "pr view" ] && [ -f "$body" ] && cat "$body" && exit 0',
        'echo "gh: could not reach GitHub" >&2',
        "exit 1",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const calls = () => {
      const file = path.join(bin, "calls");
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n") : [];
    };
    return { PATH: `${bin}${path.delimiter}${process.env.PATH}`, calls };
  }

  function run(directory, command, env) {
    const stdout = execFileSync(process.execPath, [script, command], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, GITHUB_REPOSITORY: REPOSITORY, ...env },
    });
    return Object.fromEntries(
      stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("=")),
    );
  }

  const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");

  function notes(directory, commitSha, gh = fakeGh(directory), extra = {}) {
    const notesFile = path.join(directory, "notes.md");
    const summary = path.join(directory, "summary.md");
    const outputs = run(directory, "notes", {
      PATH: gh.PATH,
      SHA: commitSha,
      TAGS: JSON.stringify(images),
      NOTES_FILE: notesFile,
      GITHUB_STEP_SUMMARY: summary,
      ...extra,
    });
    return { outputs, notes: read(notesFile), summary: read(summary) };
  }

  describe("notes", () => {
    it("releases the next version of a commit without a version tag", () => {
      const { directory, git, commitAs } = repository();
      commitAs("feat(web): a page");
      git("tag", "v0.2.0");
      const head = commitAs("fix(api): a fix (#7)");
      const result = notes(directory, head);
      assert.deepEqual(result.outputs, { release: "true", version: "v0.2.1" });
      assert.match(result.notes, new RegExp(`a fix \\(\\[#7\\]\\(${GITHUB}/pull/7\\)\\)`));
      assert.match(result.notes, new RegExp(`${GITHUB}/compare/v0\\.2\\.0\\.\\.\\.v0\\.2\\.1`));
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

    it("takes the highlights from the phase pull request's summary", () => {
      const { directory, git, commitAs } = repository();
      commitAs("feat(web): a page");
      git("tag", "v0.1.0");
      commitAs("feat(api): a route (#3)");
      const head = commitAs("Phase 02: API and database (#4)");
      const gh = fakeGh(directory, { 4: "## Summary\n\nThe content API.\n" });
      const result = notes(directory, head, gh);
      assert.match(
        result.notes,
        /### Highlights\n\n\*\*Phase 02: API and database\*\* \(\[#4\]\([^)]+\)\): The content API\.\n/,
      );
      assert.deepEqual(gh.calls(), [`pr view 4 --repo ${REPOSITORY} --json body --jq .body`]);
    });

    it("names the files attached for the images built, from BUILT", () => {
      const { directory, git, commitAs } = repository();
      commitAs("feat(web): a page");
      git("tag", "v0.2.0");
      const head = commitAs("fix(api): a fix (#7)");
      const result = notes(directory, head, fakeGh(directory), { BUILT: '["api"]' });
      assert.match(result.notes, /built for this release: `sebela-api-v0\.2\.1\.spdx\.json`/);
      assert.match(result.notes, /sebela-web:b{40}`, reused unchanged/);
    });

    it("still publishes the notes when GitHub cannot say what the phase brought", () => {
      const { directory, git, commitAs } = repository();
      commitAs("feat(web): a page");
      git("tag", "v0.1.0");
      const head = commitAs("Phase 02: API and database (#4)");
      const result = notes(directory, head);
      assert.deepEqual(result.outputs, { release: "true", version: "v0.1.1" });
      assert.match(result.notes, /\*\*Phase 02: API and database\*\* \(\[#4\]\([^)]+\)\)\.\n/);
    });
  });

  describe("changelog entry", () => {
    it("adds the release notes as the newest section of the changelog, and nothing else", () => {
      const { directory, git, commitAs } = repository();
      commitAs("feat(web): a page");
      git("tag", "v0.1.0");
      const head = commitAs("fix(api): a fix (#7)");
      const result = notes(directory, head);
      const changelogFile = path.join(directory, "CHANGELOG.md");
      fs.writeFileSync(
        changelogFile,
        addToChangelog("", {
          version: "v0.1.0",
          date: "2026-11-20",
          notes: "### Features\n\n- a page\n",
          repository: REPOSITORY,
        }),
      );
      run(directory, "changelog-entry", {
        VERSION: "v0.1.1",
        NOTES_FILE: path.join(directory, "notes.md"),
        CHANGELOG_FILE: changelogFile,
        DATE: "2026-11-21",
      });
      const changelog = read(changelogFile);
      assert.ok(changelog.includes(`## [v0.1.1] - 2026-11-21\n\n${result.notes}\n## [v0.1.0]`));
      assert.match(changelog, /\[v0\.1\.1\]: .*\/releases\/tag\/v0\.1\.1\n\[v0\.1\.0\]:/);
    });

    it("refuses a version that is not a vX.Y.Z tag", () => {
      const { directory } = repository();
      fs.writeFileSync(path.join(directory, "notes.md"), "notes\n");
      assert.throws(() =>
        run(directory, "changelog-entry", {
          VERSION: "latest",
          NOTES_FILE: path.join(directory, "notes.md"),
          CHANGELOG_FILE: path.join(directory, "CHANGELOG.md"),
          DATE: "2026-11-21",
        }),
      );
    });
  });

  describe("changelog", () => {
    function released() {
      const { directory, git, commitAs } = repository();
      commitAs("feat(web): a page (#1)", "2026-11-19T12:00:00Z");
      git("tag", "v0.1.0");
      commitAs("feat(api): a route (#2)");
      commitAs("Phase 02: API and database (#3)", "2026-11-21T09:00:00Z");
      git("tag", "v0.2.0");
      git("tag", "v0.2.1");
      const releasesFile = path.join(directory, "releases.json");
      fs.writeFileSync(
        releasesFile,
        JSON.stringify({
          "v0.1.0": { tags: images },
          "v0.2.0": { date: "2026-11-21", tags: images },
          "v0.2.1": { date: "2026-11-21", tags: images, note: "Rerun after a rollback test." },
        }),
      );
      return { directory, releasesFile };
    }

    function rebuild(directory, releasesFile, gh = fakeGh(directory)) {
      const changelogFile = path.join(directory, "CHANGELOG.md");
      run(directory, "changelog", {
        PATH: gh.PATH,
        RELEASES_FILE: releasesFile,
        CHANGELOG_FILE: changelogFile,
      });
      return read(changelogFile);
    }

    it("rebuilds every version from the tags, newest first", () => {
      const { directory, releasesFile } = released();
      const changelog = rebuild(directory, releasesFile);
      const headings = changelog.match(/^## .*$/gm);
      assert.deepEqual(headings, [
        "## [v0.2.1] - 2026-11-21",
        "## [v0.2.0] - 2026-11-21",
        "## [v0.1.0] - 2026-11-19",
      ]);
      const section = (version) => {
        const start = changelog.indexOf(`## [${version}]`);
        const next = changelog.indexOf("\n## [", start + 1);
        return changelog.slice(start, next === -1 ? changelog.indexOf("\n[v", start) : next);
      };
      assert.match(
        section("v0.2.1"),
        /Rerun after a rollback test\.\n\nNo changes since v0\.2\.0; re-release of the same commit\./,
      );
      assert.match(section("v0.2.0"), /a route/);
      assert.match(section("v0.2.0"), /### Highlights/);
      assert.doesNotMatch(section("v0.2.0"), /a page/);
      assert.match(section("v0.1.0"), /a page/);
      assert.match(section("v0.1.0"), new RegExp(`${GITHUB}/commits/v0\\.1\\.0`));
    });

    it("renders the attached files of a version whose built images the releases file gives", () => {
      const { directory, releasesFile } = released();
      const known = JSON.parse(fs.readFileSync(releasesFile, "utf8"));
      known["v0.2.1"].built = ["web"];
      fs.writeFileSync(releasesFile, JSON.stringify(known));
      const changelog = rebuild(directory, releasesFile);
      assert.match(
        changelog,
        /`sebela-web-v0\.2\.1\.spdx\.json` and `sebela-web-v0\.2\.1\.intoto\.jsonl`/,
      );
      assert.doesNotMatch(changelog, /sebela-web-v0\.2\.0/);
    });

    it("writes the same file every time", () => {
      const { directory, releasesFile } = released();
      const gh = fakeGh(directory, { 3: "## Summary\n\nThe content API.\n" });
      const first = rebuild(directory, releasesFile, gh);
      assert.match(first, /The content API\./);
      assert.equal(rebuild(directory, releasesFile, gh), first);
    });
  });
});
