// The PostToolUse hook that formats a file after an agent edited it, run as Claude Code runs it:
// hook input on stdin, the main checkout in CLAUDE_PROJECT_DIR.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRepo, git, installFakeTools, toolCalls } from "../lib/hook-fixtures.mjs";

const HOOK = path.join(import.meta.dirname, "format-edited-file.mjs");

const fixture = createRepo("sebela-format-");
after(fixture.cleanup);
const main = fixture.repo;
const worktree = path.join(main, ".worktrees", "feat-1-fixture");
git(main, "worktree", "add", "-b", "feat/1-fixture", worktree);
installFakeTools(worktree);
const bare = path.join(fixture.dir, "bare-worktree");
git(main, "worktree", "add", "-b", "feat/2-no-tools", bare);

function runHook(filePath, toolName = "Edit") {
  const run = spawnSync(process.execPath, [HOOK], {
    cwd: main,
    env: { ...process.env, CLAUDE_PROJECT_DIR: main },
    input: JSON.stringify({
      hook_event_name: "PostToolUse",
      cwd: main,
      agent_id: "fixture",
      tool_name: toolName,
      tool_input: { file_path: filePath },
    }),
    encoding: "utf8",
  });
  assert.ifError(run.error);
  return { ...run, output: run.stdout ? JSON.parse(run.stdout) : null };
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

test("an edited file is formatted with the tools of its own worktree", () => {
  const file = write(path.join(worktree, "src", "app.js"), "const  a =  1;  \n");
  const run = runHook(file);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.output, null);
  assert.equal(fs.readFileSync(file, "utf8"), "const a = 1;\n");
  const prettier = toolCalls(worktree).filter((call) => call.tool === "prettier");
  assert.ok(prettier.length > 0);
  assert.ok(prettier.every((call) => call.cwd === fs.realpathSync(worktree)));
});

test("a written file with an unusual name is formatted", () => {
  const file = write(path.join(worktree, "src", "-[id] š.md"), "#  Title  \n");
  const run = runHook(file, "Write");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.readFileSync(file, "utf8"), "# Title\n");
});

test("unsupported files are left as they are", () => {
  const file = write(path.join(worktree, "data.bin"), "keep   spaces\n");
  assert.equal(runHook(file).status, 0);
  assert.equal(fs.readFileSync(file, "utf8"), "keep   spaces\n");
});

test("environment files are never handed to the formatter", () => {
  const file = write(path.join(worktree, ".env.local"), "A=1\n");
  const before = toolCalls(worktree).length;
  const run = runHook(file);
  assert.equal(run.status, 0);
  assert.equal(run.output, null);
  assert.equal(toolCalls(worktree).length, before);
});

test("files outside this repository are not touched", () => {
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-elsewhere-"));
  after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  installFakeTools(elsewhere);
  const file = write(path.join(elsewhere, "app.js"), "const  a = 1;\n");
  const run = runHook(file);
  assert.equal(run.status, 0);
  assert.equal(run.output, null);
  assert.equal(fs.readFileSync(file, "utf8"), "const  a = 1;\n");
});

test("a link that leads out of the worktree is not followed", () => {
  const outside = write(path.join(fixture.dir, "outside.js"), "const  a = 1;\n");
  const link = path.join(worktree, "linked.js");
  fs.symlinkSync(outside, link);
  const run = runHook(link);
  assert.equal(run.status, 0);
  assert.equal(fs.readFileSync(outside, "utf8"), "const  a = 1;\n");
});

test("a formatting failure is returned to the agent", () => {
  const file = write(path.join(worktree, "src", "broken.js"), "SYNTAX-ERROR\n");
  const run = runHook(file);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.output.decision, "block");
  assert.match(run.output.reason, /src\/broken\.js/);
  assert.match(run.output.reason, /SyntaxError/);
});

test("missing tools are reported with the command that installs them", () => {
  const file = write(path.join(bare, "src", "app.js"), "const  a = 1;\n");
  const run = runHook(file);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.output.decision, "block");
  assert.match(run.output.reason, /pnpm install --frozen-lockfile/);
  assert.ok(run.output.reason.includes(bare));
  assert.equal(fs.readFileSync(file, "utf8"), "const  a = 1;\n");
});
