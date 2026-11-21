#!/usr/bin/env node
// Runs a command while holding a lock shared by the main checkout and every worktree, so that at
// most one such command of the same name runs on the machine at a time:
//
//   node harness/one-at-a-time.mjs <name> -- <command> [arguments...]
//
// Used for the website's browser tests: each run starts its own API, website and browsers, and
// several runs at once from parallel phase loops exhaust the memory of a small shared server.
// The lock is a folder in the main checkout's `.worktrees/locks/` (ignored by Git), created
// atomically; it records the holder's process and folder. A lock whose process no longer runs is
// taken over. A waiting caller says once who holds the lock and gives up after `ONE_AT_A_TIME_MAX_WAIT_MINUTES`
// (default 60). Plain Node, no dependencies.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { mainCheckoutOf } from "./with-secrets.mjs";

const NAME = /^[a-z][a-z0-9-]{0,40}$/;
const HOLDER_FILE = "holder.json";

function processRuns(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function readHolder(lockDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockDir, HOLDER_FILE), "utf8"));
  } catch {
    return null;
  }
}

// Takes the lock `<dir>/<name>.lock`, waiting while a running process holds it. Resolves to
// `{ release }`; rejects when `name` is not a plain word or the wait exceeds `maxWaitMs`.
export async function acquire({
  dir,
  name,
  pid = process.pid,
  cwd = process.cwd(),
  isAlive = processRuns,
  pollMs = 5000,
  maxWaitMs = 60 * 60 * 1000,
  onWait = () => {},
  now = () => Date.now(),
}) {
  if (!NAME.test(name)) throw new Error(`not a lock name: "${name}"`);
  fs.mkdirSync(dir, { recursive: true });
  const lockDir = path.join(dir, `${name}.lock`);
  const started = now();
  let reported = false;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(
        path.join(lockDir, HOLDER_FILE),
        JSON.stringify({ pid, cwd, started: new Date(now()).toISOString() }),
      );
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          fs.rmSync(lockDir, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const holder = readHolder(lockDir);
    // A holder that has not written its file yet is given one more poll before it counts as gone.
    if (holder && !isAlive(holder.pid)) {
      fs.rmSync(lockDir, { recursive: true, force: true });
      continue;
    }
    if (holder && !reported) {
      reported = true;
      onWait(holder);
    }
    if (now() - started >= maxWaitMs) {
      throw new Error(
        `the ${name} lock is still held by process ${holder?.pid ?? "?"} in ${holder?.cwd ?? "?"}; giving up`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (!holder && !fs.existsSync(path.join(lockDir, HOLDER_FILE)) && fs.existsSync(lockDir)) {
      const age = now() - fs.statSync(lockDir).mtimeMs;
      if (age > pollMs * 2) fs.rmSync(lockDir, { recursive: true, force: true });
    }
  }
}

async function main(argv) {
  const separator = argv.indexOf("--");
  const name = argv[0];
  const [command, ...args] = separator === -1 ? [] : argv.slice(separator + 1);
  if (!name || separator !== 1 || !command) {
    process.stderr.write(
      "Usage: node harness/one-at-a-time.mjs <name> -- <command> [arguments...]\n",
    );
    return 2;
  }
  const minutes = Number(process.env["ONE_AT_A_TIME_MAX_WAIT_MINUTES"] ?? 60);
  const lock = await acquire({
    dir: path.join(mainCheckoutOf(process.cwd()), ".worktrees", "locks"),
    name,
    maxWaitMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60 * 1000,
    onWait: (holder) =>
      process.stderr.write(
        `one-at-a-time: waiting for the ${name} run of process ${holder.pid} in ${holder.cwd} (since ${holder.started})\n`,
      ),
  });
  const child = spawn(command, args, { stdio: "inherit" });
  const forward = (signal) => child.kill(signal);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, forward);
  return await new Promise((resolve) => {
    child.on("error", (error) => {
      lock.release();
      process.stderr.write(`one-at-a-time: ${error.message}\n`);
      resolve(127);
    });
    child.on("exit", (code, signal) => {
      lock.release();
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`one-at-a-time: ${error.message}\n`);
      process.exit(1);
    },
  );
}
