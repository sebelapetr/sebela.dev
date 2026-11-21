// The test coverage summary (docs/testing.md, Coverage): line coverage of each workspace member,
// per language and overall, from the `coverage/lcov.info` its test run wrote. Vitest writes it in
// the TypeScript members (`@sebela/config/vitest`); coverage.py writes the same format for a Python
// member. Plain Node, no dependencies.
//
// Usage, from the repository root:
//   node scripts/checks/coverage-summary.mjs [--root <dir>] [--json <file>]
//     Prints the summary as Markdown and appends it to the file GITHUB_STEP_SUMMARY names, the
//     GitHub Actions job summary. With --json, also writes the figures to <file>.
//
// A member is measured when it declares a coverage provider: `@vitest/coverage-v8` in its
// package.json, or `pytest-cov` in the pyproject.toml of a Python member. A measured member without
// a report did not run its tests in this job (CI runs only what a change affects). There is no
// threshold: the summary exits 0 whatever the figures, and also for a report it cannot read. It
// exits 2 only on wrong usage.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = "Usage: coverage-summary [--root <dir>] [--json <file>]\n";

// The member folders of pnpm-workspace.yaml (`apps/*`, `packages/*`).
const MEMBER_FOLDERS = ["apps", "packages"];
const LANGUAGES = ["TypeScript", "Python"];
const REPORT = path.join("coverage", "lcov.info");

/**
 * Lines found and hit in an lcov report, from its `DA:<line>,<hits>` entries. Anything else in the
 * report, and a file that is not lcov at all, counts nothing.
 */
export function parseLcov(text) {
  let found = 0;
  let hit = 0;
  for (const line of text.split(/\r?\n/)) {
    const match = /^DA:\d+,(\d+)/.exec(line);
    if (!match) continue;
    found += 1;
    if (Number(match[1]) > 0) hit += 1;
  }
  return { found, hit };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function describeMember(root, folder) {
  const manifest = readJson(path.join(root, folder, "package.json"));
  if (!manifest) return undefined;
  const pyproject = readText(path.join(root, folder, "pyproject.toml"));
  const language = pyproject === undefined ? "TypeScript" : "Python";
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const provider =
    language === "Python"
      ? /\bpytest-cov\b/.test(pyproject)
      : "@vitest/coverage-v8" in dependencies;
  const report = readText(path.join(root, folder, REPORT));
  let status = "measured";
  if (!manifest.scripts?.test) status = "no tests";
  else if (!provider) status = "not measured";
  else if (report === undefined) status = "not run";
  const lines = status === "measured" ? parseLcov(report) : { found: 0, hit: 0 };
  return { name: manifest.name ?? folder, folder, language, status, lines };
}

/** Every workspace member below `root` with its language, status and lines found and hit. */
export function summarize(root) {
  const members = [];
  for (const parent of MEMBER_FOLDERS) {
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, parent), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.filter((item) => item.isDirectory()).sort(byName)) {
      const member = describeMember(root, path.posix.join(parent, entry.name));
      if (member) members.push(member);
    }
  }
  members.sort((a, b) => LANGUAGES.indexOf(a.language) - LANGUAGES.indexOf(b.language));
  return members;
}

function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function total(members) {
  const found = members.reduce((sum, member) => sum + member.lines.found, 0);
  const hit = members.reduce((sum, member) => sum + member.lines.hit, 0);
  return { covered: hit, total: found, percent: percent(hit, found) };
}

function percent(hit, found) {
  return found === 0 ? null : Math.round((hit / found) * 1000) / 10;
}

/** The figures: per language, overall and per member. */
export function figures(members) {
  const measured = members.filter((member) => member.status === "measured");
  return {
    lines: {
      typescript: total(measured.filter((member) => member.language === "TypeScript")),
      python: total(measured.filter((member) => member.language === "Python")),
      overall: total(measured),
    },
    packages: members.map(({ name, folder, language, status, lines }) => ({
      name,
      folder,
      language,
      status,
      ...(status === "measured" ? total([{ lines }]) : {}),
    })),
  };
}

function cell(value, bold = false) {
  if (value === null) return "—";
  const text = `${value.toFixed(1)}%`;
  return bold ? `**${text}**` : text;
}

function names(members, status) {
  return members
    .filter((member) => member.status === status)
    .map((member) => `\`${member.name}\``)
    .join(", ");
}

/** The summary as Markdown for the job summary and the log. */
export function toMarkdown(members) {
  const { lines } = figures(members);
  const rows = members
    .filter((member) => member.status === "measured")
    .map(({ name, language, lines: { found, hit } }) => {
      const value = percent(hit, found);
      return `| \`${name}\` | ${language} | ${hit} | ${found} | ${cell(value)} |`;
    });
  const totals = [
    ["TypeScript", lines.typescript],
    ["Python", lines.python],
    ["Overall", lines.overall],
  ].map(
    ([label, figure]) =>
      `| **${label}** | | ${figure.covered} | ${figure.total} | ${cell(figure.percent, true)} |`,
  );
  const notes = [
    ["Not run in this job", names(members, "not run"), " (not affected by the change)"],
    ["Tests without coverage measurement", names(members, "not measured"), ""],
    ["No tests", names(members, "no tests"), ""],
  ]
    .filter(([, list]) => list)
    .map(([label, list, reason]) => `${label}: ${list}${reason}.`);
  return [
    "## Test coverage",
    "",
    "Lines of handwritten source that the unit and integration tests run, per app and package. " +
      "Generated code is excluded. There is no threshold (docs/testing.md, Coverage).",
    "",
    "| Package | Language | Covered | Lines | Coverage |",
    "| --- | --- | ---: | ---: | ---: |",
    ...rows,
    ...totals,
    "",
    ...notes.flatMap((note) => [note, ""]),
  ].join("\n");
}

function parseArguments(args) {
  const options = { root: process.cwd(), json: undefined };
  for (let index = 0; index < args.length; index += 2) {
    const [name, value] = [args[index], args[index + 1]];
    if (value === undefined || !["--root", "--json"].includes(name)) return undefined;
    options[name.slice(2)] = value;
  }
  return options;
}

function main(args) {
  const options = parseArguments(args);
  if (!options) {
    process.stderr.write(USAGE);
    return 2;
  }
  const members = summarize(options.root);
  const markdown = toMarkdown(members);
  process.stdout.write(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  if (options.json) {
    fs.mkdirSync(path.dirname(path.resolve(options.json)), { recursive: true });
    fs.writeFileSync(options.json, `${JSON.stringify(figures(members), null, 2)}\n`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
