#!/usr/bin/env node
// The images of a release (docs/release-workflow.md, "Images"): which images a push to master
// builds and which current images it reuses, and the commands of the release workflow
// (.github/workflows/release.yml) that act on those decisions.
//
//   SHA=<commit> node scripts/release/images.mjs plan
//   SHA=<commit> BUILD='["web"]' TAGS='{"api":"<commit>",...}' node scripts/release/images.mjs pull
//   SHA=<commit> BUILD='["web"]' node scripts/release/images.mjs build
//   SHA=<commit> BUILD='["web"]' node scripts/release/images.mjs publish
//
// `plan` prints `key=value` lines for $GITHUB_OUTPUT on standard output; every command explains
// itself on standard error. Plain Node with no dependencies; the commands run git, the checkout's
// installed Turborepo and the Docker CLI, signed in to GHCR where they read or write it.
//
// - plan: each service is judged against the commit of its current image (the `current` tag, the
//   last verified image published from master, by the commit SHA in its revision label). It is
//   built when it has no current image, or when Turborepo's affected packages between that commit
//   and SHA (the selection the quality job of CI uses, with every dependent package) include its
//   app or a root file that enters every image build changed. Otherwise its current image is
//   reused. So a change whose own release failed or was cancelled is built by the next release.
//   A current image whose commit is not an ancestor of SHA refuses the release: a rerun of an
//   older release must not move it backwards. Prints the services to build and reuse, the
//   complete tag set and whether there is anything to release.
// - pull: pulls the reused images by their commit tags.
// - build: builds the images under their GHCR names, tagged with SHA and labelled with it.
// - publish: checks again that no current image is newer than SHA, pushes the SHA tags of the
//   built images, then moves their `current` tags.

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

export const SERVICES = ["api", "web", "mcp-admin"];

export const REGISTRY = "ghcr.io/sebelapetr";

/** The tag of the last verified image of each service published from master. */
export const CURRENT_TAG = "current";

const PACKAGES = { api: "@sebela/api", web: "@sebela/web", "mcp-admin": "@sebela/mcp-admin" };

/**
 * Root files that enter every image build (the build context's allowlist in .dockerignore) and
 * that Turborepo does not count against the apps: the allowlist itself and the root manifest, whose
 * change selects only the root package. The other root files of the context need nothing here:
 * pnpm-workspace.yaml is a global dependency of turbo.json, which selects every package, and the
 * images install with `--filter <app>...`, so of a lockfile change only the dependencies of the
 * packages Turborepo selects for it enter an image.
 */
const IMAGE_BUILD_INPUTS = new Set([".dockerignore", "package.json"]);

const REVISION_LABEL = "org.opencontainers.image.revision";

/** The platform the images are built for and the server runs. */
const PLATFORM = "linux/arm64";

const COMMIT = /^[0-9a-f]{40}$/;

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
 * The services, in the order of SERVICES, whose image a change affects: `packages` are
 * Turborepo's affected packages of the change and `changedFiles` its changed paths.
 */
export function affectedServices({ packages, changedFiles }) {
  if (changedFiles.some((file) => IMAGE_BUILD_INPUTS.has(file))) return [...SERVICES];
  const selected = new Set(packages);
  return SERVICES.filter((service) => selected.has(PACKAGES[service]));
}

const isCommit = (revision) => typeof revision === "string" && COMMIT.test(revision);

/**
 * The services whose current image is newer than the release commit: its commit is not an
 * ancestor of the release commit (`isAncestor`). A service with no current image is never stale.
 */
export function staleServices({ current, isAncestor }) {
  return SERVICES.filter((service) => isCommit(current[service]) && !isAncestor(current[service]));
}

/**
 * What a release of commit `sha` builds and reuses. `current` maps a service to the commit of its
 * current image, or null when it has none; one without a commit SHA is built. `isAncestor(commit)`
 * tells whether a commit is an ancestor of `sha` (or `sha` itself), and `affectedSince(commit)`
 * the services a change from that commit to `sha` affects. Throws when a current image is newer
 * than `sha`.
 */
export function releasePlan({ sha, current, isAncestor, affectedSince }) {
  if (!COMMIT.test(sha)) throw new Error(`The release commit is not a commit SHA: ${sha}`);
  const stale = staleServices({ current, isAncestor });
  if (stale.length > 0) {
    const names = stale.map((service) => `${service} (${current[service]})`).join(", ");
    throw new Error(
      `The current image of ${names} is not an ancestor of ${sha}: a newer release was published, and this one would go backwards.`,
    );
  }
  const since = new Map();
  const changedSince = (revision) => {
    if (!since.has(revision)) since.set(revision, affectedSince(revision));
    return since.get(revision);
  };
  const build = [];
  const reuse = [];
  const tags = {};
  for (const service of SERVICES) {
    const revision = current[service];
    if (!isCommit(revision) || changedSince(revision).includes(service)) {
      build.push(service);
      tags[service] = sha;
    } else {
      reuse.push(service);
      tags[service] = revision;
    }
  }
  return { build, reuse, tags };
}

