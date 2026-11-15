import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SLOTS,
  allocateSlot,
  emptyState,
  envFileContent,
  freeSlot,
  portsForSlot,
  slotOf,
  worktreeDirName,
} from "./slots.mjs";

test("slot 0 is the main checkout with the base ports", () => {
  assert.deepEqual(portsForSlot(0), {
    WEB_PORT: 3000,
    API_PORT: 3001,
    MCP_ADMIN_PORT: 3002,
    LLM_AGENT_PORT: 3003,
  });
});

test("slot N shifts every port by N x 10", () => {
  assert.deepEqual(portsForSlot(3), {
    WEB_PORT: 3030,
    API_PORT: 3031,
    MCP_ADMIN_PORT: 3032,
    LLM_AGENT_PORT: 3033,
  });
});

test("ports are refused for a slot out of range", () => {
  assert.throws(() => portsForSlot(-1), RangeError);
  assert.throws(() => portsForSlot(MAX_SLOTS + 1), RangeError);
  assert.throws(() => portsForSlot(1.5), RangeError);
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

test("the environment file carries the slot and its ports", () => {
  const content = envFileContent(2, { EXTRA: "x" });
  assert.match(content, /^WORKTREE_SLOT=2$/m);
  assert.match(content, /^WEB_PORT=3020$/m);
  assert.match(content, /^LLM_AGENT_PORT=3023$/m);
  assert.match(content, /^EXTRA=x$/m);
});
