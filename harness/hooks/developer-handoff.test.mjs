// The handoff gate: lint and typecheck of what a developer agent changed, run when it hands back
// its report (PreToolUse on SubagentHandback) and when it stops (SubagentStop). Run as Claude Code
// runs it, against a disposable repository with a phase branch, an issue worktree and a fake
// Turborepo (../lib/hook-fixtures.mjs).

import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRepo, git, installFakeTools, toolCalls } from "../lib/hook-fixtures.mjs";

const HOOK = path.join(import.meta.dirname, "developer-handoff.mjs");

const fixture = createRepo("sebela-handoff-");
after(fixture.cleanup);
const main = fixture.repo;
const write = (root, file, content = "export {};\n") => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
write(main, "apps/web/package.json", JSON.stringify({ name: "@fixture/web" }));
write(main, "packages/alpha/package.json", JSON.stringify({ name: "@fixture/alpha" }));
write(main, "packages/beta/package.json", JSON.stringify({ name: "@fixture/beta" }));
git(main, "add", ".");
git(main, "commit", "-m", "chore: add members");
// Work already on the phase branch is not the developer's change.
git(main, "switch", "-c", "phase/01-fixture");
write(main, "packages/alpha/src/index.ts");
git(main, "add", ".");
git(main, "commit", "-m", "feat(alpha): add alpha");
git(main, "switch", "master");

const worktree = path.join(main, ".worktrees", "feat-1-fixture");
git(main, "worktree", "add", "-b", "feat/1-fixture", worktree, "phase/01-fixture");
installFakeTools(worktree, { turbo: true });
// The developer commits one change and leaves another untracked.
write(worktree, "apps/web/src/index.ts");
git(worktree, "add", ".");
git(worktree, "commit", "-m", "feat(web): add web");
write(worktree, "packages/beta/src/index.ts");

const transcripts = path.join(fixture.dir, "transcripts");
const SESSION = "session-1";

