// Behaviour of the pinned-actions check (docs/testing.md, CI): every third-party action or reusable
// workflow a workflow uses is pinned to a full commit SHA with its version as a trailing comment,
// so a moved tag cannot change what CI runs. Local actions (`./`) are allowed. The last test runs
// the check on the repository's own workflows, so an unpinned `uses:` fails `node --test scripts/`.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { unpinnedActions } from "./pinned-actions.mjs";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const root = path.join(import.meta.dirname, "..", "..");
const workflows = path.join(root, ".github", "workflows");

describe("pinned-actions check", () => {
  it("accepts an action pinned to a full commit SHA with its version as a comment", () => {
    const text = [
      "steps:",
      `  - uses: actions/checkout@${SHA} # v7.0.1`,
      "  - name: Upload",
      `    uses: "actions/upload-artifact@${SHA}" # v7.0.2`,
      `  - uses: owner/repo/path/to/action@${SHA} # v1.2.3`,
      "jobs:",
      "  call:",
      `    uses: owner/repo/.github/workflows/build.yml@${SHA} # v2`,
    ].join("\n");
    assert.deepEqual(unpinnedActions(text), []);
  });

  it("accepts local actions and reusable workflows of this repository", () => {
    const text = [
      "  - uses: ./.github/actions/setup",
      "    uses: ./.github/workflows/build.yml",
    ].join("\n");
    assert.deepEqual(unpinnedActions(text), []);
  });

  it("accepts a Docker action pinned to an image digest", () => {
    const digest = "a".repeat(64);
    assert.deepEqual(unpinnedActions(`  - uses: docker://alpine@sha256:${digest} # 3.20`), []);
  });

  it("refuses a tag, a branch or a short SHA and names the line", () => {
    const text = [
      "steps:",
      "  - uses: actions/checkout@v7",
      "  - uses: pnpm/action-setup@main",
      "  - uses: actions/setup-node@3d3c42e # v7.1.0",
      "  - uses: owner/repo",
    ].join("\n");
    assert.deepEqual(
      unpinnedActions(text).map(({ line, reference, reason }) => `${line} ${reference} ${reason}`),
      [
        "2 actions/checkout@v7 not pinned to a full commit SHA",
        "3 pnpm/action-setup@main not pinned to a full commit SHA",
        "4 actions/setup-node@3d3c42e not pinned to a full commit SHA",
        "5 owner/repo not pinned to a full commit SHA",
      ],
    );
  });

  it("refuses a Docker action by tag", () => {
    assert.deepEqual(
      unpinnedActions("  - uses: docker://alpine:latest").map(({ reason }) => reason),
      ["not pinned to an image digest"],
    );
  });

  it("refuses a pinned action without the version comment", () => {
    assert.deepEqual(
      unpinnedActions(`  - uses: actions/checkout@${SHA}`).map(({ reason }) => reason),
      ["no version comment after the SHA"],
    );
  });

  it("ignores comments and text that is not a uses key", () => {
    const text = [
      "# uses: actions/checkout@v7",
      "  - run: echo 'uses: actions/checkout@v7'",
      "    with:",
      "      reuses: actions/checkout@v7",
    ].join("\n");
    assert.deepEqual(unpinnedActions(text), []);
  });

  it("finds every action of the repository's workflows pinned", () => {
    const files = readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name));
    assert.ok(files.length > 0, "no workflows found");
    const problems = files.flatMap((name) =>
      unpinnedActions(readFileSync(path.join(workflows, name), "utf8")).map(
        ({ line, reference, reason }) => `${name}:${line} ${reference}: ${reason}`,
      ),
    );
    assert.deepEqual(problems, []);
  });
});
