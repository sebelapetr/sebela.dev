// The pre-commit and commit-msg hooks, exercised through real `git commit` runs in disposable
// repositories with fake workspace tools (../lib/hook-fixtures.mjs).

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  createRepo,
  git,
  GIT_ENV,
  HOOKS_DIR,
  installFakeTools,
  toolCalls,
} from "../lib/hook-fixtures.mjs";

const cleanups = [];
after(() => cleanups.forEach((cleanup) => cleanup()));

function setup({ tools = true } = {}) {
  const fixture = createRepo();
  cleanups.push(fixture.cleanup);
  if (tools) installFakeTools(fixture.repo);
  return fixture.repo;
}

function commit(repo, message, ...args) {
  return spawnSync("git", ["-c", `core.hooksPath=${HOOKS_DIR}`, "commit", "-m", message, ...args], {
    cwd: repo,
    env: GIT_ENV,
    encoding: "utf8",
  });
}

const write = (repo, file, content) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), content);
};
const read = (repo, file) => fs.readFileSync(path.join(repo, file), "utf8");
const committed = (repo, file) => git(repo, "show", `HEAD:${file}`);
const subject = (repo) => git(repo, "log", "-1", "--format=%s").trim();

test("a valid commit message is accepted", () => {
  const repo = setup();
  write(repo, "notes.txt", "plain text\n");
  git(repo, "add", "notes.txt");
  const run = commit(repo, "feat(harness): add notes");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(subject(repo), "feat(harness): add notes");
});

test("an invalid commit message is rejected with the expected form", () => {
  const repo = setup();
  write(repo, "notes.txt", "plain text\n");
  git(repo, "add", "notes.txt");
  const run = commit(repo, "Added some notes.");
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /<type>\(<scope>\): <summary>/);
  assert.equal(subject(repo), "chore: start the fixture");
});

test("staged files are formatted in the commit and in the working tree", () => {
  const repo = setup();
  write(repo, "src/app.js", "const  a =  1;   \n");
  git(repo, "add", "src/app.js");
  const run = commit(repo, "feat: add the app");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(committed(repo, "src/app.js"), "const a = 1;\n");
  assert.equal(read(repo, "src/app.js"), "const a = 1;\n");
  assert.equal(git(repo, "status", "--porcelain"), "");
});

test("unsupported files are left as they are", () => {
  const repo = setup();
  write(repo, "data.bin", "keep   these   spaces\n");
  git(repo, "add", "data.bin");
  const run = commit(repo, "chore: add data");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(committed(repo, "data.bin"), "keep   these   spaces\n");
});

test("a partially staged file is formatted in the commit and keeps its unstaged edits", () => {
  const repo = setup();
  write(repo, "src/app.js", "const a = 1;\nconst b = 2;\n");
  git(repo, "add", "src/app.js");
  assert.equal(commit(repo, "feat: add the app").status, 0);

  write(repo, "src/app.js", "const  a  =  10;\nconst b = 2;\n");
  git(repo, "add", "src/app.js");
  const unstaged = "const  a  =  10;\nconst b = 2;\nconst  c = 3; // unstaged\n";
  write(repo, "src/app.js", unstaged);

  const run = commit(repo, "fix: change a");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(committed(repo, "src/app.js"), "const a = 10;\nconst b = 2;\n");
  assert.equal(read(repo, "src/app.js"), unstaged);
  assert.equal(git(repo, "diff", "--cached", "--name-only"), "");
});

test("other unstaged and untracked files are not touched", () => {
  const repo = setup();
  write(repo, "src/other.js", "const  x = 1;\n");
  git(repo, "add", "src/other.js");
  assert.equal(commit(repo, "feat: add other").status, 0);

  write(repo, "src/other.js", "const  x  = 2;\n");
  write(repo, "src/untracked.js", "const  y = 1;\n");
  write(repo, "src/app.js", "const  a = 1;\n");
  git(repo, "add", "src/app.js");
  const run = commit(repo, "feat: add the app");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(read(repo, "src/other.js"), "const  x  = 2;\n");
  assert.equal(read(repo, "src/untracked.js"), "const  y = 1;\n");
  assert.equal(committed(repo, "src/other.js"), "const x = 1;\n");
});