// Writes the developer's transcript where Claude Code keeps subagent transcripts.
function transcript(agentId, toolUses) {
  const file = path.join(transcripts, SESSION, "subagents", `agent-${agentId}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = toolUses.map(([name, input]) =>
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name, input }] },
    }),
  );
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

const EDITED = [["Edit", { file_path: path.join(worktree, "apps/web/src/index.ts") }]];

function runHook(input) {
  const run = spawnSync(process.execPath, [HOOK], {
    cwd: main,
    env: { ...process.env, CLAUDE_PROJECT_DIR: main },
    input: JSON.stringify({
      session_id: SESSION,
      transcript_path: path.join(transcripts, `${SESSION}.jsonl`),
      cwd: main,
      ...input,
    }),
    encoding: "utf8",
  });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
  return run.stdout ? JSON.parse(run.stdout) : null;
}

function handback(agentType = "backend-developer", agentId = "dev1") {
  return runHook({
    hook_event_name: "PreToolUse",
    tool_name: "SubagentHandback",
    tool_input: { message: "Done." },
    agent_id: agentId,
    agent_type: agentType,
  });
}

function stop(extra = {}) {
  return runHook({
    hook_event_name: "SubagentStop",
    agent_id: "dev1",
    agent_type: "backend-developer",
    agent_transcript_path: transcript("dev1", EDITED),
    stop_hook_active: false,
    ...extra,
  });
}

const turboCalls = () => toolCalls(worktree).filter((call) => call.tool === "turbo");
const failing = (on) =>
  on
    ? fs.writeFileSync(path.join(worktree, "turbo-fails"), "")
    : fs.rmSync(path.join(worktree, "turbo-fails"), { force: true });

beforeEach(() => {
  fs.rmSync(path.join(worktree, "tool-calls.jsonl"), { force: true });
  failing(false);
  transcript("dev1", EDITED);
});

test("a developer hands back when lint and typecheck of its changes pass", () => {
  assert.equal(handback(), null);
  const [call, ...more] = turboCalls();
  assert.equal(more.length, 0);
  assert.equal(call.cwd, fs.realpathSync(worktree));
  assert.deepEqual(call.args.slice(0, 3), ["run", "lint", "typecheck"]);
});

test("only the packages changed since the phase branch are checked, with their dependents", () => {
  handback();
  const filters = turboCalls()[0].args.filter((arg) => arg.startsWith("--filter="));
  assert.deepEqual(filters, [
    "--filter=//",
    "--filter=@fixture/beta...",
    "--filter=@fixture/web...",
  ]);
});

test("a failing check refuses the handback with actionable output", () => {
  failing(true);
  const output = handback();
  const decision = output.hookSpecificOutput;
  assert.equal(decision.permissionDecision, "deny");
  assert.match(decision.permissionDecisionReason, /TS2322/);
  assert.ok(decision.permissionDecisionReason.includes(worktree));
  assert.match(decision.permissionDecisionReason, /lint/);
  assert.match(decision.permissionDecisionReason, /typecheck/);
});

test("a failing check keeps a stopping developer working", () => {
  failing(true);
  const output = stop();
  assert.equal(output.decision, "block");
  assert.match(output.reason, /TS2322/);
});

test("after one continued attempt a still failing check is reported instead of blocking again", () => {
  failing(true);
  const output = stop({ stop_hook_active: true });
  assert.equal(output.decision, undefined);
  assert.match(output.systemMessage, /still fail/);
  assert.match(output.systemMessage, /TS2322/);
});

test("a passing stop says nothing", () => {
  assert.equal(stop(), null);
  assert.equal(turboCalls().length, 1);
});

test("other agents and the main session are not checked", () => {
  failing(true);
  transcript("rev1", EDITED);
  assert.equal(handback("reviewer", "rev1"), null);
  assert.equal(
    runHook({
      hook_event_name: "PreToolUse",
      tool_name: "SubagentHandback",
      tool_input: { message: "x" },
    }),
    null,
  );
  assert.equal(turboCalls().length, 0);
});

test("a developer that changed nothing has nothing to check", () => {
  failing(true);
  transcript("dev2", [["Read", { file_path: path.join(worktree, "apps/web/src/index.ts") }]]);
  assert.equal(handback("frontend-developer", "dev2"), null);
  assert.equal(turboCalls().length, 0);
});

test("a developer running inside its worktree is checked there", () => {
  failing(true);
  transcript("dev3", []);
  const output = runHook({
    hook_event_name: "PreToolUse",
    tool_name: "SubagentHandback",
    tool_input: { message: "x" },
    agent_id: "dev3",
    agent_type: "ai-developer",
    cwd: path.join(worktree, "apps", "web"),
  });
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
});

test("without a readable transcript the handback is refused, not waved through", () => {
  const output = handback("backend-developer", "missing");
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /could not/i);
});

test("missing tools in the worktree refuse the handback and say how to install them", () => {
  const bare = path.join(main, ".worktrees", "feat-2-no-tools");
  git(main, "worktree", "add", "-b", "feat/2-no-tools", bare, "phase/01-fixture");
  write(bare, "apps/web/src/other.ts");
  transcript("dev4", [["Write", { file_path: path.join(bare, "apps/web/src/other.ts") }]]);
  const output = handback("backend-developer", "dev4");
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  assert.match(
    output.hookSpecificOutput.permissionDecisionReason,
    /pnpm install --frozen-lockfile/,
  );
});

// --- a general agent's handoff (issue #371) ------------------------------------------

test("a general agent that changed harness, script, CI or infrastructure files is checked", () => {
  const infra = path.join(main, ".worktrees", "ci-3-fixture");
  git(main, "worktree", "add", "-b", "ci/3-fixture", infra, "phase/01-fixture");
  installFakeTools(infra, { turbo: true });
  write(infra, "harness/lib/thing.mjs");
  fs.writeFileSync(path.join(infra, "turbo-fails"), "");
  transcript("gen1", [["Write", { file_path: path.join(infra, "harness/lib/thing.mjs") }]]);
  const output = handback("general-purpose", "gen1");
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /TS2322/);
  const stopped = runHook({
    hook_event_name: "SubagentStop",
    agent_id: "gen1",
    agent_type: "general-purpose",
    agent_transcript_path: transcript("gen1", [
      ["Bash", { command: `cd ${infra} && node --test harness/` }],
    ]),
    stop_hook_active: false,
  });
  assert.equal(stopped.decision, "block");
  fs.rmSync(path.join(infra, "turbo-fails"));
  assert.equal(handback("general-purpose", "gen1"), null);
  const calls = toolCalls(infra).filter((call) => call.tool === "turbo");
  assert.deepEqual(calls.at(-1).args.slice(0, 5), [
    "run",
    "lint",
    "typecheck",
    "lint:root",
    "check:config",
  ]);
});

test("a general agent that changed no such file is not checked", () => {
  failing(true);
  // The worktree holds only app and package changes: a general agent that looked into it, or
  // researched there, hands back unchecked.
  transcript("gen2", [["Bash", { command: `cd ${worktree} && git status` }]]);
  assert.equal(handback("general-purpose", "gen2"), null);
  assert.equal(turboCalls().length, 0);
});

test("the settings run the handoff hook when a general agent stops", () => {
  const settings = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, "../../.claude/settings.json"), "utf8"),
  );
  const stopHook = settings.hooks.SubagentStop.find((entry) =>
    entry.hooks.some((hook) => hook.command.includes("developer-handoff.mjs")),
  );
  assert.deepEqual(stopHook.matcher.split("|"), [
    "backend-developer",
    "frontend-developer",
    "ai-developer",
    "general-purpose",
  ]);
});
