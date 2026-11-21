import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import {
  MAX_SLOTS,
  PORT_VARIABLES,
  allocateSlot,
  basePortsFrom,
  databaseName,
  emptyState,
  envFileContent,
  freeSlot,
  portsForSlot,
  existingIssueBranch,
  slotOf,
  storageWorktreeName,
  worktreeDirName,
} from "./slots.mjs";

// The base ports are configuration: they come from the documented example, never from the code.
const EXAMPLE_FILE = path.join(import.meta.dirname, "..", "..", ".env.example");
const example = parseEnv(fs.readFileSync(EXAMPLE_FILE, "utf8"));
const base = basePortsFrom(example);
const shifted = (by) =>
  Object.fromEntries(Object.entries(base).map(([name, port]) => [name, port + by]));

test("the documented example configures the base port of every service", () => {
  assert.deepEqual(PORT_VARIABLES, ["WEB_PORT", "API_PORT", "MCP_ADMIN_PORT", "LLM_AGENT_PORT"]);
  for (const name of PORT_VARIABLES) assert.equal(base[name], Number(example[name]));
});

test("slot 0 is the main checkout with the base ports", () => {
  assert.deepEqual(portsForSlot(0, base), base);
});

test("slot N shifts every port by N x 10", () => {
  assert.deepEqual(portsForSlot(3, base), shifted(30));
});

test("every service needs a base port", () => {
  for (const name of PORT_VARIABLES) {
    const incomplete = { ...example };
    delete incomplete[name];
    assert.throws(() => basePortsFrom(incomplete), new RegExp(`${name} is not set`));
  }
});

test("a base port must be a whole port number", () => {
  for (const value of ["", "abc", "30.5", "-1", "0", " 1"]) {
    assert.throws(() => basePortsFrom({ ...example, API_PORT: value }), /API_PORT must be/);
  }
});

test("a base port leaves room for the ports of every slot", () => {
  const highest = String(2 ** 16 - 1);
  assert.throws(() => basePortsFrom({ ...example, LLM_AGENT_PORT: highest }), /LLM_AGENT_PORT/);
});

test("ports are refused for a slot out of range", () => {
  assert.throws(() => portsForSlot(-1, base), RangeError);
  assert.throws(() => portsForSlot(MAX_SLOTS + 1, base), RangeError);
  assert.throws(() => portsForSlot(1.5, base), RangeError);
});

test("the first worktree gets slot 1", () => {
  const { slot } = allocateSlot(emptyState(), "feat-1-a");
  assert.equal(slot, 1);
});

test("allocation takes the lowest free slot", () => {
  let state = emptyState();
  ({ state } = allocateSlot(state, "a"));
  ({ state } = allocateSlot(state, "b"));
  ({ state } = allocateSlot(state, "c"));
  state = freeSlot(state, "b");
  const { slot } = allocateSlot(state, "d");
  assert.equal(slot, 2);
});

test("allocation is idempotent for the same owner", () => {
  const first = allocateSlot(emptyState(), "a");
  const second = allocateSlot(first.state, "a");
  assert.equal(second.slot, first.slot);
  assert.equal(second.state, first.state);
});

test("allocation fails when all slots are taken", () => {
  let state = emptyState();
  for (let i = 0; i < MAX_SLOTS; i += 1) ({ state } = allocateSlot(state, `w${i}`));
  assert.throws(() => allocateSlot(state, "one-too-many"), /no free worktree slot/);
});

test("allocation does not mutate the previous state", () => {
  const state = emptyState();
  allocateSlot(state, "a");
  assert.deepEqual(state, emptyState());
});

test("freeing releases only the owner's slot", () => {
  let state = emptyState();
  ({ state } = allocateSlot(state, "a"));
  ({ state } = allocateSlot(state, "b"));
  state = freeSlot(state, "a");
  assert.equal(slotOf(state, "a"), null);
  assert.equal(slotOf(state, "b"), 2);
});

test("freeing an unknown owner changes nothing", () => {
  let state = emptyState();
  ({ state } = allocateSlot(state, "a"));
  assert.deepEqual(freeSlot(state, "nobody"), state);
});

test("folder names come from branch names", () => {
  assert.equal(worktreeDirName("feat/12-profile-experience-api"), "feat-12-profile-experience-api");
  assert.equal(worktreeDirName("docs/00-overview-planning"), "docs-00-overview-planning");
  assert.equal(worktreeDirName("  fix//weird name!!  "), "fix-weird-name");
  assert.throws(() => worktreeDirName("///"), /cannot derive/);
});

// A database name a worktree can own: a lowercase, unquoted Postgres identifier within the
// 63-byte limit, recognisably marked as a worktree database.
const WORKTREE_DATABASE = /^wt_[a-z0-9_]+$/;
const POSTGRES_IDENTIFIER_LIMIT = 63;

function assertWorktreeDatabase(name) {
  assert.match(name, WORKTREE_DATABASE);
  assert.ok(Buffer.byteLength(name) <= POSTGRES_IDENTIFIER_LIMIT, `${name} is too long`);
}

