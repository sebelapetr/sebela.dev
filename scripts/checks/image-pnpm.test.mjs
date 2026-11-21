// The container images install pnpm with `npm ci` from infra/pnpm, whose npm lockfile pins pnpm and
// its platform executables by integrity hash (infra/README.md, pnpm in the images). These tests keep
// that installation at the version of `packageManager` in package.json, fully hashed, and the only
// way an image gets pnpm: an `npm install` in a Dockerfile is pinned by version only.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..", "..");
const readJson = (...segments) => JSON.parse(readFileSync(path.join(root, ...segments), "utf8"));

const packageManager = readJson("package.json").packageManager;
const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageManager)?.[1];
const manifest = readJson("infra", "pnpm", "package.json");
const lockfile = readJson("infra", "pnpm", "package-lock.json");

const dockerfiles = readdirSync(path.join(root, "apps"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join("apps", entry.name, "Dockerfile"))
  .filter((file) => existsSync(path.join(root, file)));

describe("pnpm in the images", () => {
  it("is the exact version of packageManager", () => {
    assert.ok(pnpmVersion, `packageManager is not an exact pnpm version: ${packageManager}`);
    assert.deepEqual(
      manifest.dependencies,
      { pnpm: pnpmVersion },
      "infra/pnpm and packageManager in package.json must name the same pnpm; move both together",
    );
    assert.equal(lockfile.packages[""].dependencies.pnpm, pnpmVersion);
    assert.equal(lockfile.packages["node_modules/pnpm"].version, pnpmVersion);
  });

  it("is locked with an integrity hash for every package", () => {
    const packages = Object.entries(lockfile.packages).filter(([name]) => name !== "");
    assert.ok(packages.length > 0);
    for (const [name, entry] of packages) {
      assert.match(entry.integrity ?? "", /^sha512-/, `${name} has no sha512 integrity`);
    }
  });

  it("is installed by npm ci in every image, never by npm install", () => {
    assert.ok(dockerfiles.length > 0);
    for (const file of dockerfiles) {
      const text = readFileSync(path.join(root, file), "utf8");
      assert.doesNotMatch(text, /\bnpm\s+(install|i|update|install-test)\b/, file);
      if (/\bpnpm\b/.test(text.replaceAll(/^#.*$/gm, ""))) {
        assert.match(text, /^RUN npm ci --prefix \/opt\/pnpm /m, file);
      }
    }
  });
});
