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
  slotOf,
  worktreeDirName,
} from "./slots.mjs";

// The base ports are configuration: they come from the documented example, never from the code.
const EXAMPLE_FILE = path.join(import.meta.dirname, "..", "..", "..", ".env.example");
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
  assert.equal(first.length, POSTGRES_IDENTIFIER_LIMIT);
  assert.notEqual(first, second);
});

test("unusual branch names give valid database names", () => {
  for (const branch of ["12-starts-with-digit", "fix/čeština-ŘÍZENÍ", "feat/emoji-🚀-x", "a", "_x_", "x.y.z"]) {
    assertWorktreeDatabase(databaseName(branch));
  }
});

test("a database name needs a branch with usable characters", () => {
  assert.throws(() => databaseName("///"), /cannot derive/);
  assert.throws(() => databaseName(""), /cannot derive/);
});

test("the environment file carries the slot and its ports", () => {
  const content = { ...parseEnv(envFileContent(2, base, { EXTRA: "x" })) };
  assert.deepEqual(content, {
    WORKTREE_SLOT: "2",
    ...Object.fromEntries(Object.entries(shifted(20)).map(([name, port]) => [name, String(port)])),
    EXTRA: "x",
  });
});
