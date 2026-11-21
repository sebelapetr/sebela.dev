// Behaviour of the release decisions (docs/release-workflow.md, "Images"): which services a change
// affects, and which images a release builds and which current images it reuses, judged for each
// service against the commit of its current image. The
// fixtures hold real `turbo query affected --packages` output, captured on synthetic commits of
// this repository, with the files each commit changed and the services it must select. The command
// line around these decisions (Turborepo, git, docker) is exercised by the release workflow, apart
// from `build` and `publish`, which run here against a stand-in `docker` that records its
// arguments (and, for `publish`, answers as a registry would).

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  SERVICES,
  affectedPackages,
  affectedServices,
  affectedSinceFor,
  formatOutputs,
  manifestDigest,
  releasePlan,
  revisionLabel,
  staleServices,
} from "./images.mjs";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "affected-services");
const fixtures = fs
  .readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({ name, ...JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) }));

describe("affected services", () => {
  it("has the fixtures the issue names", () => {
    const names = fixtures.map(({ name }) => name);
    for (const name of [
      "single-app",
      "shared-package",
      "docs-only",
      "workflow-only",
      "changelog-only",
    ]) {
      assert.ok(names.includes(`${name}.json`), `fixture ${name}`);
    }
  });

  for (const fixture of fixtures) {
    it(`${fixture.name}: ${fixture.description}`, () => {
      assert.deepEqual(
        affectedServices({
          packages: affectedPackages(fixture.turbo),
          changedFiles: fixture.changedFiles,
        }),
        fixture.services,
      );
    });
  }

  it("lists the services in a fixed order", () => {
    assert.deepEqual(SERVICES, ["api", "web", "mcp-admin"]);
    assert.deepEqual(
      affectedServices({ packages: ["@sebela/mcp-admin", "@sebela/api"], changedFiles: [] }),
      ["api", "mcp-admin"],
    );
  });

  it("refuses output that is not Turborepo's affected packages", () => {
    assert.throws(() => affectedPackages({}), /affected packages/);
    assert.throws(() => affectedPackages({ data: { affectedPackages: { items: [{}] } } }));
    assert.throws(() => affectedPackages(null));
  });
});

// A history A - B - C - D on master. `ancestors` lists, for the release commit, the commits that
// are its ancestors (or itself); `changes` maps a current image's commit to the services affected
// between it and the release commit.
const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccccccccccccccccc";
const D = "dddddddddddddddddddddddddddddddddddddddd";

function history({ ancestors, changes = {} }) {
  const asked = [];
  return {
    asked,
    isAncestor: (revision) => ancestors.includes(revision),
    affectedSince: (revision) => {
      asked.push(revision);
      if (!(revision in changes)) throw new Error(`no changes recorded since ${revision}`);
      return changes[revision];
    },
  };
}

