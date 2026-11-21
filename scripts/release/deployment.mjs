// Release decisions around a deployment (docs/release-workflow.md, "Deployment" and "Versions"):
// the input of the server's forced command, built from the verified tag set of the `images` job,
// and the version and changelog of the GitHub release made after a healthy deployment. Plain Node
// without dependencies; tested in deployment.test.mjs. The release workflow runs it as
//
//   TAGS='{"api":"<commit>",...}' node scripts/release/deployment.mjs input
//   SHA=<commit> TAGS='{...}' NOTES_FILE=<path> node scripts/release/deployment.mjs notes
//
// `input` prints the forced-command input. `notes` writes the release notes of the commits since
// the last version tag merged into SHA to NOTES_FILE and prints `version=<tag>` for $GITHUB_OUTPUT.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { SERVICES, imageName } from "./images.mjs";

const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^v(\d+)\.(\d+)\.(\d+)$/;
const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?: (?<description>.+)$/;

/**
 * The forced-command input that deploys `tags`, a map of every service to the commit SHA of its
 * image. Throws on a missing or unknown service or a tag that is not a commit SHA; the server's
 * script checks the same again.
 */
export function deployInput(tags) {
  if (tags === null || typeof tags !== "object" || Array.isArray(tags)) {
    throw new Error("The tag set is not an object of services and tags.");
  }
  const unknown = Object.keys(tags).filter((service) => !SERVICES.includes(service));
  if (unknown.length > 0) throw new Error(`Unknown services in the tag set: ${unknown.join(", ")}`);
  const words = SERVICES.map((service) => {
    const tag = tags[service];
    if (typeof tag !== "string" || !COMMIT.test(tag)) {
      throw new Error(`The tag of ${service} is not a commit SHA: ${String(tag)}`);
    }
    return `${service}=${tag}`;
  });
  return ["deploy", ...words].join(" ");
}

const isMerge = ({ subject }) => subject.startsWith("Merge ");

/** The kind of a commit for the version and the changelog. */
function classify({ subject, body }) {
  const match = CONVENTIONAL.exec(subject);
  if (!match?.groups) return { kind: "other", scope: null, description: subject };
  const { type, scope, bang, description } = match.groups;
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE: /m.test(body ?? "");
  const kind = breaking
    ? "breaking"
    : type === "feat"
      ? "feature"
      : type === "fix"
        ? "fix"
        : "other";
  return { kind, scope: scope ?? null, description };
}

/**
 * The version after `previous` (a `vX.Y.Z` tag, or null before the first release, counted from
 * v0.0.0) for `commits` ({ sha, subject, body }): a breaking change raises the major version, a
 * feature the minor version and anything else the patch version. Merge commits do not count.
 */
export function nextVersion(previous, commits) {
  const match = VERSION.exec(previous ?? "v0.0.0");
  if (!match) throw new Error(`The previous version is not a vX.Y.Z tag: ${previous}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  const kinds = new Set(commits.filter((commit) => !isMerge(commit)).map((c) => classify(c).kind));
  if (kinds.has("breaking")) return `v${major + 1}.0.0`;
  if (kinds.has("feature")) return `v${major}.${minor + 1}.0`;
  return `v${major}.${minor}.${patch + 1}`;
}

const GROUPS = [
  ["breaking", "Breaking changes"],
  ["feature", "Features"],
  ["fix", "Fixes"],
  ["other", "Other changes"],
];

/**
 * The Markdown notes of a GitHub release: `commits` ({ sha, subject, body }) grouped into breaking
 * changes, features, fixes and other changes (empty groups left out, merge commits skipped), then
 * the deployed image of every service from `tags`.
 */
export function releaseNotes({ commits, tags }) {
  const entries = commits
    .filter((commit) => !isMerge(commit))
    .map((c) => ({ ...c, ...classify(c) }));
  const sections = [];
  for (const [kind, heading] of GROUPS) {
    const lines = entries
      .filter((entry) => entry.kind === kind)
      .map(({ sha, scope, description }) => {
        const prefix = scope ? `**${scope}:** ` : "";
        return `- ${prefix}${description} (${sha.slice(0, 7)})`;
      });
    if (lines.length > 0) sections.push(`## ${heading}\n\n${lines.join("\n")}`);
  }
  const images = SERVICES.map((service) => `- \`${imageName(service)}:${tags[service]}\``);
  sections.push(`## Images\n\n${images.join("\n")}`);
  return `${sections.join("\n\n")}\n`;
}

// --- Command line ------------------------------------------------------------------------------

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function tagsFromEnvironment() {
  return JSON.parse(process.env.TAGS ?? "null");
}

function inputCommand() {
  process.stdout.write(`${deployInput(tagsFromEnvironment())}\n`);
}

function notesCommand() {
  const sha = process.env.SHA ?? "";
  const notesFile = process.env.NOTES_FILE ?? "";
  if (!COMMIT.test(sha)) throw new Error("Set SHA to the release commit.");
  if (!notesFile) throw new Error("Set NOTES_FILE to where the notes go.");
  const tags = tagsFromEnvironment();
  deployInput(tags);
  const previous =
    git(["tag", "--list", "v*", "--merged", sha, "--sort=-v:refname"])
      .split("\n")
      .find((tag) => VERSION.test(tag)) ?? null;
  const range = previous ? `${previous}..${sha}` : sha;
  const commits = git(["log", "--format=%H%x1f%s%x1f%b%x1e", range])
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body] = record.split("\x1f");
      return { sha: hash ?? "", subject: subject ?? "", body: body ?? "" };
    });
  fs.writeFileSync(notesFile, releaseNotes({ commits, tags }));
  process.stdout.write(`version=${nextVersion(previous, commits)}\n`);
}

const COMMANDS = { input: inputCommand, notes: notesCommand };

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const command = COMMANDS[process.argv[2] ?? ""];
  if (!command) {
    process.stderr.write("usage: node scripts/release/deployment.mjs input|notes\n");
    process.exitCode = 2;
  } else {
    try {
      command();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`deployment ${process.argv[2]}: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
