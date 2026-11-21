import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { acquire } from "./one-at-a-time.mjs";

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "one-at-a-time-"));
const alive = new Set([process.pid]);
const isAlive = (pid) => alive.has(pid);

test("the first caller gets the lock and its release frees it", async () => {
  const dir = tempDir();
  const first = await acquire({ dir, name: "e2e", pid: process.pid, cwd: "/a", isAlive });
  assert.ok(fs.existsSync(path.join(dir, "e2e.lock")));
  first.release();
  assert.equal(fs.existsSync(path.join(dir, "e2e.lock")), false);
});

test("a second caller waits until the holder releases", async () => {
  const dir = tempDir();
  const first = await acquire({ dir, name: "e2e", pid: process.pid, cwd: "/a", isAlive });
  const waits = [];
  let acquired = false;
  const second = acquire({
    dir,
    name: "e2e",
    pid: process.pid,
    cwd: "/b",
    isAlive,
    pollMs: 10,
    onWait: (holder) => waits.push(holder),
  }).then((lock) => {
    acquired = true;
    return lock;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(acquired, false);
  assert.equal(waits.length, 1);
  assert.equal(waits[0].cwd, "/a");
  first.release();
  (await second).release();
  assert.equal(acquired, true);
});

test("a lock left by a process that no longer runs is taken over", async () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, "e2e.lock"));
  fs.writeFileSync(
    path.join(dir, "e2e.lock", "holder.json"),
    JSON.stringify({ pid: 999999, cwd: "/gone", started: "2026-01-01T00:00:00.000Z" }),
  );
  const lock = await acquire({
    dir,
    name: "e2e",
    pid: process.pid,
    cwd: "/a",
    isAlive,
    pollMs: 10,
  });
  const holder = JSON.parse(fs.readFileSync(path.join(dir, "e2e.lock", "holder.json"), "utf8"));
  assert.equal(holder.cwd, "/a");
  lock.release();
});

test("waiting gives up after the limit with a clear error", async () => {
  const dir = tempDir();
  const first = await acquire({ dir, name: "e2e", pid: process.pid, cwd: "/a", isAlive });
  await assert.rejects(
    acquire({ dir, name: "e2e", pid: process.pid, cwd: "/b", isAlive, pollMs: 10, maxWaitMs: 40 }),
    /still held by .*\/a/,
  );
  first.release();
});

test("names other than plain words are refused", async () => {
  await assert.rejects(acquire({ dir: tempDir(), name: "../x", pid: 1, cwd: "/a" }), /name/);
});
