#!/usr/bin/env node
// The images of a release (docs/release-workflow.md, "Images"): which services a push to master
// affects, which images it builds and which current images it reuses, and the commands of the
// release workflow (.github/workflows/release.yml) that act on those decisions.
//
//   BASE=<commit before the push> node scripts/release/images.mjs affected
//   SHA=<commit> AFFECTED='["web"]' node scripts/release/images.mjs plan
//   SHA=<commit> BUILD='["web"]' node scripts/release/images.mjs build
//   SHA=<commit> BUILD='["web"]' node scripts/release/images.mjs publish
//
// `affected` and `plan` print `key=value` lines for $GITHUB_OUTPUT on standard output and explain
// themselves on standard error. Plain Node with no dependencies; `affected` runs the checkout's
// installed Turborepo, the other commands the Docker CLI.
//
// - affected: the services whose image the push changes. Turborepo's affected packages between
//   BASE and HEAD (the selection the quality job of CI uses, with every dependent package) mapped
//   to the apps of the images, plus every service when a root file that enters every image build
//   changed. No comparison base selects every service.
// - plan: the affected services are built; an unchanged service reuses its current image (the
//   `current` tag, the last verified image published from master) by the commit SHA in its
//   revision label, and is built as well when it has none. Prints the services to build and
//   reuse and the complete tag set.
// - build: builds the images under their GHCR names, tagged with SHA and labelled with it.
// - publish: pushes the SHA tags of the built images, then moves their `current` tags.

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

export const SERVICES = ["api", "web", "mcp-admin"];

export const REGISTRY = "ghcr.io/sebelapetr";

/** The tag of the last verified image of each service published from master. */
export const CURRENT_TAG = "current";

const PACKAGES = { api: "@sebela/api", web: "@sebela/web", "mcp-admin": "@sebela/mcp-admin" };

/** Root files that belong to no package but enter every image build. */
const IMAGE_BUILD_INPUTS = new Set([".dockerignore"]);

const COMMIT = /^[0-9a-f]{40}$/;
const NO_COMMIT = /^0{40}$/;

const CHECKOUT_ROOT = path.join(import.meta.dirname, "..", "..");

export const imageName = (service) => `${REGISTRY}/sebela-${service}`;

/** The package names of `turbo query affected --packages` output. */
export function affectedPackages(output) {
  const items = output?.data?.affectedPackages?.items;
  if (!Array.isArray(items)) throw new Error("The output does not list affected packages.");
  return items.map((item) => {
    if (typeof item?.name !== "string") throw new Error("An affected package has no name.");
    return item.name;
  });
}

/**
 * The services, in the order of SERVICES, whose image the change affects. `packages` are
 * Turborepo's affected packages and `changedFiles` the changed paths; null for either means there
 * is no comparison base, which selects every service.
 */
export function affectedServices({ packages, changedFiles }) {
  if (packages === null || changedFiles === null) return [...SERVICES];
  if (changedFiles.some((file) => IMAGE_BUILD_INPUTS.has(file))) return [...SERVICES];
  const selected = new Set(packages);
  return SERVICES.filter((service) => selected.has(PACKAGES[service]));
}

/** The commit to compare with, or null when there is none (a new branch or no value). */
export function comparisonBase(before) {
  if (before === undefined || before === "" || NO_COMMIT.test(before)) return null;
  if (!COMMIT.test(before)) throw new Error(`The comparison base is not a commit SHA: ${before}`);
  return before;
}

function knownServices(services) {
  for (const service of services) {
    if (!SERVICES.includes(service)) throw new Error(`An unknown service: ${String(service)}`);
  }
  return services;
}

/**
 * What a release of commit `sha` builds and reuses. `current` maps an unchanged service to the
 * commit SHA of its current image, or null when it has none; one without a commit SHA is built.
 */
export function releasePlan({ sha, affected, current }) {
  if (!COMMIT.test(sha)) throw new Error(`The release commit is not a commit SHA: ${sha}`);
  knownServices(affected);
  const build = [];
  const reuse = [];
  const tags = {};
  for (const service of SERVICES) {
    const revision = current[service];
    if (affected.includes(service) || typeof revision !== "string" || !COMMIT.test(revision)) {
      build.push(service);
      tags[service] = sha;
    } else {
      reuse.push(service);
      tags[service] = revision;
    }
  }
  return { build, reuse, tags };
}

export function staleServices() {
  throw new Error("not implemented");
}

export function revisionLabel() {
  throw new Error("not implemented");
}

