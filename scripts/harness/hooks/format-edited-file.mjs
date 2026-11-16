#!/usr/bin/env node
// PostToolUse hook on Edit, Write and MultiEdit: formats the file an agent just changed with the
// shared Prettier configuration (docs/permissions.md, "Hooks").
//
// The file is formatted by the Prettier of the checkout it belongs to, started in that checkout,
// so its configuration and ignore files apply. Files outside this repository, environment files,
// files inside .git and links leading out of their checkout are left alone; types Prettier does
// not support are skipped by Prettier. Formatting writes the file directly, which triggers no
// further tool call, so the hook cannot trigger itself. A failure goes back to the agent.

import fs from "node:fs";
import path from "node:path";
import { checkoutOf, missingTools, runTool } from "../lib/workspace-tools.mjs";
import { mainRootFrom } from "../worktree.mjs";
import { readHookInput } from "./read-input.mjs";

const ENV_FILE = /^\.env(\..+)?$/;

const isInside = (child, parent) => {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

// The checkout root and the file's path inside it, or null when the hook leaves the file alone.
function target(input) {
  const raw = input.tool_input?.file_path;
  if (!raw) return null;
  const file = path.resolve(input.cwd ?? process.cwd(), raw);
  if (ENV_FILE.test(path.basename(file))) return null;
  let real;
  try {
    real = fs.realpathSync(file);
  } catch {
    return null;
  }
  if (ENV_FILE.test(path.basename(real)) || !fs.statSync(real).isFile()) return null;
  const mainRoot = mainRootFrom(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd());
  const root = checkoutOf(path.dirname(file), mainRoot);
  if (!root) return null;
  const realRoot = fs.realpathSync(root);
  if (!isInside(real, realRoot)) return null;
  const relative = path.relative(realRoot, real);
  if (relative.split(path.sep).includes(".git")) return null;
  return { root: realRoot, relative };
}

function feedback(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

try {
  const found = target(await readHookInput());
  if (found) {
    const missing = missingTools(found.root, ["prettier"]);
    if (missing) {
      feedback(`${found.relative} was not formatted. ${missing}`);
    } else {
      const run = runTool(found.root, "prettier", [
        "--write",
        "--ignore-unknown",
        "--log-level=warn",
        "--",
        found.relative,
      ]);
      if (run.status !== 0) {
        feedback(
          `Prettier could not format ${found.relative} in ${found.root}; fix the file:\n\n${run.output}`,
        );
      }
    }
  }
} catch (error) {
  process.stderr.write(`format-edited-file hook failed: ${error.message}\n`);
  process.exit(1);
}
