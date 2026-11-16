// @ts-check

// Test support for the import-boundaries tests: lints files of a fictional fixture workspace with
// the shared configuration and checks what the rule reports. Not part of the package's exports.
//
// A committed fixture workspace holds no real packages: only the files the rule reads (the
// workspace marker, `package.json` files declaring exports and imports, a tsconfig with `paths`
// aliases) and sample source files. `useFixtureWorkspace` copies it to a disposable directory, so
// that a test can write each case there as a real file: the TypeScript project service lints only
// files that exist.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import { ESLint } from "eslint";

import { createConfig } from "./eslint.js";

export const RULE_ID = "sebela/import-boundaries";

/**
 * Copies the fixture workspace `fixtures/<name>/` to a disposable directory, removed after the
 * tests of the calling file, and returns helpers that lint files in it.
 *
 * @param {string} name
 */
export function useFixtureWorkspace(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sebela-${name}-`));
  fs.cpSync(path.join(import.meta.dirname, "fixtures", name), root, { recursive: true });
  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: createConfig({ tsconfigRootDir: root }),
  });

  /**
   * Writes `code` to `file` (relative to the workspace root) without linting it.
   *
   * @param {string} file
   * @param {string} code
   */
  function write(file, code) {
    const filePath = path.join(root, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, code);
  }

  /**
   * Lints the fixture file `file` (relative to the workspace root), first replacing its content
   * with `code` when given. Fails the test on a parsing or configuration error, so that a broken
   * fixture never counts as a rejected import.
   *
   * @param {string} file
   * @param {string} [code]
   */
  async function lint(file, code) {
    if (code !== undefined) write(file, code);
    const [result] = await eslint.lintFiles([path.join(root, file)]);
    assert.ok(result, `ESLint returned no result for ${file}`);
    const fatal = result.messages.filter((message) => message.fatal === true);
    assert.deepEqual(fatal, [], `${file} did not lint cleanly`);
    return result;
  }

  /**
   * The boundary violations reported for `code` linted as `file`.
   *
   * @param {string} file
   * @param {string} [code]
   */
  async function violations(file, code) {
    const result = await lint(file, code);
    return result.messages.filter((message) => message.ruleId === RULE_ID);
  }

  /**
   * Asserts that `file`, with `code` when given, is accepted by the rule.
   *
   * @param {string} file
   * @param {string} [code]
   */
  async function assertAllowed(file, code) {
    assert.deepEqual(
      (await violations(file, code)).map((message) => message.message),
      [],
      `expected ${file} to be allowed${code === undefined ? "" : `:\n${code}`}`,
    );
  }

  /**
   * Asserts that `code` in `file` produces exactly one violation, on `line`, whose message
   * contains every fragment in `mentions`.
   *
   * @param {string} file
   * @param {string} code
   * @param {{ line?: number, mentions: (string | RegExp)[] }} expected
   */
  async function assertRejected(file, code, { line = 1, mentions }) {
    const found = await violations(file, code);
    assert.equal(
      found.length,
      1,
      `expected one violation in ${file}:\n${code}\ngot ${found.map((message) => message.message).join("\n")}`,
    );
    const [violation] = found;
    assert.ok(violation);
    assert.equal(violation.line, line, `violation on the wrong line in ${file}`);
    assert.equal(violation.severity, 2, "a boundary violation is an error");
    for (const fragment of mentions) {
      if (typeof fragment === "string") {
        assert.ok(
          violation.message.includes(fragment),
          `message does not mention ${fragment}: ${violation.message}`,
        );
      } else {
        assert.match(violation.message, fragment);
      }
    }
  }

  return { root, write, lint, violations, assertAllowed, assertRejected };
}