/** `key=value` lines for $GITHUB_OUTPUT, every value as JSON. */
export function formatOutputs(outputs) {
  return Object.entries(outputs)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}\n`)
    .join("");
}

// The command line.

const log = (text) => process.stderr.write(`${text}\n`);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: CHECKOUT_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  }).trim();
}

function servicesFrom(name) {
  const value = JSON.parse(process.env[name] ?? "null");
  if (!Array.isArray(value)) throw new Error(`${name} is not a JSON list of services.`);
  return knownServices(value);
}

function releaseCommit() {
  const sha = process.env.SHA ?? "";
  if (!COMMIT.test(sha)) throw new Error("SHA is not a commit SHA.");
  return sha;
}

function affectedCommand() {
  const base = comparisonBase(process.env.BASE);
  let packages = null;
  let changedFiles = null;
  if (base === null) {
    log("No comparison base: every service is affected.");
  } else {
    const diff = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], {
      cwd: CHECKOUT_ROOT,
      encoding: "utf8",
    });
    if (diff.status === 0) {
      changedFiles = diff.stdout.split("\n").filter((line) => line !== "");
      const output = run(
        path.join(CHECKOUT_ROOT, "node_modules", ".bin", "turbo"),
        ["query", "affected", "--packages"],
        {
          env: {
            ...process.env,
            TURBO_TELEMETRY_DISABLED: "1",
            TURBO_SCM_BASE: base,
            TURBO_SCM_HEAD: "HEAD",
          },
        },
      );
      packages = affectedPackages(JSON.parse(output));
      log(`Changed files:\n${changedFiles.map((file) => `  ${file}`).join("\n")}`);
      log(`Affected packages: ${packages.join(", ") || "none"}`);
    } else {
      log(`The comparison base ${base} is not in the history: every service is affected.`);
    }
  }
  const services = affectedServices({ packages, changedFiles });
  log(`Affected services: ${services.join(", ") || "none, nothing is built"}`);
  process.stdout.write(formatOutputs({ services, build: services.length > 0 }));
}

/** The commit SHA of the service's current image, pulled by that SHA; null when there is none. */
function currentRevision(service) {
  const current = `${imageName(service)}:${CURRENT_TAG}`;
  if (spawnSync("docker", ["pull", "--quiet", current], { stdio: "ignore" }).status !== 0) {
    log(`${service}: no current image.`);
    return null;
  }
  const revision = run("docker", [
    "image",
    "inspect",
    "--format",
    '{{index .Config.Labels "org.opencontainers.image.revision"}}',
    current,
  ]);
  if (!COMMIT.test(revision)) {
    log(`${service}: the current image names no commit.`);
    return null;
  }
  const pinned = `${imageName(service)}:${revision}`;
  if (spawnSync("docker", ["pull", "--quiet", pinned], { stdio: "ignore" }).status !== 0) {
    log(`${service}: the current image's commit tag ${revision} is not published.`);
    return null;
  }
  return revision;
}

function planCommand() {
  const sha = releaseCommit();
  const affected = servicesFrom("AFFECTED");
  const current = Object.fromEntries(
    SERVICES.filter((service) => !affected.includes(service)).map((service) => [
      service,
      currentRevision(service),
    ]),
  );
  const plan = releasePlan({ sha, affected, current });
  log(`Build: ${plan.build.join(", ") || "none"}; reuse: ${plan.reuse.join(", ") || "none"}`);
  process.stdout.write(formatOutputs(plan));
}

function buildCommand() {
  const sha = releaseCommit();
  // The repository the image is built from (GitHub Actions sets both), which also links the GHCR
  // package to it.
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository } = process.env;
  if (!server || !repository)
    throw new Error("GITHUB_SERVER_URL and GITHUB_REPOSITORY are not set.");
  const source = `${server}/${repository}`;
  for (const service of servicesFrom("BUILD")) {
    log(`Building ${imageName(service)}:${sha}`);
    run(
      "docker",
      [
        "build",
        "--file",
        path.join("apps", service, "Dockerfile"),
        "--label",
        `org.opencontainers.image.revision=${sha}`,
        "--label",
        `org.opencontainers.image.source=${source}`,
        "--tag",
        `${imageName(service)}:${sha}`,
        ".",
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
  }
}

function publishCommand() {
  const sha = releaseCommit();
  const built = servicesFrom("BUILD");
  // Every commit tag first, so a `current` tag never names a commit tag that is not published.
  for (const service of built) {
    run("docker", ["push", "--quiet", `${imageName(service)}:${sha}`]);
    log(`Pushed ${imageName(service)}:${sha}`);
  }
  for (const service of built) {
    run("docker", ["tag", `${imageName(service)}:${sha}`, `${imageName(service)}:${CURRENT_TAG}`]);
    run("docker", ["push", "--quiet", `${imageName(service)}:${CURRENT_TAG}`]);
    log(`Moved ${imageName(service)}:${CURRENT_TAG} to ${sha}`);
  }
}

const COMMANDS = {
  affected: affectedCommand,
  plan: planCommand,
  build: buildCommand,
  publish: publishCommand,
};

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const command = COMMANDS[process.argv[2] ?? ""];
  if (!command) {
    log(`Usage: node scripts/release/images.mjs ${Object.keys(COMMANDS).join("|")}`);
    process.exitCode = 2;
  } else {
    try {
      command();
    } catch (error) {
      log(`images ${process.argv[2]}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