describe("release plan", () => {
  it("builds what changed since each service's current image and reuses the rest", () => {
    const git = history({ ancestors: [A, B, C], changes: { [B]: ["web"] } });
    assert.deepEqual(
      releasePlan({
        sha: C,
        current: { api: B, web: B, "mcp-admin": B },
        isAncestor: git.isAncestor,
        affectedSince: git.affectedSince,
      }),
      {
        build: ["web"],
        reuse: ["api", "mcp-admin"],
        tags: { api: B, web: C, "mcp-admin": B },
      },
    );
  });

  it("still builds a change whose own release failed, on the next push that changes nothing of it", () => {
    // B changed the API and its release failed verification, so api:current is still A. C changes
    // only the documentation, yet the API has changed since its current image.
    const git = history({ ancestors: [A, B, C], changes: { [A]: ["api"] } });
    assert.deepEqual(
      releasePlan({
        sha: C,
        current: { api: A, web: A, "mcp-admin": A },
        isAncestor: git.isAncestor,
        affectedSince: git.affectedSince,
      }),
      {
        build: ["api"],
        reuse: ["web", "mcp-admin"],
        tags: { api: C, web: A, "mcp-admin": A },
      },
    );
  });

  it("asks once per current commit", () => {
    const git = history({ ancestors: [A, B, C], changes: { [A]: [], [B]: [] } });
    releasePlan({
      sha: C,
      current: { api: A, web: B, "mcp-admin": A },
      isAncestor: git.isAncestor,
      affectedSince: git.affectedSince,
    });
    assert.deepEqual(git.asked.sort(), [A, B]);
  });

  it("reuses every image of a release that was already published", () => {
    const git = history({ ancestors: [A, B, C], changes: { [C]: [] } });
    assert.deepEqual(
      releasePlan({
        sha: C,
        current: { api: C, web: C, "mcp-admin": C },
        isAncestor: git.isAncestor,
        affectedSince: git.affectedSince,
      }),
      {
        build: [],
        reuse: SERVICES,
        tags: { api: C, web: C, "mcp-admin": C },
      },
    );
  });

  it("builds a service that has no current image, or one that names no commit", () => {
    const git = history({ ancestors: [A, B, C], changes: { [A]: [] } });
    assert.deepEqual(
      releasePlan({
        sha: C,
        current: { api: null, web: "latest", "mcp-admin": A },
        isAncestor: git.isAncestor,
        affectedSince: git.affectedSince,
      }),
      { build: ["api", "web"], reuse: ["mcp-admin"], tags: { api: C, web: C, "mcp-admin": A } },
    );
    assert.deepEqual(
      releasePlan({
        sha: C,
        current: {},
        isAncestor: git.isAncestor,
        affectedSince: git.affectedSince,
      }).build,
      SERVICES,
    );
  });

  it("refuses a release older than a current image: a rerun must not go backwards", () => {
    // D was released after B; rerunning B's release would move api:current back to B.
    const git = history({ ancestors: [A, B], changes: { [A]: ["api"] } });
    assert.throws(
      () =>
        releasePlan({
          sha: B,
          current: { api: D, web: A, "mcp-admin": A },
          isAncestor: git.isAncestor,
          affectedSince: git.affectedSince,
        }),
      /api.*dddddddd.*not an ancestor/s,
    );
  });

  it("refuses a malformed release commit", () => {
    const git = history({ ancestors: [] });
    assert.throws(
      () =>
        releasePlan({
          sha: "main",
          current: {},
          isAncestor: git.isAncestor,
          affectedSince: git.affectedSince,
        }),
      /commit/,
    );
  });
});

// The changelog pull request the release job opens after publishing a version (docs/release-workflow.md,
// "Changelog") changes only CHANGELOG.md. Merging it must release nothing, or every release would
// open the next changelog pull request.
describe("no release loop", () => {
  const changelogOnly = fixtures.find(({ name }) => name === "changelog-only.json");

  it("merging the changelog pull request builds no image, so no version and no changelog follow", () => {
    const services = affectedServices({
      packages: affectedPackages(changelogOnly.turbo),
      changedFiles: changelogOnly.changedFiles,
    });
    // The release commit B carries the current images; C is the merged changelog commit.
    const git = history({ ancestors: [A, B, C], changes: { [B]: services } });
    const plan = releasePlan({
      sha: C,
      current: { api: B, web: B, "mcp-admin": B },
      isAncestor: git.isAncestor,
      affectedSince: git.affectedSince,
    });
    assert.deepEqual(plan.build, []);
    assert.match(formatOutputs({ ...plan, release: plan.build.length > 0 }), /^release=false$/m);
  });
});