/**
 * The commit in the revision label of an image, from `docker buildx imagetools inspect --format
 * '{{json .Image}}'`: the configuration of a single-platform image, or of the arm64 image of an
 * index. Null when there is none.
 */
export function revisionLabel(image) {
  const config = image?.config ? image : image?.[PLATFORM];
  const revision = config?.config?.Labels?.[REVISION_LABEL];
  return typeof revision === "string" ? revision : null;
}

/** `key=value` lines for $GITHUB_OUTPUT, every value as JSON. */
export function formatOutputs(outputs) {
  return Object.entries(outputs)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}\n`)
    .join("");
}

// The command line.

const log = (text) => process.stderr.write(`${text}\n`);

/** Runs a command; its trimmed output, or "" when the output goes straight to the job log. */
function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    cwd: CHECKOUT_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  return (output ?? "").trim();
}

function knownServices(services) {
  for (const service of services) {
    if (!SERVICES.includes(service)) throw new Error(`An unknown service: ${String(service)}`);
  }
  return services;
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

/** Whether the registry has the image, without pulling it. */
function published(reference) {
  return (
    spawnSync("docker", ["buildx", "imagetools", "inspect", reference], { stdio: "ignore" })
      .status === 0
  );
}

/** The commit of the service's current image when its commit tag is published; null otherwise. */
function currentRevision(service) {
  const current = `${imageName(service)}:${CURRENT_TAG}`;
  const inspected = spawnSync(
    "docker",
    ["buildx", "imagetools", "inspect", "--format", "{{json .Image}}", current],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (inspected.status !== 0) {
    log(`${service}: no current image.`);
    return null;
  }
  const revision = revisionLabel(JSON.parse(inspected.stdout));
  if (!isCommit(revision)) {
    log(`${service}: the current image names no commit.`);
    return null;
  }
  if (!published(`${imageName(service)}:${revision}`)) {
    log(`${service}: the current image's commit tag ${revision} is not published.`);
    return null;
  }
  log(`${service}: current image of ${revision}.`);
  return revision;
}

function currentRevisions(services) {
  return Object.fromEntries(services.map((service) => [service, currentRevision(service)]));
}

/** Whether `revision` is an ancestor of `sha` or `sha` itself; false when it is not in history. */
function ancestorOf(sha) {
  return (revision) =>
    spawnSync("git", ["merge-base", "--is-ancestor", revision, sha], {
      cwd: CHECKOUT_ROOT,
      stdio: "ignore",
    }).status === 0;
}

function affectedSinceFor(sha) {
  return (revision) => {
    const changedFiles = run("git", ["diff", "--name-only", revision, sha])
      .split("\n")
      .filter((line) => line !== "");
    const output = run(
      path.join(CHECKOUT_ROOT, "node_modules", ".bin", "turbo"),
      ["query", "affected", "--packages"],
      {
        env: {
          ...process.env,
          TURBO_TELEMETRY_DISABLED: "1",
          TURBO_SCM_BASE: revision,
          TURBO_SCM_HEAD: sha,
        },
      },
    );
    const packages = affectedPackages(JSON.parse(output));
    const services = affectedServices({ packages, changedFiles });
    log(`Since ${revision}:`);
    log(`  changed files: ${changedFiles.join(", ") || "none"}`);
    log(`  affected packages: ${packages.join(", ") || "none"}`);
    log(`  affected services: ${services.join(", ") || "none"}`);
    return services;
  };
}

function planCommand() {
  const sha = releaseCommit();
  const plan = releasePlan({
    sha,
    current: currentRevisions(SERVICES),
    isAncestor: ancestorOf(sha),
    affectedSince: affectedSinceFor(sha),
  });
  log(`Build: ${plan.build.join(", ") || "none"}; reuse: ${plan.reuse.join(", ") || "none"}`);
  if (plan.build.length === 0) log("Nothing to release.");
  process.stdout.write(formatOutputs({ ...plan, release: plan.build.length > 0 }));
}

function pullCommand() {
  const built = servicesFrom("BUILD");
  const tags = JSON.parse(process.env.TAGS ?? "null");
  for (const service of SERVICES.filter((name) => !built.includes(name))) {
    const tag = tags?.[service];
    if (!isCommit(tag)) throw new Error(`TAGS names no commit for ${service}.`);
    run("docker", ["pull", "--quiet", `${imageName(service)}:${tag}`]);
    log(`Pulled ${imageName(service)}:${tag}`);
  }
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
        `${REVISION_LABEL}=${sha}`,
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
  const stale = staleServices({ current: currentRevisions(built), isAncestor: ancestorOf(sha) });
  if (stale.length > 0) {
    throw new Error(
      `A newer image of ${stale.join(", ")} was published since the plan; nothing is pushed.`,
    );
  }
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
  plan: planCommand,
  pull: pullCommand,
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
