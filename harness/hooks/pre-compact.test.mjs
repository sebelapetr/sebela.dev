import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const HOOK = new URL("./pre-compact.mjs", import.meta.url).pathname;

function run(input) {
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: "utf8" });
}

test("before compaction the hook tells the summary what an issue's work must keep", () => {
  const out = run({ hook_event_name: "PreCompact", trigger: "auto", custom_instructions: null });
  assert.equal(out.status, 0, out.stderr);
  for (const point of [
    /issue number/i,
    /worktree/i,
    /acceptance criteria.*verbatim/i,
    /test-first/i,
    /reviewer/i,
    /remain/i,
  ]) {
    assert.match(out.stdout, point);
  }
  assert.ok(out.stdout.length < 10_000, "Claude Code cuts instructions at 10 000 characters");
});

test("manual compaction keeps the owner's own instructions and adds ours", () => {
  const out = run({
    hook_event_name: "PreCompact",
    trigger: "manual",
    custom_instructions: "keep the CSS notes",
  });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /acceptance criteria/i);
});

test("unreadable input never blocks compaction", () => {
  const out = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" });
  assert.equal(out.status, 0);
});

test("the hook is registered for every compaction", () => {
  const settings = JSON.parse(
    fs.readFileSync(new URL("../../.claude/settings.json", import.meta.url), "utf8"),
  );
  const commands = (settings.hooks.PreCompact ?? []).flatMap((entry) =>
    entry.hooks.map((h) => h.command),
  );
  assert.ok(commands.some((command) => command.includes("harness/hooks/pre-compact.mjs")));
  assert.ok(
    (settings.hooks.PreCompact ?? []).every((entry) => !entry.matcher),
    "no matcher: manual and auto",
  );
});