test("a database name is a readable identifier derived from the branch", () => {
  const name = databaseName("feat/12-profile-experience-api");
  assertWorktreeDatabase(name);
  assert.ok(name.startsWith("wt_feat_12_profile_experience_api_"), name);
  assert.equal(databaseName("feat/12-profile-experience-api"), name);
});

test("a branch and its worktree folder name give the same database", () => {
  for (const branch of ["feat/12-profile-api", "  Fix//Weird Name!! ", "docs/v1.2-notes"]) {
    assert.equal(databaseName(worktreeDirName(branch)), databaseName(branch), branch);
  }
});

test("worktrees whose names normalise alike still get different databases", () => {
  const branches = ["feat/a.b", "feat/a-b", "feat/a_b", "feat/A-B", "Feat/a-b"];
  const names = branches.map((branch) => databaseName(branch));
  for (const name of names) assertWorktreeDatabase(name);
  assert.equal(new Set(names).size, branches.length, names.join(", "));
});

test("a long branch name is shortened to the identifier limit and stays distinct", () => {
  const common = `feat/${"very-long-branch-name-".repeat(10)}`;
  const first = databaseName(`${common}one`);
  const second = databaseName(`${common}two`);
  assertWorktreeDatabase(first);
  assertWorktreeDatabase(second);
  assert.ok(first.startsWith("wt_feat_very_long_branch_name_very_long_"), first);
  assert.notEqual(first, second);
});

test("unusual branch names give valid database names", () => {
  for (const branch of [
    "12-starts-with-digit",
    "fix/čeština-ŘÍZENÍ",
    "feat/emoji-🚀-x",
    "a",
    "_x_",
    "x.y.z",
  ]) {
    assertWorktreeDatabase(databaseName(branch));
  }
});

test("a database name needs a branch with usable characters", () => {
  assert.throws(() => databaseName("///"), /cannot derive/);
  assert.throws(() => databaseName(""), /cannot derive/);
});

// The folder rule of the storage key prefix (packages/services, storage keys).
const STORAGE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,62}$/;

test("a storage folder name is a readable key segment derived from the branch", () => {
  const name = storageWorktreeName("feat/12-Profile_Experience.API");
  assert.match(name, STORAGE_SEGMENT);
  assert.ok(name.startsWith("feat-12-profile-experience-api-"), name);
  assert.equal(storageWorktreeName(worktreeDirName("feat/12-Profile_Experience.API")), name);
});

test("worktrees whose names normalise alike still get different storage folders", () => {
  const branches = ["feat/a.b", "feat/a-b", "feat/a_b", "feat/A-B", "Feat/a-b"];
  const names = branches.map((branch) => storageWorktreeName(branch));
  for (const name of names) assert.match(name, STORAGE_SEGMENT);
  assert.equal(new Set(names).size, branches.length, names.join(", "));
});

test("unusual and long branch names give valid storage folders", () => {
  const long = `feat/${"very-long-branch-name-".repeat(10)}`;
  for (const branch of ["_x_", "fix/čeština", "a", `${long}one`, `${long}two`, "-.-x"]) {
    assert.match(storageWorktreeName(branch), STORAGE_SEGMENT, branch);
  }
  assert.notEqual(storageWorktreeName(`${long}one`), storageWorktreeName(`${long}two`));
  assert.throws(() => storageWorktreeName("///"), /cannot derive/);
});

test("the environment file carries the slot and its ports", () => {
  const content = { ...parseEnv(envFileContent(2, base, { EXTRA: "x" })) };
  assert.deepEqual(content, {
    WORKTREE_SLOT: "2",
    ...Object.fromEntries(Object.entries(shifted(20)).map(([name, port]) => [name, String(port)])),
    EXTRA: "x",
  });
});

// --- resuming an issue's earlier branch ------------------------------------------

test("an earlier branch of the same issue is found under another name", () => {
  const branches = [
    "master",
    "phase/01-foundation",
    "feat/17-hardcoded-config-check",
    "origin/feat/18-postgres",
  ];
  assert.equal(
    existingIssueBranch("feat/17-reject-hardcoded-endpoints", branches),
    "feat/17-hardcoded-config-check",
  );
  assert.equal(existingIssueBranch("fix/18-other-name", branches), "feat/18-postgres");
});

test("the requested branch itself, other issues and branches without an issue are not matches", () => {
  const branches = [
    "feat/17-hardcoded-config-check",
    "feat/170-other",
    "docs/finalize-phase-plans",
  ];
  assert.equal(existingIssueBranch("feat/17-hardcoded-config-check", branches), null);
  assert.equal(existingIssueBranch("feat/1-x", branches), null);
  assert.equal(existingIssueBranch("docs/finalize-phase-plans-2", branches), null);
});

test("a local branch is preferred over a remote one of the same issue", () => {
  assert.equal(existingIssueBranch("feat/5-b", ["origin/feat/5-a", "feat/5-c"]), "feat/5-c");
});

