// Behaviour of the tracked-node_modules check (docs/testing.md, CI): no tracked path has a
// `node_modules` component, whether a folder's file or a symbolic link of that name (the pattern
// `node_modules/` in .gitignore ignores only a directory, so a link was once committed), and the
// repository's .gitignore ignores a link too. The last tests run on the repository itself, so a
// tracked entry fails `node --test scripts/`.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { trackedNodeModules } from "./tracked-node-modules.mjs";

const root = path.join(import.meta.dirname, "..", "..");

describe("tracked-node_modules check", () => {
  it("accepts paths without a node_modules component", () => {
    assert.deepEqual(trackedNodeModules(["apps/web/src/index.ts", "my_node_modules.md"]), []);
  });

  it("finds a node_modules link or file, and files below a node_modules folder", () => {
    assert.deepEqual(
      trackedNodeModules([
        "ok.ts",
        "node_modules",
        "apps/web/node_modules",
        "packages/x/node_modules/y/index.js",
      ]),
      ["node_modules", "apps/web/node_modules", "packages/x/node_modules/y/index.js"],
    );
  });

  it("is ignored by .gitignore as a symbolic link, at the root and in a package", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "node-modules-link-"));
    try {
      execFileSync("git", ["init", "--quiet", dir]);
      fs.copyFileSync(path.join(root, ".gitignore"), path.join(dir, ".gitignore"));
      fs.mkdirSync(path.join(dir, "apps", "web"), { recursive: true });
      fs.symlinkSync("/nonexistent-target", path.join(dir, "node_modules"));
      fs.symlinkSync("/nonexistent-target", path.join(dir, "apps", "web", "node_modules"));
      for (const entry of ["node_modules", "apps/web/node_modules"]) {
        const result = spawnSync("git", ["check-ignore", "--quiet", entry], { cwd: dir });
        assert.equal(result.status, 0, `${entry} is not ignored`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds nothing tracked in this repository", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
    assert.deepEqual(trackedNodeModules(tracked), []);
  });
});
