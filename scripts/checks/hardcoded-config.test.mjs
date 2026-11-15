// Behaviour of the hard-coded configuration check, observed through its command line: the files
// it is given or finds in a repository, what it reports and its exit status.
//
// Every hard-coded value lives in the fixture files of `fixtures/hardcoded-config/` (`rejected/`
// must fail, `accepted/` must pass), so this file itself stays clean under the check.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const CHECK = path.join(import.meta.dirname, "hardcoded-config.mjs");
const FIXTURES = path.join(import.meta.dirname, "fixtures", "hardcoded-config");
const REPORT_LINE = /^(?<file>[^\s:]+):(?<line>\d+):(?<column>\d+) (?<rule>[a-z-]+): \S/;

function check(args, cwd) {
  const result = spawnSync(process.execPath, [CHECK, ...args], { cwd, encoding: "utf8" });
  const reports = `${result.stdout}\n${result.stderr}`
    .split("\n")
    .map((line) => line.match(REPORT_LINE)?.groups)
    .filter(Boolean);
  return { status: result.status, output: `${result.stdout}${result.stderr}`, reports };
}

const located = (reports) =>
  reports.map(({ file, line, rule }) => `${file}:${line} ${rule}`).sort();

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-config-check-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
      stdio: "ignore",
    });
  git("init", "-b", "master");
  const put = (target, fixture) => {
    const destination = path.join(root, target);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(FIXTURES, fixture), destination, { recursive: true });
  };
  const commit = () => {
    git("add", "--all");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "fixture",
    );
  };
  return { root, put, commit };
}

describe("hard-coded configuration check: fixture files", () => {
  it("reports every hard-coded port, local host and database name with its location", () => {
    const result = check(["rejected"], FIXTURES);

    assert.equal(result.status, 1, result.output);
    assert.deepEqual(
      located(result.reports),
      [
        "rejected/bin/serve:2 port",
        "rejected/database.mjs:2 database-name",
        "rejected/database.mjs:3 database-name",
        "rejected/database.mjs:4 database-name",
        "rejected/database.mjs:5 database-name",
        "rejected/database.mjs:6 database-name",
        "rejected/database.mjs:7 environment-default",
        "rejected/hosts.ts:2 local-host",
        "rejected/hosts.ts:3 local-host",
        "rejected/hosts.ts:4 local-host",
        "rejected/hosts.ts:5 local-host",
        "rejected/hosts.ts:6 environment-default",
        "rejected/package.json:6 port",
        "rejected/ports.mjs:2 port",
        "rejected/ports.mjs:3 port",
        "rejected/ports.mjs:4 port",
        "rejected/ports.mjs:6 port",
        "rejected/ports.mjs:8 environment-default",
        "rejected/ports.mjs:9 port",
        "rejected/service.py:4 port",
        "rejected/service.py:5 database-name",
        "rejected/service.py:6 environment-default",
        "rejected/start.sh:4 port",
        "rejected/start.sh:5 port",
        "rejected/start.sh:6 database-name",
        "rejected/start.sh:7 database-name",
        "rejected/start.sh:8 database-name",
        "rejected/start.sh:9 environment-default",
      ].sort(),
    );
  });

  it("points at the column where the hard-coded value starts", () => {
    const result = check([path.join("rejected", "ports.mjs")], FIXTURES);

    const listen = result.reports.find((report) => report.line === "6");
    const source = fs
      .readFileSync(path.join(FIXTURES, "rejected", "ports.mjs"), "utf8")
      .split("\n")[5];
    assert.ok(listen, result.output);
    assert.match(source.slice(Number(listen.column) - 1), /^\d+\);$/);
  });

  it("accepts configuration read from the environment, documentation and declarations", () => {
    const result = check(["accepted"], FIXTURES);

    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.reports, []);
  });
});

describe("hard-coded configuration check: the repository", () => {
  it("checks application code, tests and scripts, tracked or not", (t) => {
    const { root, put, commit } = repository(t);
    put("apps/api/src/server.test.mjs", "rejected/database.mjs");
    put("scripts/start.sh", "rejected/start.sh");
    commit();
    put("apps/api/src/server.mjs", "rejected/ports.mjs");

    const result = check([], root);

    assert.equal(result.status, 1, result.output);
    assert.deepEqual([...new Set(result.reports.map((report) => report.file))].sort(), [
      "apps/api/src/server.mjs",
      "apps/api/src/server.test.mjs",
      "scripts/start.sh",
    ]);
  });

  it("leaves out only its own negative fixtures, ignored files and non-executable files", (t) => {
    const { root, put } = repository(t);
    put("scripts/checks/fixtures/hardcoded-config", ".");
    put("apps/web/fixtures/hardcoded-config/hosts.ts", "rejected/hosts.ts");
    put("node_modules/dependency/index.mjs", "rejected/ports.mjs");
    fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
    put("docs/guide.md", "accepted/README.md");
    put("compose.yaml", "accepted/compose.yaml");

    const result = check([], root);

    assert.equal(result.status, 1, result.output);
    assert.deepEqual(
      [...new Set(result.reports.map((report) => report.file))],
      ["apps/web/fixtures/hardcoded-config/hosts.ts"],
    );
  });

  it("fails on a deliberately hard-coded example and passes on its environment-based equivalent", (t) => {
    const { root, put } = repository(t);
    put("apps/api/src/server.mjs", "rejected/ports.mjs");
    assert.equal(check([], root).status, 1);

    put("apps/api/src/server.mjs", "accepted/environment.mjs");
    const result = check([], root);

    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.reports, []);
  });
});