// The affected services of a change from a current image's commit, on a disposable Git repository
// with a stand-in `turbo` that records the comparison it is given and answers with the apps whose
// files differ in it. Documentation is no change: Turborepo is handed the change without it.
describe("affected since a current image", () => {
  function git(cwd, ...args) {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  }

  function write(root, file, text) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }

  function setup(t, change) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "images-affected-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    git(root, "init", "--quiet", "--initial-branch=main");
    git(root, "config", "user.email", "fixture@example.invalid");
    git(root, "config", "user.name", "Fixture");
    write(root, "apps/api/src/app.ts", "export const app = 1;\n");
    write(root, "apps/api/AGENTS.md", "# API\n");
    git(root, "add", "--all");
    git(root, "commit", "--quiet", "--message", "base");
    const base = git(root, "rev-parse", "HEAD");
    change(root);
    git(root, "add", "--all");
    git(root, "commit", "--quiet", "--message", "head");
    const head = git(root, "rev-parse", "HEAD");

    const record = path.join(root, ".git", "turbo-calls.json");
    const turbo = path.join(root, ".git", "turbo");
    fs.writeFileSync(
      turbo,
      `#!${process.execPath}
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const { TURBO_SCM_BASE: base, TURBO_SCM_HEAD: head } = process.env;
const files = execFileSync("git", ["diff", "--name-only", base + "..." + head], { encoding: "utf8" })
  .split("\\n").filter(Boolean);
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), base, head, files }));
const apps = [...new Set(files.filter((f) => f.startsWith("apps/")).map((f) => f.split("/")[1]))];
process.stdout.write(JSON.stringify({ data: { affectedPackages: { items: apps.map((app) => ({ name: "@sebela/" + app })) } } }));
`,
    );
    fs.chmodSync(turbo, 0o755);
    const lines = [];
    const services = affectedSinceFor(head, { cwd: root, turbo, log: (line) => lines.push(line) })(
      base,
    );
    return { base, head, services, lines, call: JSON.parse(fs.readFileSync(record, "utf8")) };
  }

  it("builds no image for a change of documentation alone", (t) => {
    const { base, head, services, lines, call } = setup(t, (root) => {
      write(root, "apps/api/AGENTS.md", "# API, edited\n");
    });
    assert.deepEqual(services, []);
    assert.deepEqual(call.args, ["query", "affected", "--packages"]);
    assert.equal(call.base, base);
    assert.notEqual(call.head, head);
    assert.deepEqual(call.files, []);
    assert.ok(lines.includes("  documentation, no change: apps/api/AGENTS.md"), lines.join("\n"));
    assert.ok(lines.includes("  changed files: none"), lines.join("\n"));
  });

  it("builds the app whose code changed beside its documentation", (t) => {
    const { services, lines, call } = setup(t, (root) => {
      write(root, "apps/api/AGENTS.md", "# API, edited\n");
      write(root, "apps/api/src/app.ts", "export const app = 2;\n");
    });
    assert.deepEqual(services, ["api"]);
    assert.deepEqual(call.files, ["apps/api/src/app.ts"]);
    assert.ok(lines.includes("  changed files: apps/api/src/app.ts"), lines.join("\n"));
  });
});

describe("stale services", () => {
  it("are those whose current image is not an ancestor of the release commit", () => {
    const { isAncestor } = history({ ancestors: [A, B, C] });
    assert.deepEqual(
      staleServices({ current: { api: D, web: B, "mcp-admin": null }, isAncestor }),
      ["api"],
    );
    assert.deepEqual(staleServices({ current: { api: A }, isAncestor }), []);
  });
});

describe("revision label", () => {
  const labels = { "org.opencontainers.image.revision": A };

  it("reads the label of a single-platform image", () => {
    assert.equal(revisionLabel({ architecture: "arm64", config: { Labels: labels } }), A);
  });

  it("reads the arm64 image of an index", () => {
    assert.equal(
      revisionLabel({
        "linux/amd64": { config: { Labels: { "org.opencontainers.image.revision": B } } },
        "linux/arm64": { config: { Labels: labels } },
      }),
      A,
    );
  });

  it("is null when there is no such label or no arm64 image", () => {
    assert.equal(revisionLabel({ config: {} }), null);
    assert.equal(revisionLabel({ config: { Labels: null } }), null);
    assert.equal(revisionLabel({ "linux/amd64": { config: { Labels: labels } } }), null);
    assert.equal(revisionLabel(null), null);
  });
});

describe("workflow outputs", () => {
  it("writes one key=value line per output, values as JSON", () => {
    assert.equal(
      formatOutputs({ build: ["web"], release: true, tags: { web: C } }),
      `build=["web"]\nrelease=true\ntags={"web":"${C}"}\n`,
    );
  });
});

