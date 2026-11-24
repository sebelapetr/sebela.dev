// Dependabot's docker ecosystem covers the base image of every Dockerfile of the repository's own
// images (.github/dependabot.yml; docs/release-workflow.md, "Image scan"), so a base image that the
// image scan flags can be moved by a pull request. A Dockerfile in a folder the ecosystem does not
// list would go unwatched. Test fixtures are no image of ours.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..", "..");

/** The `directories` (or `directory`) entries of the docker ecosystem in dependabot.yml. */
function dockerDirectories(text) {
  const block = text.split(/^ {2}- package-ecosystem: /m).find((part) => part.startsWith("docker"));
  assert.ok(block, "dependabot.yml has no docker ecosystem");
  const list = /directories:\n((?: {6}- .+\n)+)/.exec(block);
  const single = /directory: (.+)/.exec(block);
  const entries = list ? [...list[1].matchAll(/- (.+)/g)].map((match) => match[1]) : [single?.[1]];
  return entries.filter(Boolean).map((entry) => entry.replace(/^["']|["']$/g, ""));
}

const matches = (pattern, folder) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`).test(
    folder,
  );

describe("Dependabot docker ecosystem", () => {
  it("lists the folder of every Dockerfile of the repository's own images", () => {
    const tracked = execFileSync("git", ["ls-files", "--", "*Dockerfile*"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter((file) => file && !file.includes("/fixtures/"));
    assert.ok(tracked.length >= 3, "expected the Dockerfiles of the api, web and mcp-admin images");
    const directories = dockerDirectories(
      fs.readFileSync(path.join(root, ".github", "dependabot.yml"), "utf8"),
    );
    for (const file of tracked) {
      const folder = `/${path.dirname(file)}`;
      assert.ok(
        directories.some((pattern) => matches(pattern, folder)),
        `${file} is in no folder the docker ecosystem lists (${directories.join(", ")})`,
      );
    }
  });
});
