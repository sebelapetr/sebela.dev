import { test } from "node:test";
import assert from "node:assert/strict";
import { selectChecks, turboArguments, worktreesNamedIn } from "./handoff.mjs";

const MAIN = "/work/sebela";
const MEMBERS = [
  { dir: "apps/web", name: "@fixture/web" },
  { dir: "packages/alpha", name: "@fixture/alpha" },
  { dir: "packages/alpha-two", name: "@fixture/alpha-two" },
];

function transcript(...toolUses) {
  const lines = toolUses.map(([name, input]) =>
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name, input }] },
    }),
  );
  return [JSON.stringify({ type: "user", message: { content: "start" } }), ...lines].join("\n");
}

test("finds the worktrees the agent edited or ran commands in", () => {
  const text = transcript(
    ["Edit", { file_path: `${MAIN}/.worktrees/feat-1-a/apps/web/src/index.ts` }],
    ["Bash", { command: `cd ${MAIN}/.worktrees/feat-2-b && pnpm test` }],
    ["MultiEdit", { file_path: `${MAIN}/.worktrees/feat-1-a/README.md`, edits: [] }],
    ["Write", { file_path: `${MAIN}/.worktrees/feat-3-c` }],
  );
  assert.deepEqual(worktreesNamedIn(text, MAIN), [
    `${MAIN}/.worktrees/feat-1-a`,
    `${MAIN}/.worktrees/feat-2-b`,
    `${MAIN}/.worktrees/feat-3-c`,
  ]);
});

test("ignores worktrees the agent only read about", () => {
  const text = [
    transcript(["Read", { file_path: `${MAIN}/.worktrees/feat-9-other/package.json` }]),
    transcript(["Grep", { path: `${MAIN}/.worktrees/feat-9-other` }]),
    JSON.stringify({ type: "user", message: { content: `${MAIN}/.worktrees/feat-8-prompt` } }),
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", content: `${MAIN}/.worktrees/feat-7-listed` }] },
    }),
  ].join("\n");
  assert.deepEqual(worktreesNamedIn(text, MAIN), []);
});

test("ignores other repositories, the worktree bookkeeping and unreadable lines", () => {
  const text = [
    transcript(
      ["Edit", { file_path: `/elsewhere/.worktrees/feat-1-a/x.ts` }],
      ["Edit", { file_path: `${MAIN}-copy/.worktrees/feat-1-a/x.ts` }],
      ["Bash", { command: `ls ${MAIN}/.worktrees/` }],
      ["Bash", { command: `cat ${MAIN}/.worktrees/.slots.json` }],
    ),
    "{ not json",
  ].join("\n");
  assert.deepEqual(worktreesNamedIn(text, MAIN), []);
});

test("escapes the main checkout path", () => {
  const main = "/work/se+bela (1)";
  const text = transcript(["Edit", { file_path: `${main}/.worktrees/feat-1-a/x.ts` }]);
  assert.deepEqual(worktreesNamedIn(text, main), [`${main}/.worktrees/feat-1-a`]);
  assert.deepEqual(worktreesNamedIn(text.replace("se+bela", "seebela"), main), []);
});

test("a changed file selects its package", () => {
  assert.deepEqual(selectChecks(["apps/web/src/index.ts"], MEMBERS), {
    all: false,
    packages: ["@fixture/web"],
  });
});

test("several files select each package once, in order", () => {
  const files = [
    "packages/alpha-two/a.ts",
    "packages/alpha/b.ts",
    "packages/alpha/c.ts",
    "apps/web/d.ts",
  ];
  assert.deepEqual(selectChecks(files, MEMBERS).packages, [
    "@fixture/alpha",
    "@fixture/alpha-two",
    "@fixture/web",
  ]);
});

test("root files select only the root checks", () => {
  assert.deepEqual(selectChecks(["harness/lib/x.mjs", "docs/testing.md"], MEMBERS), {
    all: false,
    packages: [],
  });
  assert.deepEqual(selectChecks(["packages/new-package/x.ts"], MEMBERS), {
    all: false,
    packages: [],
  });
});

test("workspace-wide configuration selects everything", () => {
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "turbo.json",
    ".nvmrc",
  ]) {
    assert.deepEqual(selectChecks(["apps/web/x.ts", file], MEMBERS), { all: true }, file);
  }
  assert.deepEqual(selectChecks(["apps/web/package.json"], MEMBERS).all, false);
});

test("an unknown change base selects everything; no change selects nothing", () => {
  assert.deepEqual(selectChecks(null, MEMBERS), { all: true });
  assert.equal(selectChecks([], MEMBERS), null);
});

test("Turborepo runs lint and typecheck of the selected packages, their dependents and the root", () => {
  assert.deepEqual(turboArguments({ all: false, packages: ["@fixture/alpha", "@fixture/web"] }), [
    "run",
    "lint",
    "typecheck",
    "lint:root",
    "check:config",
    "--continue",
    "--output-logs=errors-only",
    "--filter=//",
    "--filter=@fixture/alpha...",
    "--filter=@fixture/web...",
  ]);
  assert.deepEqual(turboArguments({ all: false, packages: [] }).slice(-1), ["--filter=//"]);
  assert.ok(!turboArguments({ all: true }).some((arg) => arg.startsWith("--filter")));
  assert.ok(!turboArguments({ all: true }).includes("test"));
});
