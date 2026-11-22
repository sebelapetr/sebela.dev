#!/usr/bin/env node
// Refuses a tracked `node_modules` entry: a file, a symbolic link or anything below a folder of
// that name. `.gitignore` ignores the folder and the link, but a link added by force or before
// the pattern existed would otherwise ship (docs/testing.md, CI). Plain Node, no dependencies.
//
//   node scripts/checks/tracked-node-modules.mjs   every path Git tracks

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * The paths that have a `node_modules` component, in the order given.
 *
 * @param {string[]} paths
 * @returns {string[]}
 */
export function trackedNodeModules(paths) {
  return paths.filter((entry) => entry.split("/").includes("node_modules"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const found = trackedNodeModules(tracked);
  for (const entry of found) console.error(`${entry}: a node_modules entry is tracked`);
  process.exit(found.length === 0 ? 0 : 1);
}
