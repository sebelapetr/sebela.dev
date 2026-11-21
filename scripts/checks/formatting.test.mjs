// Behaviour of the formatting check, observed through its command line in disposable repositories
// with the fake workspace tools of the hook tests (../../harness/lib/hook-fixtures.mjs): which
// files it hands to Prettier, what it reports and its exit status.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import {
  createRepo,
  git,
  GIT_ENV,
  installFakeTools,
  toolCalls,
} from "../../harness/lib/hook-fixtures.mjs";

const CHECK = path.join(import.meta.dirname, "formatting.mjs");

const cleanups = [];
after(() => cleanups.forEach((cleanup) => cleanup()));

function setup({ tools = true } = {}) {
  const fixture = createRepo("sebela-formatting-");
  cleanups.push(fixture.cleanup);
  if (tools) installFakeTools(fixture.repo);
  return fixture.repo;
}

const write = (repo, file, content) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), content);
};

function track(repo, files) {
  for (const [file, content] of Object.entries(files)) write(repo, file, content);
  git(repo, "add", "--", ...Object.keys(files));
  git(repo, "commit", "--quiet", "-m", "chore: add files");
}

function check(cwd) {
  const run = spawnSync(process.execPath, [CHECK], { cwd, env: GIT_ENV, encoding: "utf8" });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

// Every file the fake Prettier was asked to check, in all its calls.
const checked = (repo) =>
  toolCalls(repo)
    .filter((call) => call.tool === "prettier")
    .flatMap((call) => call.args.slice(call.args.indexOf("--") + 1));

test("a repository whose tracked files are formatted passes", () => {
  const repo = setup();
  track(repo, { "src/app.js": "const a = 1;\n", "README.md": "# Fixture\n" });
  const run = check(repo);
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(checked(repo).sort(), [".gitignore", "README.md", "src/app.js"]);
});

test("Prettier only checks: it is called in check mode and changes no file", () => {
  const repo = setup();
  track(repo, { "src/app.js": "const  a = 1;\n" });
  check(repo);
  const calls = toolCalls(repo).filter((call) => call.tool === "prettier");
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.ok(call.args.includes("--check"), call.args.join(" "));
    assert.ok(!call.args.includes("--write"), call.args.join(" "));
  }
  assert.equal(fs.readFileSync(path.join(repo, "src/app.js"), "utf8"), "const  a = 1;\n");
});

test("an unformatted tracked file fails the check and is named, with how to fix it", () => {
  const repo = setup();
  track(repo, { "src/app.js": "const a = 1;\n", "docs/notes.md": "Some   notes   \n" });
  const run = check(repo);
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /docs\/notes\.md/);
  assert.doesNotMatch(run.output, /src\/app\.js/);
  assert.match(run.output, /prettier --write/);
});

test("file types Prettier does not support are skipped, as in the commit hook", () => {
  const repo = setup();
  track(repo, { "data.bin": "keep   these   spaces\n", "src/app.js": "const a = 1;\n" });
  const run = check(repo);
  assert.equal(run.status, 0, run.output);
});

test("untracked files are not checked", () => {
  const repo = setup();
  track(repo, { "src/app.js": "const a = 1;\n" });
  write(repo, "src/scratch.js", "const  b = 2;\n");
  const run = check(repo);
  assert.equal(run.status, 0, run.output);
  assert.ok(!checked(repo).includes("src/scratch.js"));
});

test("the working copy of a tracked file is checked", () => {
  const repo = setup();
  track(repo, { "src/app.js": "const a = 1;\n" });
  write(repo, "src/app.js", "const  a = 2;\n");
  const run = check(repo);
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /src\/app\.js/);
});

test("tracked symbolic links and files deleted from the working copy are not passed to Prettier", () => {
  const repo = setup();
  track(repo, { "src/app.js": "const a = 1;\n", "src/gone.js": "const g = 1;\n" });
  fs.symlinkSync("app.js", path.join(repo, "src/link.js"));
  git(repo, "add", "src/link.js");
  git(repo, "commit", "--quiet", "-m", "chore: add a link");
  fs.rmSync(path.join(repo, "src/gone.js"));
  const run = check(repo);
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(checked(repo).sort(), [".gitignore", "src/app.js"]);
});

test("file names with spaces, brackets, a leading dash and non-ASCII characters are handled", () => {
  const repo = setup();
  const names = ["src/with space.js", "src/[id].js", "src/čeština.md", "src/a,b.js"];
  track(repo, {
    ...Object.fromEntries(names.map((name) => [name, "const a = 1;\n"])),
    "-leading.js": "const  a = 1;\n",
  });
  const run = check(repo);
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /-leading\.js/);
  assert.deepEqual(checked(repo).sort(), [".gitignore", "-leading.js", ...names].sort());
});

test("more files than one Prettier call takes are all checked, and a problem in any of them fails", () => {
  const repo = setup();
  const files = {};
  for (let i = 0; i < 1050; i += 1)
    files[`src/file-${String(i).padStart(4, "0")}.js`] = "const a = 1;\n";
  files["src/file-1049.js"] = "const  a = 1;\n";
  track(repo, files);
  const run = check(repo);
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /src\/file-1049\.js/);
  assert.equal(checked(repo).length, 1051);
});

test("a file Prettier cannot parse fails the check", () => {
  const repo = setup();
  track(repo, { "src/app.js": "SYNTAX-ERROR\n" });
  const run = check(repo);
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /SyntaxError/);
});

test("run from a subfolder, it checks the whole checkout", () => {
  const repo = setup();
  track(repo, { "src/app.js": "const a = 1;\n", "docs/notes.md": "Some   notes\n" });
  const run = check(path.join(repo, "src"));
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /docs\/notes\.md/);
});

test("without installed tools it cannot run, exits with 2 and says how to install them", () => {
  const repo = setup({ tools: false });
  track(repo, { "src/app.js": "const a = 1;\n" });
  const run = check(repo);
  assert.equal(run.status, 2, run.output);
  assert.match(run.output, /pnpm install --frozen-lockfile/);
});
