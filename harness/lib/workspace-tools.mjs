// The workspace's own tools (Prettier, ESLint, Turborepo) as the hooks run them: the executables
// that `pnpm install` put into `<checkout>/node_modules/.bin`, started in that checkout. The
// harness does not import them, so it stays plain Node without dependencies, and each worktree
// uses the tool versions and configuration it checked out.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX_OUTPUT = 256 * 1024 * 1024;

export function installCommand(root) {
  return `run \`pnpm install --frozen-lockfile\` in ${root}`;
}

// Null when every tool is installed, otherwise a message naming what is missing and how to fix it.
export function missingTools(root, names) {
  const missing = names.filter(
    (name) => !fs.existsSync(path.join(root, "node_modules", ".bin", name)),
  );
  if (!missing.length) return null;
  return `The workspace tools (${missing.join(", ")}) are not installed in ${root}; ${installCommand(root)}.`;
}

// Runs a tool in `root`. Returns { status, stdout, stderr, output } with stdout as a Buffer, so
// file contents pass through unchanged, and `output` as the combined text for reports. A tool
// that cannot be started at all is an error, not a result.
export function runTool(root, name, args, { input, env = process.env, timeout } = {}) {
  const run = spawnSync(path.join(root, "node_modules", ".bin", name), args, {
    cwd: root,
    env,
    input,
    timeout,
    maxBuffer: MAX_OUTPUT,
  });
  if (run.error) throw new Error(`${name} could not run in ${root}: ${run.error.message}`);
  const stdout = run.stdout ?? Buffer.alloc(0);
  const stderr = run.stderr?.toString("utf8") ?? "";
  const output = [stdout.toString("utf8"), stderr]
    .filter((text) => text.trim())
    .join("\n")
    .trim();
  const status = run.status ?? 1;
  return {
    status,
    stdout,
    stderr,
    output: run.signal ? `${output}\n(${name} ended by ${run.signal})`.trim() : output,
  };
}

// The top level of the checkout containing `dir`, when it is a checkout (the main checkout or a
// worktree) of the repository whose main checkout is `mainRoot`; otherwise null.
export function checkoutOf(dir, mainRoot) {
  try {
    const [top, common] = execFileSync(
      "git",
      ["rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir"],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
      .trim()
      .split("\n");
    return fs.realpathSync(path.dirname(common)) === fs.realpathSync(mainRoot) ? top : null;
  } catch {
    return null;
  }
}
