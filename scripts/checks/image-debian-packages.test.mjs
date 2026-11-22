// The images upgrade a few Debian packages past the base image (docs/release-workflow.md, "Image
// scan"). Dependabot cannot see those pins, so these tests keep the step the same in every
// Dockerfile, pinned, minimal and in the base stage, so each image and each of its stages has it.
// The step itself fails the build once the base image carries the pinned versions.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..", "..");
const dockerfiles = readdirSync(path.join(root, "apps"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join("apps", entry.name, "Dockerfile"))
  .filter((file) => existsSync(path.join(root, file)));

const BLOCK = /^# BEGIN debian-package-fixes[^\n]*\n[\s\S]*?^# END debian-package-fixes$/gm;

const blocksOf = (text) => text.match(BLOCK) ?? [];

describe("Debian package fixes in the images", () => {
  it("is found in every image's Dockerfile, exactly once", () => {
    assert.ok(dockerfiles.length >= 3, "expected the API, website and MCP Admin Dockerfiles");
    for (const file of dockerfiles) {
      assert.equal(blocksOf(readFileSync(path.join(root, file), "utf8")).length, 1, file);
    }
  });

  it("is identical in every Dockerfile", () => {
    const blocks = new Set(
      dockerfiles.map((file) => blocksOf(readFileSync(path.join(root, file), "utf8"))[0]),
    );
    assert.equal(blocks.size, 1, "the step differs between Dockerfiles; change all of them");
  });

  it("sits directly after the base stage's FROM, so every later stage inherits it", () => {
    for (const file of dockerfiles) {
      const text = readFileSync(path.join(root, file), "utf8");
      assert.match(text, /^FROM node:\S+ AS base\n# BEGIN debian-package-fixes/m, file);
    }
  });

  it("pins every package to an exact version and touches nothing else", () => {
    const block = blocksOf(readFileSync(path.join(root, dockerfiles[0]), "utf8"))[0];
    const pins = /pins="([^"]+)"/.exec(block)?.[1].split(" ") ?? [];
    assert.ok(pins.length > 0, "no pins");
    for (const pin of pins) assert.match(pin, /^[a-z0-9.+-]+=[0-9][^=\s]*$/, pin);
    assert.match(block, /apt-get install --yes --no-install-recommends --only-upgrade \$pins/);
    assert.match(block, /rm -rf \/var\/lib\/apt\/lists\/\*/);
    assert.doesNotMatch(block, /apt-get (upgrade|dist-upgrade)/);
  });
});
