// Behaviour of the coverage summary CI writes after the tests (docs/testing.md, Coverage): the
// line coverage of each workspace member from its `coverage/lcov.info`, per language and overall,
// observed through the command line on a disposable workspace.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { shieldsEndpoint } from "./coverage-summary.mjs";

const SCRIPT = path.join(import.meta.dirname, "coverage-summary.mjs");

function write(root, file, text) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

/** An lcov report: one record per file, `lines` as [line, hits] pairs. */
function lcov(files) {
  return Object.entries(files)
    .map(
      ([file, lines]) =>
        `TN:\nSF:${file}\n${lines.map(([line, hits]) => `DA:${line},${hits}`).join("\n")}\n` +
        `LF:${lines.length}\nLH:${lines.filter(([, hits]) => hits > 0).length}\nend_of_record\n`,
    )
    .join("");
}

/** `count` lines of which the first `hit` ran. */
function lines(count, hit) {
  return Array.from({ length: count }, (_, index) => [index + 1, index < hit ? 3 : 0]);
}

function member(root, folder, { scripts = {}, devDependencies = {} } = {}) {
  write(
    root,
    `${folder}/package.json`,
    JSON.stringify({ name: `@fixture/${path.basename(folder)}`, scripts, devDependencies }),
  );
}

const VITEST = {
  scripts: { test: "vitest run" },
  devDependencies: { vitest: "catalog:", "@vitest/coverage-v8": "catalog:" },
};

/** A workspace with every kind of member; removed after the test `t`. */
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-summary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, "pnpm-workspace.yaml", "packages:\n  - apps/*\n  - packages/*\n");
  // Measured and run: 3 of 4 and 5 of 6 lines.
  member(root, "apps/api", VITEST);
  write(
    root,
    "apps/api/coverage/lcov.info",
    lcov({ "src/a.ts": lines(4, 3), "src/b.ts": lines(6, 5) }),
  );
  // Measured and run, nothing reached: 0 of 10 lines.
  member(root, "apps/web", VITEST);
  write(root, "apps/web/coverage/lcov.info", lcov({ "src/page.tsx": lines(10, 0) }));
  // Measured, but not run in this job (not affected).
  member(root, "packages/db", VITEST);
  // Tests whose runner reports no coverage.
  member(root, "packages/config", { scripts: { test: 'node --test "*.test.js"' } });
  write(root, "packages/config/coverage/lcov.info", lcov({ "x.js": lines(2, 2) }));
  // No test task at all.
  member(root, "packages/ui", { scripts: { lint: "eslint ." } });
  // Python, measured with pytest-cov: 8 of 10 lines.
  member(root, "packages/llm-agent", { scripts: { test: "uv run --locked pytest" } });
  write(
    root,
    "packages/llm-agent/pyproject.toml",
    '[dependency-groups]\ndev = ["pytest==9.2.0", "pytest-cov==7.0.0"]\n',
  );
  write(
    root,
    "packages/llm-agent/coverage/lcov.info",
    lcov({ "src/llm_agent/pipeline.py": lines(10, 8) }),
  );
  // Not a workspace member.
  write(root, "docs/coverage/lcov.info", lcov({ "x.ts": lines(1, 1) }));
  return root;
}

