// The images upgrade a few Debian packages past the base image (docs/release-workflow.md, "Image
// scan"). Dependabot cannot see those pins, so these tests keep the step the same in every
// Dockerfile, pinned, minimal and in the base stage, so each image and each of its stages has it.
// The step itself fails the build once the base image carries the pinned versions.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..", "..");
const dockerfiles = readdirSync(path.join(root, "apps"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join("apps", entry.name, "Dockerfile"))
  .filter((file) => existsSync(path.join(root, file)));

const BLOCK = /^# BEGIN debian-package-fixes[^\n]*\n[\s\S]*?^# END debian-package-fixes$/gm;

const blocksOf = (text) => text.match(BLOCK) ?? [];

/** The shell of the block's RUN instruction, continuations joined, without the leading RUN. */
const runOf = (block) =>
  block
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .replace(/\\\n\s*/g, " ")
    .replace(/^RUN /, "");

/** Every apt or apt-get invocation in a RUN body, up to its terminating semicolon. */
const aptCommands = (run) => [...run.matchAll(/\bapt(?:-get)?\s[^;]*/g)].map((m) => m[0].trim());

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

  it("only updates the lists, upgrades the named packages once and cleans up", () => {
    const block = blocksOf(readFileSync(path.join(root, dockerfiles[0]), "utf8"))[0];
    const run = runOf(block);
    const floors = /floors="([^"]+)"/.exec(run)?.[1].split(" ") ?? [];
    assert.ok(floors.length > 0, "no floors");
    for (const floor of floors) assert.match(floor, /^[a-z0-9.+-]+=[0-9][^=\s]*$/, floor);
    assert.deepEqual(aptCommands(run), [
      "apt-get update",
      "apt-get install --yes --no-install-recommends --only-upgrade $needed",
    ]);
    assert.match(run, /rm -rf \/var\/lib\/apt\/lists\/\*/);
  });

  // Each mutation adds a way to change another package; the check must refuse every one.
  for (const extra of [
    "apt-get install --yes curl;",
    "apt-get --yes upgrade;",
    "apt upgrade --yes;",
    "apt-get --yes full-upgrade;",
    "apt-get install --yes --no-install-recommends --only-upgrade $needed;",
  ]) {
    it(`refuses a block that also runs \`${extra}\``, () => {
      const run = runOf(blocksOf(readFileSync(path.join(root, dockerfiles[0]), "utf8"))[0]);
      const mutated = run.replace("apt-get update;", `apt-get update; ${extra}`);
      assert.notDeepEqual(aptCommands(mutated), aptCommands(run));
    });
  }

  describe("the guard, run against stand-ins for dpkg-query, apt-cache, apt-get and rm", () => {
    // The real RUN body of the Dockerfile runs in sh with fake tools first on PATH. `rm` is faked
    // too, so the cleanup cannot touch the host. dpkg itself compares versions.
    const have = spawnSync("dpkg", ["--version"]).status === 0;
    const run = runOf(blocksOf(readFileSync(path.join(root, dockerfiles[0]), "utf8"))[0]);
    const floorOf = Object.fromEntries(
      /floors="([^"]+)"/
        .exec(run)[1]
        .split(" ")
        .map((f) => f.split("=")),
    );

    const attempt = ({ installed, candidate }) => {
      const dir = mkdtempSync(path.join(tmpdir(), "debian-fixes-"));
      const tool = (name, body) => {
        writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`);
        chmodSync(path.join(dir, name), 0o755);
      };
      const lookup = (table) =>
        Object.entries(table)
          .map(([p, v]) => `[ "$LAST" = ${p} ] && echo '${v}'`)
          .join("\n");
      tool("dpkg-query", `for LAST; do :; done\n${lookup(installed)}\nexit 0`);
      tool(
        "apt-cache",
        `for LAST; do :; done\n${Object.entries(candidate)
          .map(([p, v]) => `[ "$LAST" = ${p} ] && echo '  Candidate: ${v}'`)
          .join("\n")}\nexit 0`,
      );
      tool("apt-get", `echo "apt-get $*" >> "${dir}/calls"`);
      tool("rm", `echo "rm $*" >> "${dir}/calls"`);
      const result = spawnSync("sh", ["-c", run], {
        encoding: "utf8",
        env: { PATH: `${dir}:${process.env.PATH}` },
      });
      const calls = existsSync(path.join(dir, "calls"))
        ? readFileSync(path.join(dir, "calls"), "utf8")
        : "";
      rmSync(dir, { recursive: true });
      return { ...result, calls };
    };
    const older = (v) => v.replace(/\d+$/, (n) => String(Number(n) - 1));
    const lower = Object.fromEntries(Object.entries(floorOf).map(([p, v]) => [p, older(v)]));

    it("upgrades every package when the base is below the floors", { skip: !have }, () => {
      const r = attempt({ installed: lower, candidate: floorOf });
      assert.equal(r.status, 0, r.stderr);
      const names = Object.keys(floorOf).join(" ");
      assert.match(r.calls, new RegExp(`--only-upgrade ${names}\\n`));
      assert.match(r.calls, /rm -rf \/var\/lib\/apt\/lists/);
    });

    it("accepts a newer version than the floor on offer", { skip: !have }, () => {
      const newer = Object.fromEntries(Object.entries(floorOf).map(([p, v]) => [p, `${v}1`]));
      assert.equal(attempt({ installed: lower, candidate: newer }).status, 0);
    });

    it(
      "names only the covered package and says when to remove the block, changing nothing",
      { skip: !have },
      () => {
        const [first] = Object.keys(floorOf);
        const r = attempt({ installed: { ...lower, [first]: floorOf[first] }, candidate: floorOf });
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, new RegExp(`already has a fixed version of: ${first}\\.`));
        for (const other of Object.keys(floorOf).slice(1))
          assert.doesNotMatch(r.stderr, new RegExp(`of:.*${other}`));
        assert.match(r.stderr, /image-scan-exceptions\.json/);
        assert.match(r.stderr, /once no package is left/);
        assert.equal(r.calls, "");
      },
    );

    it("fails naming the block when no suite offers the floor", { skip: !have }, () => {
      const [first] = Object.keys(floorOf);
      const r = attempt({
        installed: lower,
        candidate: { ...floorOf, [first]: older(floorOf[first]) },
      });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, new RegExp(`No suite the base lists offers ${first}`));
      assert.match(r.stderr, /debian-package-fixes/);
      assert.doesNotMatch(r.calls, /install/);
    });
  });
});