test("file names with spaces, brackets, a leading dash and non-ASCII characters are handled", () => {
  const repo = setup();
  const names = ["src/with space.js", "src/[id].js", "-leading.js", "src/čeština.md", "src/a,b.js"];
  for (const name of names) write(repo, name, "const  a = 1;\n");
  git(repo, "add", "--", ...names);
  // One of them is also partially staged, so both formatting paths see unusual names.
  write(repo, "src/[id].js", "const  a = 1;\n// unstaged\n");

  const run = commit(repo, "feat: add unusual names");
  assert.equal(run.status, 0, run.stderr);
  for (const name of names) assert.equal(committed(repo, name), "const a = 1;\n", name);
  assert.equal(read(repo, "src/[id].js"), "const  a = 1;\n// unstaged\n");
  assert.equal(read(repo, "-leading.js"), "const a = 1;\n");
});

test("a lint error stops the commit and names the file", () => {
  const repo = setup();
  write(repo, "src/app.js", "debugger;\n");
  git(repo, "add", "src/app.js");
  const run = commit(repo, "feat: add the app");
  assert.notEqual(run.status, 0);
  assert.match(run.stdout + run.stderr, /src\/app\.js[\s\S]*no-debugger/);
  assert.equal(subject(repo), "chore: start the fixture");
});

test("the staged content is linted, not the working copy", () => {
  const repo = setup();
  write(repo, "src/app.js", "debugger;\n");
  git(repo, "add", "src/app.js");
  write(repo, "src/app.js", "const fixedButNotStaged = 1;\n");
  const run = commit(repo, "feat: add the app");
  assert.notEqual(run.status, 0);
  assert.match(run.stdout + run.stderr, /no-debugger/);
});

test("a file Prettier cannot parse stops the commit", () => {
  const repo = setup();
  write(repo, "src/app.js", "SYNTAX-ERROR\n");
  git(repo, "add", "src/app.js");
  const run = commit(repo, "feat: add the app");
  assert.notEqual(run.status, 0);
  assert.match(run.stdout + run.stderr, /SyntaxError/);
  assert.equal(subject(repo), "chore: start the fixture");
});

test("without installed tools the commit stops and says how to install them", () => {
  const repo = setup({ tools: false });
  write(repo, "src/app.js", "const a = 1;\n");
  git(repo, "add", "src/app.js");
  const run = commit(repo, "feat: add the app");
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /pnpm install --frozen-lockfile/);
});

test("a commit that only deletes files needs no tools", () => {
  const repo = setup({ tools: false });
  const run = spawnSync(
    "git",
    ["-c", `core.hooksPath=${HOOKS_DIR}`, "rm", "--quiet", ".gitignore"],
    {
      cwd: repo,
      env: GIT_ENV,
      encoding: "utf8",
    },
  );
  assert.equal(run.status, 0, run.stderr);
  const done = commit(repo, "chore: remove the ignore file");
  assert.equal(done.status, 0, done.stderr);
});

test("the pre-commit hook runs neither the typecheck nor the test suite", () => {
  const repo = setup();
  write(repo, "src/app.js", "const a = 1;\n");
  git(repo, "add", "src/app.js");
  assert.equal(commit(repo, "feat: add the app").status, 0);
  const tools = new Set(toolCalls(repo).map((call) => call.tool));
  assert.deepEqual([...tools].sort(), ["eslint", "prettier"]);
});

test("the hooks work on the worktree the commit is made in", () => {
  const repo = setup();
  const worktree = path.join(path.dirname(repo), "worktree");
  git(repo, "worktree", "add", "-b", "feat/1-fixture", worktree);
  installFakeTools(worktree);
  // The main checkout's tools would fail every call; only the worktree's may be used.
  fs.rmSync(path.join(repo, "node_modules"), { recursive: true });

  write(worktree, "src/app.js", "const  a = 1;\n");
  git(worktree, "add", "src/app.js");
  const run = commit(worktree, "feat: add the app");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(committed(worktree, "src/app.js"), "const a = 1;\n");
  assert.ok(toolCalls(worktree).every((call) => call.cwd === fs.realpathSync(worktree)));
});
