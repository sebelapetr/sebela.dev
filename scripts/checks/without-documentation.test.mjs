// Behaviour of the documentation filter CI and the release plan apply before deciding what a change
// affects (docs/testing.md, CI): the change without its documentation, observed through the command
// line in a disposable Git repository. Which files are documentation is tested with its rule
// (harness/lib/documentation.test.mjs); the last tests keep it honest against the files of this
// repository that code reads.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { isDocumentation } from "./without-documentation.mjs";

const SCRIPT = path.join(import.meta.dirname, "without-documentation.mjs");
const REPOSITORY = path.resolve(import.meta.dirname, "..", "..");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function write(root, file, text) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

/**
 * A repository with a base commit of code and documentation; `change` edits it for the head. It is
 * removed after the test `t`.
 */
function repository(t, change) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "without-documentation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "Fixture");
  write(root, "apps/api/src/app.ts", "export const app = 1;\n");
  write(root, "apps/api/AGENTS.md", "# API\n");
  write(root, "docs/testing.md", "# Testing\n");
  write(root, "docs/old.md", "# Old\n");
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "--message", "base");
  const base = git(root, "rev-parse", "HEAD");
  change(root);
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "--message", "head", "--allow-empty");
  return { root, base, head: git(root, "rev-parse", "HEAD") };
}

function run(cwd, ...args) {
  // No identity of its own: CI runners have no Git user configured.
  const env = { ...process.env, HOME: cwd, GIT_CONFIG_NOSYSTEM: "1" };
  for (const name of Object.keys(env)) if (/^GIT_(AUTHOR|COMMITTER)_/.test(name)) delete env[name];
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8", env });
}

/** The files that differ between two commits, sorted. */
function diff(root, from, to) {
  return git(root, "diff", "--name-only", "--no-renames", from, to)
    .split("\n")
    .filter(Boolean)
    .sort();
}

describe("the change without its documentation", () => {
  it("leaves no file changed when only documentation changed", (t) => {
    const { root, base, head } = repository(t, (dir) => {
      write(dir, "apps/api/AGENTS.md", "# API, edited\n");
      write(dir, "docs/new.md", "# New\n");
      fs.rmSync(path.join(dir, "docs/old.md"));
    });
    const result = run(root, "head", base);
    assert.equal(result.status, 0, result.stderr);
    const filtered = result.stdout.trim();
    assert.notEqual(filtered, head);
    assert.deepEqual(diff(root, base, filtered), []);
    assert.equal(git(root, "rev-parse", `${filtered}^`), head);
    assert.match(result.stderr, /apps\/api\/AGENTS\.md/);
    assert.match(result.stderr, /docs\/new\.md/);
    assert.match(result.stderr, /docs\/old\.md/);
  });

  it("keeps the code of a mixed change and drops its documentation", (t) => {
    const { root, base } = repository(t, (dir) => {
      write(dir, "apps/api/src/app.ts", "export const app = 2;\n");
      write(dir, "apps/api/AGENTS.md", "# API, edited\n");
    });
    const filtered = run(root, "head", base).stdout.trim();
    assert.deepEqual(diff(root, base, filtered), ["apps/api/src/app.ts"]);
    assert.equal(git(root, "show", `${filtered}:apps/api/src/app.ts`), "export const app = 2;");
    assert.equal(git(root, "show", `${filtered}:apps/api/AGENTS.md`), "# API");

    const files = run(root, "files", base);
    assert.equal(files.status, 0, files.stderr);
    assert.equal(files.stdout, "apps/api/src/app.ts\n");
  });

  it("is the head itself when no documentation changed", (t) => {
    const { root, base, head } = repository(t, (dir) => {
      write(dir, "apps/api/src/app.ts", "export const app = 2;\n");
    });
    assert.equal(run(root, "head", base).stdout.trim(), head);
  });

  it("compares from the merge base, as Turborepo does", (t) => {
    const { root, base, head } = repository(t, (dir) => {
      write(dir, "docs/testing.md", "# Testing, edited\n");
    });
    // The base branch moves on with a code change the head does not have.
    git(root, "checkout", "--quiet", "--detach", base);
    write(root, "apps/api/src/app.ts", "export const app = 3;\n");
    git(root, "commit", "--quiet", "--all", "--message", "base moves on");
    const movedBase = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "--quiet", head);
    const filtered = run(root, "head", movedBase).stdout.trim();
    assert.deepEqual(diff(root, base, filtered), []);
    assert.equal(run(root, "files", movedBase).stdout, "");
  });

  it("gives the same commit for the same change", (t) => {
    const { root, base } = repository(t, (dir) => {
      write(dir, "docs/testing.md", "# Testing, edited\n");
    });
    assert.equal(run(root, "head", base).stdout, run(root, "head", base).stdout);
  });

  it("names a head other than HEAD", (t) => {
    const { root, base, head } = repository(t, (dir) => {
      write(dir, "docs/testing.md", "# Testing, edited\n");
    });
    git(root, "checkout", "--quiet", base);
    const filtered = run(root, "head", base, head).stdout.trim();
    assert.equal(git(root, "rev-parse", `${filtered}^`), head);
    assert.deepEqual(diff(root, base, filtered), []);
  });

  it("leaves the head as it is when the base cannot be resolved", (t) => {
    const { root, head } = repository(t, () => {});
    for (const base of ["", "0000000000000000000000000000000000000000", "f".repeat(40)]) {
      const result = run(root, "head", base);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), head);
      assert.match(result.stderr, /no comparison base/i);
    }
  });

  it("fails the file list when the base cannot be resolved, so callers run in full", (t) => {
    const { root } = repository(t, () => {});
    const result = run(root, "files", "f".repeat(40));
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  });

  it("refuses wrong usage", (t) => {
    const { root } = repository(t, () => {});
    assert.equal(run(root).status, 2);
    assert.equal(run(root, "other", "HEAD").status, 2);
  });
});

describe("this repository", () => {
  const tracked = git(REPOSITORY, "ls-files").split("\n");

  it("counts the Markdown its code reads", () => {
    // MCP Admin's tests and evals give the model the content skills (apps/mcp-admin/evals/tests.js),
    // the retrieval evals ingest their Markdown documents, and an e2e seed folder exists only through
    // its README.
    const read = tracked.filter(
      (file) =>
        /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(file) ||
        file.startsWith("packages/memory/evals/datasets/") ||
        file === "apps/web/e2e/fixtures/without-profile/README.md",
    );
    assert.ok(read.length > 0);
    for (const file of read) assert.equal(isDocumentation(file), false, file);
  });

  it("treats the app and package guides as documentation", () => {
    const guides = tracked.filter((file) => /^(apps|packages)\/[^/]+\/AGENTS\.md$/.test(file));
    assert.ok(guides.length > 0);
    for (const file of guides) assert.equal(isDocumentation(file), true, file);
  });
});
