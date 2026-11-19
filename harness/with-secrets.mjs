#!/usr/bin/env node
// Runs one command with the owner's secrets — see docs/permissions.md ("Environment files").
//
//   node harness/with-secrets.mjs -- <command> [arguments...]
//
// The secrets live only in the main checkout's `.env.secrets` (placeholders in
// `.env.secrets.example`), which agents may not read; worktrees never get a copy. This script
// finds the main checkout from the current folder, also inside a worktree, and gives the values to
// the command's process only. A variable already set in the environment wins, so CI passes its
// repository secret the same way. Nothing is printed: the command's output is its own.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const SECRETS_FILE = ".env.secrets";

// The main checkout of the repository that contains `cwd`: the folder above the common Git
// directory, which a linked worktree shares with it.
export function mainCheckoutOf(cwd) {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  return path.dirname(common);
}

// The environment for the command: the main checkout's secrets under the given environment.
export function secretsEnvironment({ cwd = process.cwd(), env = process.env } = {}) {
  let secrets = {};
  try {
    secrets = parseEnv(fs.readFileSync(path.join(mainCheckoutOf(cwd), SECRETS_FILE), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { ...secrets, ...env };
}

function main(argv) {
  const separator = argv.indexOf("--");
  const [command, ...args] = separator === -1 ? [] : argv.slice(separator + 1);
  if (!command) {
    process.stderr.write("Usage: node harness/with-secrets.mjs -- <command> [arguments...]\n");
    process.exitCode = 2;
    return;
  }
  const child = spawn(command, args, { stdio: "inherit", env: secretsEnvironment() });
  child.on("error", (error) => {
    process.stderr.write(`with-secrets: could not start ${command}: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
