#!/usr/bin/env node
// Rejects ports, local host addresses and database names hard-coded in executable files. They are
// configuration and come from the environment (docs/repository-structure.md, "The hard-coded
// configuration check", which also states the scope and the exceptions).
//
//   node scripts/checks/hardcoded-config.mjs             every file of the repository Git lists
//   node scripts/checks/hardcoded-config.mjs <path>...   only the given files and directories
//
// Reports each finding as `file:line:column rule: message` and exits with 1 when there is one,
// 2 when the check cannot run. Plain Node without dependencies, like the harness.
//
// The patterns are written so that this file passes its own check.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The deliberate negative fixtures of this check. The repository scan leaves out this one folder
// and nothing else; the tests check it by passing its files explicitly.
const NEGATIVE_FIXTURES = "scripts/checks/fixtures/hardcoded-config/";

const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"]);
const SHELL_EXTENSIONS = new Set([".sh", ".bash"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

const MESSAGES = {
  port: "hard-coded port; read it from the environment",
  "local-host": "hard-coded local host address; read the host from the environment",
  "database-name": "hard-coded database name; read it from the environment",
  "environment-default":
    "configuration from the environment falls back to a hard-coded value; document the value in .env.example and fail when it is not set",
};

// Identifiers and keys naming a port or a database, in the spellings of JavaScript, Python and
// the shell: API_PORT, PGPORT, port, api_port, apiPort; DATABASE_NAME, POSTGRES_DB, dbName.
const PORT_NAME = String.raw`(?:\b(?:[A-Z0-9_]*_|PG)?PORT|\b(?:[a-z0-9_]*_)?port|\b[A-Za-z][A-Za-z0-9]*Port|\bPort)\b`;
const DATABASE_NAME = String.raw`(?:\b(?:[A-Z0-9_]*_|PG)?(?:DATABASE|DB)(?:_NAME)?|\b(?:[a-z0-9_]*_)?(?:database|db)(?:_name)?|\b[A-Za-z][A-Za-z0-9]*(?:Database|Db)(?:Name)?|\b(?:database|db)Name)\b`;
// In code: `=` after an optional type annotation (`port: number =`, `adminPort?: number | undefined
// =`), `:`, `??=` and `||=`, but not a comparison or an arrow. In the shell: only `=`.
const TYPE_ANNOTATION = String.raw`\??\s*:\s*[\w.<>[\]|&\s]+?\s*`;
const ASSIGNED = String.raw`["'\x60]?\s*(?:(?:${TYPE_ANNOTATION})?=|:|\?\?=|\|\|=)(?![=>])\s*`;
const QUOTE = String.raw`["'\x60]`;
const NAME_LITERAL = String.raw`[A-Za-z_][\w.-]*`;
// Settings whose fallback would be a hidden endpoint or database.
const CONFIGURATION_VARIABLE = /PORT|HOST|DATABASE|(?:^|_)DB(?:_|$)|URL|URI|DSN/i;

const rule = (id, source, options = {}) => ({
  id,
  pattern: new RegExp(source, `gd${options.flags ?? ""}`),
  ...options,
});

const CODE_RULES = [
  rule("port", String.raw`${PORT_NAME}${ASSIGNED}${QUOTE}?(?<value>\d{2,5})\b`),
  rule(
    "database-name",
    String.raw`${DATABASE_NAME}${ASSIGNED}${QUOTE}(?<value>${NAME_LITERAL})${QUOTE}`,
  ),
];

const COMMON_RULES = [
  rule("port", String.raw`\b[A-Za-z][\w+.-]*:\/\/[^\s/"'\x60?#]*:(?<value>\d{1,5})\b`),
  rule("port", String.raw`(?:^|[\s"'\x60])(?:--port(?:=|\s+)|-p\s+)["']?(?<value>\d{2,5})\b`),
  rule("local-host", String.raw`\blocalhost\b`, { flags: "i" }),
  rule("local-host", String.raw`\b(?<value>127(?:\.\d{1,3}){3}|0(?:\.0){3})\b`),
  rule("local-host", String.raw`(?<=["'\x60[])(?<value>:{2}1)(?=["'\x60\]])`),
  rule(
    "database-name",
    String.raw`\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?)(?:\+\w+)?:\/\/[^\s/"'\x60]*\/(?<value>${NAME_LITERAL})`,
  ),
  rule(
    "database-name",
    String.raw`\b(?:CREATE|DROP|ALTER)\s+DATABASE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?(?<value>[A-Za-z_][\w$]*)`,
    { flags: "i" },
  ),
];

const RULES = {
  js: [
    ...CODE_RULES,
    ...COMMON_RULES,
    rule("port", String.raw`\.listen\(\s*["'\x60]?(?<value>\d{2,5})\b`),
    rule(
      "environment-default",
      String.raw`\benv(?:\.(?<name>\w+)|\[\s*["'\x60](?<quoted>\w+)["'\x60]\s*\])\s*(?:\?\?|\|\|)\s*(?<value>${QUOTE}[^"'\x60]+${QUOTE}|\d+)`,
      { variable: true },
    ),
  ],
  python: [
    ...CODE_RULES,
    ...COMMON_RULES,
    rule(
      "environment-default",
      String.raw`\bos\.(?:environ\.(?:get|setdefault)|getenv)\(\s*["'](?<name>\w+)["']\s*,\s*(?:default\s*=\s*)?(?<value>["'][^"']+["']|\d+)`,
      { variable: true },
    ),
  ],
  shell: [
    ...COMMON_RULES,
    rule("port", String.raw`${PORT_NAME}=["']?(?<value>\d{2,5})\b`),
    rule("database-name", String.raw`${DATABASE_NAME}=["']?(?<value>${NAME_LITERAL})(?=["'\s;]|$)`),
    rule(
      "database-name",
      String.raw`\b(?:createdb|dropdb)\s+(?:-\S+\s+)*["']?(?<value>${NAME_LITERAL})`,
    ),
    rule(
      "database-name",
      String.raw`\b(?:psql|pg_dump|pg_restore)\b[^\n;|&]*?(?:\s-d\s*|\s--dbname(?:=|\s+))["']?(?<value>${NAME_LITERAL})`,
    ),
    rule("environment-default", String.raw`\$\{(?<name>\w+):?[-=](?<value>[^}$][^}]*)\}`, {
      variable: true,
    }),
  ],
};

function languageOf(file) {
  const name = path.basename(file);
  if (name === "package.json") return "package";
  const extension = path.extname(name);
  if (JS_EXTENSIONS.has(extension)) return "js";
  if (extension === ".py") return "python";
  if (SHELL_EXTENSIONS.has(extension)) return "shell";
  if (extension !== "") return null;
  // Executable scripts without an extension are recognised by their interpreter line.
  const firstLine = fs.readFileSync(file, "utf8").split("\n", 1)[0];
  if (!firstLine.startsWith("#!")) return null;
  if (/\b(?:node|deno|bun|tsx)\b/.test(firstLine)) return "js";
  if (/\bpython[\d.]*\b/.test(firstLine)) return "python";
  if (/\b(?:ba|da|z)?sh\b/.test(firstLine)) return "shell";
  return null;
}

// A comment that starts a line is documentation and is blanked out, keeping every column in place.
// Code after a block comment that closes on the line is checked, and so is a comment after code.
function withoutDocumentation(lines, language) {
  const blank = (text) => text.replace(/[^\s]/g, " ");
  let inBlock = false;
  return lines.map((line) => {
    if (language !== "js") return line.trim().startsWith("#") ? blank(line) : line;
    let code = line;
    let from = 0;
    for (;;) {
      if (!inBlock) {
        const start = code.slice(from).search(/\S/);
        if (start === -1) return code;
        const at = from + start;
        if (code.startsWith("//", at)) return code.slice(0, at) + blank(code.slice(at));
        if (!code.startsWith("/*", at)) return code;
        inBlock = true;
        from = at + 2;
        code = code.slice(0, at) + "  " + code.slice(from);
      }
      const end = code.indexOf("*/", from);
      if (end === -1) return code.slice(0, from) + blank(code.slice(from));
      inBlock = false;
      code = code.slice(0, from) + blank(code.slice(from, end + 2)) + code.slice(end + 2);
      from = end + 2;
    }
  });
}

function findingsIn(text, language) {
  const findings = [];
  const seen = new Set();
  for (const { id, pattern, variable } of RULES[language]) {
    for (const match of text.matchAll(pattern)) {
      if (variable) {
        const name = match.groups.name ?? match.groups.quoted;
        if (!CONFIGURATION_VARIABLE.test(name)) continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      // A finding points at the rule's `value` group, or at the whole match when it has none.
      findings.push({ rule: id, offset: (match.indices.groups?.value ?? match.indices[0])[0] });
    }
  }
  return findings.sort((a, b) => a.offset - b.offset);
}

function checkSource(content, language) {
  const lines = withoutDocumentation(content.split("\n"), language);
  return lines.flatMap((line, index) =>
    findingsIn(line, language).map(({ rule, offset }) => ({
      rule,
      line: index + 1,
      column: offset + 1,
    })),
  );
}

// Only the `scripts` of a package manifest are executable; they are checked as shell commands.
function checkManifest(content) {
  let scripts;
  try {
    scripts = JSON.parse(content).scripts;
  } catch {
    return [];
  }
  if (!scripts || typeof scripts !== "object") return [];
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.includes('"scripts"'));
  return Object.entries(scripts).flatMap(([name, command]) => {
    if (typeof command !== "string") return [];
    const key = `${JSON.stringify(name)}:`;
    const index = lines.findIndex((line, i) => i >= start && line.includes(key));
    if (index === -1) return [];
    const valueStart = lines[index].indexOf('"', lines[index].indexOf(key) + key.length) + 1;
    return findingsIn(command, "shell").map(({ rule, offset }) => ({
      rule,
      line: index + 1,
      column: valueStart + offset + 1,
    }));
  });
}

// Returns null for a file that is not executable and therefore not read.
function checkFile(file) {
  const language = languageOf(file);
  if (!language) return null;
  const content = fs.readFileSync(file, "utf8");
  return language === "package" ? checkManifest(content) : checkSource(content, language);
}

function isRegularFile(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

function repositoryFiles(cwd) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const files = listed
    .split("\0")
    .filter((file) => file && !file.startsWith(NEGATIVE_FIXTURES))
    .map((file) => path.join(root, file))
    .filter(isRegularFile);
  return { base: root, files };
}

function walk(target) {
  const stat = fs.lstatSync(target);
  if (stat.isFile()) return [target];
  if (!stat.isDirectory()) return [];
  return fs
    .readdirSync(target)
    .filter((entry) => !SKIPPED_DIRECTORIES.has(entry))
    .sort()
    .flatMap((entry) => walk(path.join(target, entry)));
}

function main(args, cwd) {
  const { base, files } = args.length
    ? { base: cwd, files: args.flatMap((arg) => walk(path.resolve(cwd, arg))) }
    : repositoryFiles(cwd);
  let count = 0;
  let checked = 0;
  for (const file of files) {
    const findings = checkFile(file);
    if (!findings) continue;
    checked += 1;
    const shown = path.relative(base, file).split(path.sep).join("/");
    for (const { rule: id, line, column } of findings) {
      console.error(`${shown}:${line}:${column} ${id}: ${MESSAGES[id]}`);
      count += 1;
    }
  }
  if (count) {
    console.error(
      `\n${count} hard-coded configuration value(s) found. Read them from the environment instead.`,
    );
    return 1;
  }
  console.log(`No hard-coded ports, local hosts or database names in ${checked} file(s).`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2), process.cwd());
  } catch (error) {
    console.error(`hardcoded-config: ${error.stderr?.toString().trim() || error.message}`);
    process.exitCode = 2;
  }
}
