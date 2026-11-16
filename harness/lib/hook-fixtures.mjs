// Disposable Git repositories with fake workspace tools for the tests of the Git and Claude Code
// hooks. The fakes stand in for Prettier, ESLint and Turborepo at their command-line interface, so
// the hook tests run with plain Node and no installed dependencies.
//
// Fake Prettier formats *.js, *.md and *.json: runs of spaces become one space, trailing spaces go
// and the file ends with one newline. Content containing SYNTAX-ERROR fails like a parse error.
// Fake ESLint reports every JavaScript file containing `debugger`. Fake Turborepo fails when the
// file `turbo-fails` exists in the directory it runs in. Every call is logged to tool-calls.jsonl
// in that directory as { tool, args, cwd }.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOOKS_DIR = path.join(import.meta.dirname, "..", "git-hooks");

// Commits made by tests ignore the developer's own Git configuration and hooks.
export const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

const COMMON = String.raw`
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.cwd(), "tool-calls.jsonl"), JSON.stringify({ tool: TOOL, args, cwd: process.cwd() }) + "\n");
const option = (name) => {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(name + "="));
  if (index === -1) return undefined;
  return args[index].includes("=") ? args[index].slice(name.length + 1) : args[index + 1];
};
const files = args.includes("--") ? args.slice(args.indexOf("--") + 1) : [];
const stdin = () => fs.readFileSync(0, "utf8");
`;

const FAKE_PRETTIER = String.raw`
const supported = (file) => /\.(js|md|json)$/.test(file);
const format = (file, text) => {
  if (text.includes("SYNTAX-ERROR")) {
    process.stderr.write("[error] " + file + ": SyntaxError: Unexpected token (1:1)\n");
    process.exit(2);
  }
  return text.split("\n").map((line) => line.replace(/ {2,}/g, " ").replace(/ +$/, "")).join("\n").replace(/\n*$/, "\n");
};
const info = option("--file-info");
if (info !== undefined) {
  process.stdout.write(JSON.stringify({ ignored: false, inferredParser: supported(info) ? "babel" : null }) + "\n");
} else if (option("--stdin-filepath") !== undefined) {
  process.stdout.write(format(option("--stdin-filepath"), stdin()));
} else if (args.includes("--write")) {
  for (const file of files) {
    if (!supported(file)) continue;
    const before = fs.readFileSync(file, "utf8");
    const after = format(file, before);
    if (after !== before) fs.writeFileSync(file, after);
  }
} else {
  process.stderr.write("fake prettier: unsupported call\n");
  process.exit(2);
}
`;

const FAKE_ESLINT = String.raw`
const problems = [];
const lint = (file, text) => {
  if (/\.(js|mjs|cjs|ts|tsx)$/.test(file) && text.includes("debugger")) {
    problems.push(file + "\n  1:1  error  Unexpected 'debugger' statement  no-debugger");
  }
};
if (args.includes("--stdin")) lint(option("--stdin-filename"), stdin());
else for (const file of files) lint(file, fs.readFileSync(file, "utf8"));
if (problems.length) {
  process.stdout.write(problems.join("\n") + "\n");
  process.exit(1);
}
`;

const FAKE_TURBO = String.raw`
if (fs.existsSync("turbo-fails")) {
  process.stdout.write("@fixture/app:typecheck: src/index.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n");
  process.exit(1);
}
process.stdout.write("Tasks: all successful\n");
`;

// Any call of the full typecheck or test suite from a hook fails loudly.
const FAKE_FORBIDDEN = String.raw`
process.stderr.write(TOOL + " must not run here\n");
process.exit(3);
`;

function writeTool(root, name, body) {
  const bin = path.join(root, "node_modules", ".bin");
  fs.mkdirSync(bin, { recursive: true });
  const file = path.join(bin, name);
  fs.writeFileSync(
    file,
    `#!/usr/bin/env node\nconst TOOL = ${JSON.stringify(name)};\n${COMMON}\n${body}`,
  );
  fs.chmodSync(file, 0o755);
}

// Installs the fake tools into `<root>/node_modules/.bin`.
export function installFakeTools(root, { turbo = false } = {}) {
  writeTool(root, "prettier", FAKE_PRETTIER);
  writeTool(root, "eslint", FAKE_ESLINT);
  writeTool(root, "tsc", FAKE_FORBIDDEN);
  writeTool(root, "turbo", turbo ? FAKE_TURBO : FAKE_FORBIDDEN);
}

export function toolCalls(root) {
  try {
    return fs
      .readFileSync(path.join(root, "tool-calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export function git(cwd, ...args) {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// A repository on `master` with one commit. Tool logs and node_modules are ignored.
export function createRepo(prefix = "sebela-hooks-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-b", "master");
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\ntool-calls.jsonl\n");
  git(repo, "add", ".gitignore");
  git(repo, "commit", "-m", "chore: start the fixture");
  return { dir, repo, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
