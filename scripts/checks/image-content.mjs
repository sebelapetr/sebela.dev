#!/usr/bin/env node
// The image-content check: fails when a built image contains an environment file other than the
// example, anything from the private notes folder, the secrets file or a seed other than the
// fictional demo. Plain Node, no dependencies; the command line needs Docker and `tar`.
//
// Usage: node scripts/checks/image-content.mjs <image>...
// Each image's file system is listed from a container that is created but never started
// (`docker create`, `docker export` read by `tar -t`), then removed. Only paths and reasons are
// printed, never a file's content.

import { spawn, spawnSync } from "node:child_process";

const USAGE =
  "Usage: image-content <image>...\n" +
  "  Fails if an image contains an environment file other than the example, private notes,\n" +
  "  the secrets file or a seed other than the fictional demo.\n";

const EXAMPLE_ENVIRONMENT = ".env.example";
const SECRETS = ".env.secrets";
const PRIVATE_NOTES = ".context";
const SEED_FOLDER = ["packages", "db", "seed"];
const DEMO_SEED = "demo";

function isEnvironmentFile(name) {
  return name === ".env" || name.startsWith(".env.");
}

/** Whether the path lies in a seed folder (`packages/db/seed/<name>/...`) other than the demo. */
function inOtherSeed(segments, isFolder) {
  for (let index = 0; index + SEED_FOLDER.length < segments.length; index += 1) {
    if (!SEED_FOLDER.every((segment, offset) => segments[index + offset] === segment)) continue;
    const seed = index + SEED_FOLDER.length;
    // A plain file directly in the seed folder (its README) is not a seed.
    const isSeedEntry = seed < segments.length - 1 || isFolder;
    return isSeedEntry && segments[seed] !== DEMO_SEED;
  }
  return false;
}

function reasonFor(path) {
  const isFolder = path.endsWith("/");
  const segments = path.split("/").filter((segment) => segment !== "");
  if (segments.includes(PRIVATE_NOTES)) return "private notes";
  const name = segments.at(-1) ?? "";
  if (name === SECRETS) return "secrets file";
  if (isEnvironmentFile(name) && name !== EXAMPLE_ENVIRONMENT) return "environment file";
  if (inOtherSeed(segments, isFolder)) return "seed other than the demo";
  return undefined;
}

/**
 * The entries of an image's file system listing (`tar -t` paths) the check refuses, each with its
 * reason, in the listing's order.
 *
 * @param {readonly string[]} paths
 * @returns {{ path: string, reason: string }[]}
 */
export function forbiddenEntries(paths) {
  const found = [];
  for (const listed of paths) {
    const path = listed.trim().replace(/^\.\//, "");
    if (path === "") continue;
    const reason = reasonFor(path);
    if (reason !== undefined) found.push({ path, reason });
  }
  return found;
}

function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const reason = result.error ? result.error.message : result.stderr.trim();
    throw new Error(`docker ${args[0]} failed: ${reason}`);
  }
  return result.stdout.trim();
}

/** The paths of a container's file system, streamed from `docker export` through `tar -t`. */
function listContainer(container) {
  return new Promise((resolve, reject) => {
    const exported = spawn("docker", ["export", container], { stdio: ["ignore", "pipe", "pipe"] });
    const listing = spawn("tar", ["-t"], { stdio: ["pipe", "pipe", "pipe"] });
    exported.stdout.pipe(listing.stdin);
    let paths = "";
    let errors = "";
    listing.stdout.setEncoding("utf8").on("data", (chunk) => (paths += chunk));
    for (const stream of [exported.stderr, listing.stderr]) {
      stream.setEncoding("utf8").on("data", (chunk) => (errors += chunk));
    }
    let pending = 2;
    let failed = false;
    const done = (name) => (code) => {
      if (code !== 0) failed = true;
      if (code !== 0 && errors === "") errors = `${name} exited with ${String(code)}`;
      pending -= 1;
      if (pending > 0) return;
      if (failed) reject(new Error(`Listing the image failed: ${errors.trim()}`));
      else resolve(paths.split("\n"));
    };
    exported.on("error", reject).on("close", done("docker export"));
    listing.on("error", reject).on("close", done("tar"));
  });
}

async function imageEntries(image) {
  const container = docker(["create", image]);
  try {
    return await listContainer(container);
  } finally {
    docker(["rm", container]);
  }
}

async function main(images) {
  if (images.length === 0) {
    process.stderr.write(USAGE);
    return 2;
  }
  let findings = 0;
  for (const image of images) {
    const found = forbiddenEntries(await imageEntries(image));
    findings += found.length;
    if (found.length === 0) {
      process.stdout.write(`${image}: no forbidden files\n`);
      continue;
    }
    process.stderr.write(`${image}: ${String(found.length)} forbidden file(s)\n`);
    for (const { path, reason } of found) process.stderr.write(`  ${path}: ${reason}\n`);
  }
  return findings === 0 ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
