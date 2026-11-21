#!/usr/bin/env node
// Refuses tracked files that name private details of the owner's infrastructure: the hosting
// provider, its control panel, the server's name, address or paths (docs/permissions.md, Private
// infrastructure details). The terms are not in the repository — listing them here would publish
// them. They come from the environment variable PRIVATE_TERMS, set as a repository secret in CI:
// one term per line or comma-separated, matched case-insensitively as whole words. A finding names
// the file and line only, never the term. Without PRIVATE_TERMS the check reports that it was
// skipped and passes, so contributors without the secret are not blocked; CI always has it.
// Plain Node, no dependencies.

import { execFileSync } from "node:child_process";
import fs from "node:fs";

const SKIPPED_FILES = [
  /^pnpm-lock\.yaml$/,
  /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|gz)$/i,
];

export function parseTerms(value) {
  return String(value ?? "")
    .split(/[\n,]/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);
}

function escape(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word, case-insensitive matcher; a term may contain dots, slashes or dashes (an address or
// a path), so "word" means not preceded or followed by a letter or digit.
export function termMatcher(terms) {
  if (terms.length === 0) return null;
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${terms.map(escape).join("|")})(?![\\p{L}\\p{N}])`,
    "iu",
  );
}

// The findings in one file's text: [{ line }] for every line that contains a term.
export function findInText(text, matcher) {
  const findings = [];
  text.split("\n").forEach((line, index) => {
    if (matcher.test(line)) findings.push({ line: index + 1 });
  });
  return findings;
}

function trackedFiles(cwd) {
  return execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
    .split("\0")
    .filter((file) => file && !SKIPPED_FILES.some((pattern) => pattern.test(file)));
}

function main() {
  const terms = parseTerms(process.env["PRIVATE_TERMS"]);
  if (terms.length === 0) {
    console.log(
      "private-terms: PRIVATE_TERMS is not set; skipped (CI runs it with the repository secret).",
    );
    return 0;
  }
  const matcher = termMatcher(terms);
  const cwd = process.cwd();
  let count = 0;
  for (const file of trackedFiles(cwd)) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const { line } of findInText(text, matcher)) {
      console.error(`${file}:${line}: names a private infrastructure detail`);
      count += 1;
    }
  }
  if (count > 0) {
    console.error(
      `private-terms: ${count} line(s) name the hosting provider, panel, server name, address or paths; describe them generically (docs/permissions.md, Private infrastructure details).`,
    );
    return 1;
  }
  console.log(
    `private-terms: no private infrastructure details in tracked files (${terms.length} terms).`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