describe("the build command", () => {
  it("builds each planned service with its build output on the job log", () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "images-build-"));
    const calls = path.join(bin, "calls");
    const docker = path.join(bin, "docker");
    fs.writeFileSync(docker, `#!/bin/sh\necho "$@" >> "${calls}"\necho "build output"\n`);
    fs.chmodSync(docker, 0o755);
    try {
      const result = spawnSync(
        process.execPath,
        [path.join(import.meta.dirname, "images.mjs"), "build"],
        {
          encoding: "utf8",
          env: {
            PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
            SHA: C,
            BUILD: JSON.stringify(["api", "web"]),
            GITHUB_SERVER_URL: "https://github.example.test",
            GITHUB_REPOSITORY: "owner/repository",
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /build output/);
      const lines = fs.readFileSync(calls, "utf8").trim().split("\n");
      assert.equal(lines.length, 2);
      assert.match(lines[0] ?? "", new RegExp(`^build .*sebela-api:${C} \\.$`));
      assert.match(lines[1] ?? "", new RegExp(`^build .*sebela-web:${C} \\.$`));
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });
});

const DIGEST = `sha256:${"0123456789abcdef".repeat(4)}`;

describe("manifest digest", () => {
  it("is the digest of the pushed manifest or index", () => {
    const descriptor = {
      mediaType: "application/vnd.oci.image.index.v1+json",
      digest: DIGEST,
      size: 856,
    };
    assert.equal(manifestDigest(descriptor), DIGEST);
  });

  it("refuses a descriptor without a SHA-256 digest", () => {
    assert.throws(() => manifestDigest({ digest: "sha512:abc" }), /SHA-256/);
    assert.throws(() => manifestDigest({ digest: `${DIGEST}0` }), /SHA-256/);
    assert.throws(() => manifestDigest({}), /SHA-256/);
    assert.throws(() => manifestDigest(null), /SHA-256/);
  });
});

describe("the publish command", () => {
  /** Runs `publish` against a stand-in docker; `manifest` is what it prints for a pushed tag. */
  function publish(manifest) {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "images-publish-"));
    const calls = path.join(bin, "calls");
    const docker = path.join(bin, "docker");
    fs.writeFileSync(
      docker,
      [
        "#!/bin/sh",
        `echo "$@" >> "${calls}"`,
        'case "$*" in',
        // No service has a current image yet, so nothing is stale.
        '  "buildx imagetools inspect --format {{json .Image}} "*) exit 1 ;;',
        `  "buildx imagetools inspect --format {{json .Manifest}} "*) echo '${manifest}' ;;`,
        '  push*) echo "pushed" ;;',
        "esac",
        "",
      ].join("\n"),
    );
    fs.chmodSync(docker, 0o755);
    try {
      const result = spawnSync(
        process.execPath,
        [path.join(import.meta.dirname, "images.mjs"), "publish"],
        {
          encoding: "utf8",
          env: {
            PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
            SHA: C,
            BUILD: JSON.stringify(["api", "mcp-admin"]),
          },
        },
      );
      return { ...result, calls: fs.readFileSync(calls, "utf8").trim().split("\n") };
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  }

  it("prints the pushed digest of each built image as the output `digests`", () => {
    const result = publish(JSON.stringify({ mediaType: "m", digest: DIGEST, size: 1 }));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      `digests=${JSON.stringify({ api: DIGEST, "mcp-admin": DIGEST })}\n`,
    );
    const pushes = result.calls.filter((line) => line.startsWith("push"));
    assert.deepEqual(pushes, [
      `push --quiet ghcr.io/sebelapetr/sebela-api:${C}`,
      `push --quiet ghcr.io/sebelapetr/sebela-mcp-admin:${C}`,
      "push --quiet ghcr.io/sebelapetr/sebela-api:current",
      "push --quiet ghcr.io/sebelapetr/sebela-mcp-admin:current",
    ]);
    // The digest is read from the registry by the commit tag, after that tag is pushed.
    const inspected = result.calls.indexOf(
      `buildx imagetools inspect --format {{json .Manifest}} ghcr.io/sebelapetr/sebela-api:${C}`,
    );
    assert.ok(inspected > result.calls.indexOf(`push --quiet ghcr.io/sebelapetr/sebela-api:${C}`));
  });

  it("fails, moving no `current` tag, when the registry names no digest", () => {
    const result = publish(JSON.stringify({ mediaType: "m", size: 1 }));
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /SHA-256/);
    assert.ok(!result.calls.some((line) => line.endsWith(":current") && line.startsWith("push")));
  });
});
