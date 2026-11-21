// Release decisions around a deployment (docs/release-workflow.md, "Deployment", "Versions" and
// "Changelog"): the input of the server's forced command, built from the verified tag set of the
// `images` job, the version and notes of the GitHub release made after a healthy deployment, and
// CHANGELOG.md, whose sections are those notes. Plain Node without dependencies; tested in
// deployment.test.mjs. The release workflow runs it as
//
//   SHA=<commit> TAGS='{"api":"<commit>",...}' node scripts/release/deployment.mjs input
//   SHA=<commit> TAGS='{...}' BUILT='["api"]' NOTES_FILE=<path> node scripts/release/deployment.mjs notes
//   VERSION=<tag> NOTES_FILE=<path> node scripts/release/deployment.mjs changelog-entry
//
// and the owner rebuilds the whole changelog from the version tags with
//
//   [RELEASES_FILE=<json>] node scripts/release/deployment.mjs changelog
//
// Every command reads GITHUB_REPOSITORY (owner/name, set by GitHub Actions) for its links.
//
// `input` prints the forced-command input, which names SHA as the release commit the server's
// checkout is brought to. `notes` writes the release notes of the commits since the last version
// tag merged into SHA to NOTES_FILE and prints `release=true` and `version=<tag>` for
// $GITHUB_OUTPUT; the summary of a phase pull request among them is read with `gh` and left out
// when GitHub cannot give it. BUILT, the services whose images the run built, makes the notes name
// the release files attached for them and say that the reused images have none. When SHA already carries a version tag (a rerun of a released
// commit), it writes no notes, prints `release=false` and `version=<that tag>` and says so in the
// log and, when GITHUB_STEP_SUMMARY is set, in the step summary. `changelog-entry` adds the notes
// in NOTES_FILE as the section of VERSION, dated today in UTC (or DATE), to CHANGELOG_FILE
// (CHANGELOG.md by default). `changelog` writes CHANGELOG_FILE again from every version tag and
// its commits; RELEASES_FILE may give, per version, what git does not know: `date`, the deployed
// `tags`, the `built` services and a `note`.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { SERVICES, imageName } from "./images.mjs";
import { releaseFileNames } from "./release-files.mjs";

const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^v(\d+)\.(\d+)\.(\d+)$/;
const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?: (?<description>.+)$/;

/**
 * The forced-command input that deploys `tags`, a map of every service to the commit SHA of its
 * image, from `release`, the release commit whose repository files the server's checkout is brought
 * to. Throws on a release or a tag that is not a commit SHA and on a missing or unknown service;
 * the server's script checks the same again.
 */
export function deployInput(tags, release) {
  if (typeof release !== "string" || !COMMIT.test(release)) {
    throw new Error(`The release commit is not a commit SHA: ${String(release)}`);
  }
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
  return ["deploy", `release=${release}`, ...words].join(" ");
}

/**
 * The version a commit was already released as, from `tags`, the tags that point at it: the
 * highest `vX.Y.Z` among them, or null when none is a version tag. A commit with a version is not
 * released again, so a rerun of the deployment of a released commit publishes nothing.
 */
export function releasedVersion(tags) {
  const versions = tags
    .map((tag) => ({ tag, match: VERSION.exec(tag) }))
    .filter(({ match }) => match)
    .map(({ tag, match }) => ({ tag, parts: match.slice(1).map(Number) }));
  versions.sort((a, b) => {
    for (let index = 0; index < 3; index += 1) {
      const difference = b.parts[index] - a.parts[index];
      if (difference !== 0) return difference;
    }
    return 0;
  });
  return versions[0]?.tag ?? null;
}

const isMerge = ({ subject }) => subject.startsWith("Merge ");

/** The commit of a changelog pull request, which only repeats an earlier release's notes. */
const isChangelog = ({ subject }) =>
  /^chore\(release\): changelog for v\d+\.\d+\.\d+\b/.test(subject);

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