// Issue 323: `docs/15-pages-decisions` was set up on the merged `docs/15-pages-prd`, because the
// phase number of `.plan/15-pages/` was read as an issue number.
test("a branch that is not cut from a phase branch continues no other branch", () => {
  const branches = ["master", "docs/15-pages-prd", "feat/18-postgres", "origin/feat/19-search"];
  for (const base of ["origin/master", "master", "HEAD", "docs/15-pages-prd"]) {
    assert.equal(existingIssueBranch("docs/15-pages-decisions", branches, { base }), null, base);
    assert.equal(existingIssueBranch("fix/18-other-name", branches, { base }), null, base);
    assert.equal(existingIssueBranch("fix/19-other-name", branches, { base }), null, base);
  }
});

test("an issue branch cut from a phase branch, local or remote, continues the issue's branch", () => {
  const branches = ["master", "phase/02-api-db", "feat/18-postgres", "origin/feat/19-search"];
  for (const base of ["phase/02-api-db", "origin/phase/02-api-db", "origin/phase/07.1-gateway"]) {
    assert.equal(
      existingIssueBranch("fix/18-other-name", branches, { base }),
      "feat/18-postgres",
      base,
    );
    assert.equal(
      existingIssueBranch("docs/19-other-name", branches, { base }),
      "feat/19-search",
      base,
    );
  }
});

test("a phase branch is never continued on an issue branch of the same number", () => {
  const branches = ["master", "feat/15-profile-api", "origin/fix/15-profile-api"];
  assert.equal(existingIssueBranch("phase/15-pages", branches), null);
  assert.equal(existingIssueBranch("phase/15-pages", branches, { base: "origin/master" }), null);
  assert.equal(existingIssueBranch("phase/15-pages", branches, { base: "phase/14-search" }), null);
});

test("an issue branch is never continued on a phase branch of the same number", () => {
  const branches = ["master", "phase/15-pages", "origin/phase/15-pages", "origin/phase/15-other"];
  assert.equal(existingIssueBranch("feat/15-profile-api", branches), null);
  assert.equal(
    existingIssueBranch("feat/15-profile-api", branches, { base: "origin/phase/15-pages" }),
    null,
  );
});

test("branches named after a phase folder do not share an issue", () => {
  // Cut from the phase branch itself.
  assert.equal(
    existingIssueBranch("docs/15-pages-decisions", ["docs/15-pages-prd", "chore/15-pages"], {
      base: "origin/phase/15-pages",
    }),
    null,
  );
  // The phase is known from its branch, whatever the base.
  for (const phase of ["phase/15-pages", "origin/phase/15-pages"]) {
    const branches = ["master", phase, "docs/15-pages-prd", "origin/chore/15-pages-plan-done"];
    assert.equal(existingIssueBranch("docs/15-pages-decisions", branches), null, phase);
    assert.equal(
      existingIssueBranch("docs/15-pages-decisions", branches, { base: "phase/14-search" }),
      null,
      phase,
    );
  }
  // An issue of the same number under another slug is still an issue.
  assert.equal(
    existingIssueBranch("feat/15-profile-api", ["docs/15-pages-prd", "fix/15-profile"], {
      base: "origin/phase/15-pages",
    }),
    "fix/15-profile",
  );
});

test("a zero-padded number is a phase number, never an issue number", () => {
  const branches = ["chore/06-llm-agent-plan-done", "origin/docs/06-llm-agent-prd"];
  assert.equal(existingIssueBranch("docs/06-llm-agent-decisions", branches), null);
  assert.equal(
    existingIssueBranch("docs/06-llm-agent-decisions", branches, { base: "phase/05-chat" }),
    null,
  );
});

test("only the documented branch types carry an issue number", () => {
  const base = "origin/phase/02-api-db";
  assert.equal(existingIssueBranch("wip/17-a", ["feat/17-b"], { base }), null);
  assert.equal(existingIssueBranch("feat/17-a", ["wip/17-b", "release/17-c"], { base }), null);
  for (const type of ["feat", "fix", "docs", "refactor", "test", "chore", "ci"]) {
    assert.equal(existingIssueBranch(`${type}/17-a`, ["feat/17-b"], { base }), "feat/17-b", type);
    assert.equal(existingIssueBranch("feat/17-a", [`${type}/17-b`], { base }), `${type}/17-b`);
  }
});

test("a merged branch is not continued", () => {
  const base = "origin/phase/02-api-db";
  const asked = [];
  const merged = (...args) => {
    asked.push(args);
    return args[0] === "feat/17-merged" || args[0] === "origin/feat/17-merged-remote";
  };
  assert.equal(existingIssueBranch("fix/17-again", ["feat/17-merged"], { base, merged }), null);
  assert.equal(
    existingIssueBranch("fix/17-again", ["feat/17-merged", "origin/feat/17-merged-remote"], {
      base,
      merged,
    }),
    null,
  );
  assert.equal(
    existingIssueBranch(
      "fix/17-again",
      ["feat/17-merged", "feat/18-other", "origin/feat/17-merged-remote", "origin/feat/17-open"],
      { base, merged },
    ),
    "feat/17-open",
  );
  // Only branches of the same issue are looked at, under the name they were listed with.
  assert.deepEqual(
    [...new Set(asked.flat())].sort(),
    ["feat/17-merged", "origin/feat/17-merged-remote", "origin/feat/17-open"].sort(),
  );
});