function run(root, args = [], env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, "--root", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_STEP_SUMMARY: "", ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function row(markdown, first) {
  return markdown.split("\n").find((line) => line.startsWith(`| ${first} `));
}

describe("coverage summary", () => {
  it("reports the line coverage of each measured member that ran", (t) => {
    const { status, stdout } = run(workspace(t));
    assert.equal(status, 0);
    assert.equal(row(stdout, "`@fixture/api`"), "| `@fixture/api` | TypeScript | 8 | 10 | 80.0% |");
    assert.equal(row(stdout, "`@fixture/web`"), "| `@fixture/web` | TypeScript | 0 | 10 | 0.0% |");
    assert.equal(
      row(stdout, "`@fixture/llm-agent`"),
      "| `@fixture/llm-agent` | Python | 8 | 10 | 80.0% |",
    );
  });

  it("combines the members into one figure per language and one overall", (t) => {
    const { stdout } = run(workspace(t));
    assert.equal(row(stdout, "**TypeScript**"), "| **TypeScript** | | 8 | 20 | **40.0%** |");
    assert.equal(row(stdout, "**Python**"), "| **Python** | | 8 | 10 | **80.0%** |");
    assert.equal(row(stdout, "**Overall**"), "| **Overall** | | 16 | 30 | **53.3%** |");
  });

  it("names the members it has no figure for, and why", (t) => {
    const { stdout } = run(workspace(t));
    assert.match(stdout, /Not run in this job: `@fixture\/db`/);
    assert.match(stdout, /Tests without coverage measurement: `@fixture\/config`/);
    assert.match(stdout, /No tests: `@fixture\/ui`/);
    // Three measured members have a row; a folder outside apps/ and packages/ is no member.
    assert.equal(stdout.split("\n").filter((line) => line.startsWith("| `")).length, 3);
  });

  it("shows a language without any measured member as not measured", (t) => {
    const root = workspace(t);
    fs.rmSync(path.join(root, "packages/llm-agent/coverage"), { recursive: true });
    const { status, stdout } = run(root);
    assert.equal(status, 0);
    assert.equal(row(stdout, "**Python**"), "| **Python** | | 0 | 0 | — |");
    assert.equal(row(stdout, "**Overall**"), "| **Overall** | | 8 | 20 | **40.0%** |");
    assert.match(stdout, /Not run in this job: `@fixture\/db`, `@fixture\/llm-agent`/);
  });

  it("appends the summary to the job summary file when GitHub Actions names one", (t) => {
    const root = workspace(t);
    const summary = path.join(root, "step-summary.md");
    fs.writeFileSync(summary, "earlier step\n");
    const { status, stdout } = run(root, [], { GITHUB_STEP_SUMMARY: summary });
    assert.equal(status, 0);
    assert.equal(fs.readFileSync(summary, "utf8"), `earlier step\n${stdout}`);
  });

  it("writes the figures as JSON when asked", (t) => {
    const root = workspace(t);
    const file = path.join(root, "out", "coverage-summary.json");
    assert.equal(run(root, ["--json", file]).status, 0);
    const figures = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(figures.lines, {
      typescript: { covered: 8, total: 20, percent: 40 },
      python: { covered: 8, total: 10, percent: 80 },
      overall: { covered: 16, total: 30, percent: 53.3 },
    });
    assert.deepEqual(
      figures.packages.map(({ name, language, status }) => [name, language, status]),
      [
        ["@fixture/api", "TypeScript", "measured"],
        ["@fixture/web", "TypeScript", "measured"],
        ["@fixture/config", "TypeScript", "not measured"],
        ["@fixture/db", "TypeScript", "not run"],
        ["@fixture/ui", "TypeScript", "no tests"],
        ["@fixture/llm-agent", "Python", "measured"],
      ],
    );
  });

  it("never fails on a coverage value, however low, nor on a report it cannot read", (t) => {
    const root = workspace(t);
    write(root, "apps/api/coverage/lcov.info", "not an lcov report\n");
    const { status, stdout } = run(root);
    assert.equal(status, 0);
    assert.equal(row(stdout, "`@fixture/api`"), "| `@fixture/api` | TypeScript | 0 | 0 | — |");
  });

  it("writes the published site: the badge's endpoint, the figures and a page", (t) => {
    const root = workspace(t);
    const site = path.join(root, "site");
    const docs = "https://example.test/docs/testing.md#coverage";
    assert.equal(run(root, ["--site", site, "--docs-url", docs]).status, 0);
    assert.deepEqual(fs.readdirSync(site).sort(), [
      "coverage-summary.json",
      "coverage.json",
      "index.html",
    ]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(site, "coverage.json"), "utf8")), {
      schemaVersion: 1,
      label: "coverage",
      message: "53.3%",
      color: "525252",
    });
    const figures = JSON.parse(fs.readFileSync(path.join(site, "coverage-summary.json"), "utf8"));
    assert.equal(figures.lines.overall.percent, 53.3);
    const page = fs.readFileSync(path.join(site, "index.html"), "utf8");
    assert.match(page, /<title>Test coverage<\/title>/);
    assert.match(page, /53\.3%/);
    assert.match(page, /<td><code>@fixture\/api<\/code><\/td>/);
    assert.ok(page.includes(`<a href="${docs}">`));
    assert.doesNotMatch(page, /<script|<link|<img|https?:\/\/(?!example\.test\/docs)/);
  });

  it("refuses a site without the address of the documentation it links to", (t) => {
    const root = workspace(t);
    const { status, stderr } = run(root, ["--site", path.join(root, "site")]);
    assert.equal(status, 2);
    assert.match(stderr, /--docs-url/);
  });

  it("refuses unknown arguments", (t) => {
    const { status, stderr } = run(workspace(t), ["--threshold", "80"]);
    assert.equal(status, 2);
    assert.match(stderr, /Usage/);
  });
});

describe("shields endpoint", () => {
  const figure = (percent) => ({ lines: { overall: { covered: 1, total: 2, percent } } });

  it("states the overall line coverage with one decimal in the README's neutral colour", () => {
    assert.deepEqual(shieldsEndpoint(figure(83.8)), {
      schemaVersion: 1,
      label: "coverage",
      message: "83.8%",
      color: "525252",
    });
    assert.equal(shieldsEndpoint(figure(100)).message, "100.0%");
    assert.equal(shieldsEndpoint(figure(0)).message, "0.0%");
  });

  it("keeps the colour whatever the figure: there is no threshold", () => {
    const colours = new Set(
      [0, 12.5, 50, 99.9].map((value) => shieldsEndpoint(figure(value)).color),
    );
    assert.deepEqual([...colours], ["525252"]);
  });

  it("says so when nothing was measured", () => {
    assert.equal(shieldsEndpoint(figure(null)).message, "not measured");
  });
});