/** Groups whose entries are listed by scope; the others list their entries in history order. */
const BY_SCOPE = new Set(["feature", "fix"]);

/** A phase pull request's merge header in Conventional form: `Phase 09: RAG knowledge base (#280)`. */
const PHASE = /^Phase \d.*\(#(?<number>\d+)\)\s*$/;

/** GitHub's default merge header of a phase pull request, whose head is a `phase/` branch. */
const PHASE_MERGE = /^Merge pull request #(?<number>\d+) from [^/\s]+\/(?<branch>phase\/\S+)/;

/**
 * The phase pull request a commit merges, { number, title }, or null: a `Phase NN: Title (#N)`
 * header, or GitHub's default merge header from a `phase/` branch, titled by the first line of its
 * message body (the pull request's title) or else by its branch.
 */
function phaseMerge({ subject, body }) {
  const named = PHASE.exec(subject);
  if (named?.groups) {
    return {
      number: Number(named.groups.number),
      title: subject.replace(/\s*\(#\d+\)\s*$/, ""),
    };
  }
  const merged = PHASE_MERGE.exec(subject);
  if (merged?.groups) {
    const title = (body ?? "").split("\n")[0]?.trim();
    return { number: Number(merged.groups.number), title: title || merged.groups.branch };
  }
  return null;
}

/** The numbers of the phase pull requests among `commits`, in history order. */
export function phasePullRequests(commits) {
  return commits
    .map(phaseMerge)
    .filter(Boolean)
    .map(({ number }) => number);
}

const GENERATED = /Generated with \[Claude Code\]|claude\.ai\/code\/session_/;

/**
 * `text` without HTML comments, as GitHub hides them: each `<!--` up to its `-->`, and everything
 * after an opener that is never closed. Repeated until nothing changes, so removing one comment
 * cannot form another (`<!<!-- x -->--`).
 */
function withoutComments(text) {
  let current = text;
  for (;;) {
    let result = "";
    let index = 0;
    for (;;) {
      const start = current.indexOf("<!--", index);
      if (start === -1) {
        result += current.slice(index);
        break;
      }
      result += current.slice(index, start);
      const end = current.indexOf("-->", start + 4);
      if (end === -1) break;
      index = end + 3;
    }
    if (result === current) return result;
    current = result;
  }
}

/**
 * The summary of a phase pull request from its `body`: the first paragraph of prose in its
 * `## Summary` (or `## Highlights`) section, which ends at the next heading of any level, on one
 * line, skipping lists, tables, quotes, raw HTML and the generated-by line. HTML comments are
 * removed first and any `<` left is escaped, so a summary can never open a comment or a tag that
 * would hide the rest of the notes. Null without such a section or paragraph: the rest of a phase
 * pull request's description (its issues, what remains for the owner) is no summary.
 */
export function phaseSummary(body) {
  if (typeof body !== "string") return null;
  const text = withoutComments(body.replace(/\r\n/g, "\n"));
  const section = /^##\s+(?:summary|highlights)\s*$/im.exec(text);
  if (!section) return null;
  const rest = text.slice(section.index + section[0].length);
  const end = rest.search(/^#{1,6}\s/m);
  const found = (end === -1 ? rest : rest.slice(0, end))
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .find(
      (paragraph) =>
        paragraph !== "" &&
        !/^(#|[-*+] |\d+\. |\||>|```|<)/.test(paragraph) &&
        !GENERATED.test(paragraph),
    );
  return found ? found.replace(/\s+/g, " ").replaceAll("<", "&lt;") : null;
}

/**
 * The Markdown notes of release `version` (its GitHub release body and its CHANGELOG.md section):
 * a `note` when one is given; Highlights naming each phase pull request among `commits` ({ sha,
 * subject, body }) with the summary of its body in `phases` (pull request number to body; the
 * phase alone when it has none); the commits as breaking changes, features and fixes (both by
 * scope) and other changes, empty groups left out and merge commits skipped; pull request numbers
 * and commits without one linked in `repository` (`owner/name`); the comparison with `previous`
 * (or the history of a first release); then the deployed image of every service from `tags`, left
 * out when `tags` is null. When `built` lists the services whose images the release's run built,
 * each image also says whether its release files are attached (built) or not (reused), and a link
 * says how to verify them. A release without new commits says so in one line instead.
 */
export function releaseNotes({
  commits,
  tags,
  version,
  previous,
  repository,
  phases = {},
  note,
  built = null,
}) {
  if (built !== null) {
    if (!Array.isArray(built)) throw new Error("The built images are not a list of services.");
    const unknown = built.filter((service) => !SERVICES.includes(service));
    if (unknown.length > 0) throw new Error(`An unknown service: ${unknown.join(", ")}`);
  }
  const github = `https://github.com/${repository}`;
  const pull = (text) =>
    text.replace(/\(#(\d+)\)/g, (_, number) => `([#${number}](${github}/pull/${number}))`);
  const entry = ({ sha, description }) =>
    /\(#\d+\)/.test(description)
      ? pull(description)
      : `${description} ([${sha.slice(0, 7)}](${github}/commit/${sha}))`;
  const changes = commits
    .filter((commit) => !isMerge(commit) && !isChangelog(commit))
    .filter((commit) => !phaseMerge(commit))
    .map((c) => ({ ...c, ...classify(c) }));
  const sections = [];
  if (note) sections.push(note.trim());
  const highlights = commits
    .map(phaseMerge)
    .filter(Boolean)
    .map(({ number, title }) => {
      const summary = phaseSummary(phases[number]);
      const name = `**${title}** ([#${number}](${github}/pull/${number}))`;
      return summary ? `${name}: ${summary}` : `${name}.`;
    });
  if (highlights.length > 0) sections.push(`### Highlights\n\n${highlights.join("\n\n")}`);
  if (changes.length === 0 && highlights.length === 0) {
    sections.push(
      previous
        ? `No changes since ${previous}; re-release of the same commit.`
        : "No changes in this release.",
    );
  } else {
    for (const [kind, heading] of GROUPS) {
      const group = changes.filter((change) => change.kind === kind);
      if (group.length === 0) continue;
      const lines = [];
      if (BY_SCOPE.has(kind)) {
        const scopes = [...new Set(group.map(({ scope }) => scope).filter(Boolean))].sort();
        for (const scope of scopes) {
          lines.push(`- **${scope}**`);
          for (const change of group.filter((c) => c.scope === scope)) {
            lines.push(`  - ${entry(change)}`);
          }
        }
        for (const change of group.filter((c) => !c.scope)) lines.push(`- ${entry(change)}`);
      } else {
        for (const change of group) {
          const prefix = change.scope ? `**${change.scope}:** ` : "";
          lines.push(`- ${prefix}${entry(change)}`);
        }
      }
      sections.push(`### ${heading}\n\n${lines.join("\n")}`);
    }
    sections.push(
      previous
        ? `**Full Changelog**: [${previous}...${version}](${github}/compare/${previous}...${version})`
        : `**Full Changelog**: [${version}](${github}/commits/${version})`,
    );
  }
  if (tags) {
    const images = SERVICES.map((service) => {
      const image = `- \`${imageName(service)}:${tags[service]}\``;
      if (!built) return image;
      if (!built.includes(service)) {
        return `${image}, reused unchanged: no files are attached for it; its SBOM and provenance attestations were made by the release run that built it and are stored beside it in GHCR.`;
      }
      const files = releaseFileNames(service, version);
      return `${image}, built for this release: \`${files.sbom}\` and \`${files.attestations}\` are attached.`;
    });
    const verify = built
      ? `\n\nHow to verify the files and the images: [docs/release-workflow.md](${github}/blob/master/docs/release-workflow.md#release-files).`
      : "";
    sections.push(`### Images\n\n${images.join("\n")}${verify}`);
  }
  return `${sections.join("\n\n")}\n`;
}

const CHANGELOG_HEADER = `# Changelog

All notable changes to sebela.dev, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are counted from the Conventional Commits since the previous version (docs/release-workflow.md, Versions). From v0.3.0 on, each section is byte for byte the notes of its GitHub release, added by the release workflow after a healthy deployment; the sections of v0.1.0 to v0.2.1 were rendered again in this format from the same commits, so they differ from the older notes of their releases. There is no Unreleased section, because every merge into master is deployed.
`;

const releaseLink = (version, repository) =>
  `[${version}]: https://github.com/${repository}/releases/tag/${version}`;

/**
 * `changelog` (the text of CHANGELOG.md, or "" for a new one) with the section of release
 * `version` from `date` (YYYY-MM-DD) added as the newest: the heading `## [version] - date`
 * followed by exactly its release `notes`, and the heading's link to the GitHub release added as
 * the first of the links at the end. Throws when the changelog already has the version.
 */
export function addToChangelog(changelog, { version, date, notes, repository }) {
  if (!VERSION.test(version ?? "")) throw new Error(`Not a vX.Y.Z version: ${String(version)}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error(`Not a date: ${String(date)}`);
  const text = changelog.trim() === "" ? CHANGELOG_HEADER : changelog;
  if (text.includes(`\n## [${version}] `)) {
    throw new Error(`The changelog already has ${version}.`);
  }
  const section = `## [${version}] - ${date}\n\n${notes.endsWith("\n") ? notes : `${notes}\n`}`;
  const link = releaseLink(version, repository);
  const lines = text.split("\n");
  const firstSection = lines.findIndex((line) => line.startsWith("## ["));
  const firstLink = lines.findIndex((line) => /^\[v\d+\.\d+\.\d+\]: /.test(line));
  if (firstSection === -1) {
    return `${text.trimEnd()}\n\n${section}\n${link}\n`;
  }
  const head = lines.slice(0, firstSection).join("\n").trimEnd();
  const body = lines.slice(firstSection, firstLink === -1 ? undefined : firstLink).join("\n");
  const links = firstLink === -1 ? [] : lines.slice(firstLink).filter(Boolean);
  return `${head}\n\n${section}\n${body.trimEnd()}\n\n${[link, ...links].join("\n")}\n`;
}

/** CHANGELOG.md for `releases` ({ version, date, notes }, oldest first): each added in turn. */
export function changelogDocument({ releases, repository }) {
  return releases.reduce(
    (changelog, release) => addToChangelog(changelog, { ...release, repository }),
    "",
  );
}

// --- Command line ------------------------------------------------------------------------------

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function tagsFromEnvironment() {
  return JSON.parse(process.env.TAGS ?? "null");
}

function inputCommand() {
  process.stdout.write(`${deployInput(tagsFromEnvironment(), process.env.SHA)}\n`);
}

/** The commits of `range` (`<from>..<to>` or one commit and its history), newest first. */
function commitsOf(range) {
  return git(["log", "--format=%H%x1f%s%x1f%b%x1e", range])
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body] = record.split("\x1f");
      return { sha: hash ?? "", subject: subject ?? "", body: body ?? "" };
    });
}

/** The repository the links point to: GITHUB_REPOSITORY, which GitHub Actions sets. */
function repositoryFromEnvironment() {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error("Set GITHUB_REPOSITORY to the repository (owner/name).");
  }
  return repository;
}

/**
 * The bodies of the phase pull requests among `commits`, read with `gh`. A body GitHub cannot
 * give (no `gh`, no token, no network) is left out, so its phase is named without a summary.
 */
function phaseBodies(commits, repository) {
  const bodies = {};
  for (const number of phasePullRequests(commits)) {
    try {
      bodies[number] = execFileSync(
        "gh",
        ["pr", "view", String(number), "--repo", repository, "--json", "body", "--jq", ".body"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      process.stderr.write(
        `The body of pull request #${number} is unavailable; its phase is named without a summary.\n`,
      );
    }
  }
  return bodies;
}

function notesCommand() {
  const sha = process.env.SHA ?? "";
  const notesFile = process.env.NOTES_FILE ?? "";
  if (!COMMIT.test(sha)) throw new Error("Set SHA to the release commit.");
  if (!notesFile) throw new Error("Set NOTES_FILE to where the notes go.");
  const repository = repositoryFromEnvironment();
  const tags = tagsFromEnvironment();
  deployInput(tags, sha);
  const built = process.env.BUILT ? JSON.parse(process.env.BUILT) : null;
  const released = releasedVersion(git(["tag", "--list", "v*", "--points-at", sha]).split("\n"));
  if (released) {
    const message = `The commit ${sha} is already released as ${released}; no new version is published.`;
    process.stderr.write(`${message}\n`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) fs.appendFileSync(summary, `${message}\n`);
    process.stdout.write(`release=false\nversion=${released}\n`);
    return;
  }
  const previous =
    git(["tag", "--list", "v*", "--merged", sha, "--sort=-v:refname"])
      .split("\n")
      .find((tag) => VERSION.test(tag)) ?? null;
  const commits = commitsOf(previous ? `${previous}..${sha}` : sha);
  const version = nextVersion(previous, commits);
  const phases = phaseBodies(commits, repository);
  fs.writeFileSync(
    notesFile,
    releaseNotes({ commits, tags, version, previous, repository, phases, built }),
  );
  process.stdout.write(`release=true\nversion=${version}\n`);
}

const today = () => process.env.DATE || new Date().toISOString().slice(0, 10);

function changelogEntryCommand() {
  const version = process.env.VERSION ?? "";
  const notesFile = process.env.NOTES_FILE ?? "";
  const changelogFile = process.env.CHANGELOG_FILE || "CHANGELOG.md";
  if (!notesFile) throw new Error("Set NOTES_FILE to the release notes.");
  const repository = repositoryFromEnvironment();
  const changelog = fs.existsSync(changelogFile) ? fs.readFileSync(changelogFile, "utf8") : "";
  const notes = fs.readFileSync(notesFile, "utf8");
  fs.writeFileSync(
    changelogFile,
    addToChangelog(changelog, { version, date: today(), notes, repository }),
  );
}

/** The version tags of the repository, oldest first. */
function versionTags() {
  return git(["tag", "--list", "v*", "--sort=v:refname"])
    .split("\n")
    .filter((tag) => VERSION.test(tag));
}

function changelogCommand() {
  const repository = repositoryFromEnvironment();
  const changelogFile = process.env.CHANGELOG_FILE || "CHANGELOG.md";
  const releasesFile = process.env.RELEASES_FILE ?? "";
  const known = releasesFile ? JSON.parse(fs.readFileSync(releasesFile, "utf8")) : {};
  const releases = [];
  let previous = null;
  for (const version of versionTags()) {
    const { date, tags = null, note, built = null } = known[version] ?? {};
    const commits = commitsOf(previous ? `${previous}..${version}` : version);
    releases.push({
      version,
      date:
        date ??
        new Date(git(["log", "-1", "--format=%cI", version]).trim()).toISOString().slice(0, 10),
      notes: releaseNotes({
        commits,
        tags,
        version,
        previous,
        repository,
        phases: phaseBodies(commits, repository),
        note,
        built,
      }),
    });
    previous = version;
  }
  fs.writeFileSync(changelogFile, changelogDocument({ releases, repository }));
}

const COMMANDS = {
  input: inputCommand,
  notes: notesCommand,
  "changelog-entry": changelogEntryCommand,
  changelog: changelogCommand,
};

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const command = COMMANDS[process.argv[2] ?? ""];
  if (!command) {
    process.stderr.write(
      `usage: node scripts/release/deployment.mjs ${Object.keys(COMMANDS).join("|")}\n`,
    );
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
