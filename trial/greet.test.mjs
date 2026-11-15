import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { greet } from "./greet.mjs";

const GREET_URL = pathToFileURL(join(import.meta.dirname, "greet.mjs")).href;

/**
 * Runs `greet("Petr")` in a fresh Node process whose working directory holds the given
 * fictional `.env.local`, loaded the way the README tells you to run it.
 */
function greetInDirectoryWith(envFileContent) {
  const directory = mkdtempSync(join(tmpdir(), "trial-greet-"));
  try {
    writeFileSync(join(directory, ".env.local"), envFileContent);
    const env = { ...process.env };
    delete env.TRIAL_GREETING;
    return execFileSync(
      process.execPath,
      [
        "--env-file-if-exists=.env.local",
        "--input-type=module",
        "--eval",
        `import { greet } from ${JSON.stringify(GREET_URL)}; process.stdout.write(greet("Petr"));`,
      ],
      { cwd: directory, env, encoding: "utf8" },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("uses TRIAL_GREETING when it is set", () => {
  assert.equal(greet("Petr", { TRIAL_GREETING: "Ahoj" }), "Ahoj, Petr!");
});

test("falls back to Hello without TRIAL_GREETING", () => {
  assert.equal(greet("Petr", {}), "Hello, Petr!");
});

test("treats an empty TRIAL_GREETING as not set", () => {
  assert.equal(greet("Petr", { TRIAL_GREETING: "" }), "Hello, Petr!");
});

test("reads TRIAL_GREETING from process.env by default", () => {
  const previous = process.env.TRIAL_GREETING;
  try {
    process.env.TRIAL_GREETING = "Ahoj";
    assert.equal(greet("Petr"), "Ahoj, Petr!");
    delete process.env.TRIAL_GREETING;
    assert.equal(greet("Petr"), "Hello, Petr!");
  } finally {
    if (previous === undefined) {
      delete process.env.TRIAL_GREETING;
    } else {
      process.env.TRIAL_GREETING = previous;
    }
  }
});

test("uses the greeting the worktree's .env.local sets", () => {
  assert.equal(greetInDirectoryWith("TRIAL_GREETING=Ahoj\n"), "Ahoj, Petr!");
  assert.equal(greetInDirectoryWith("TRIAL_GREETING=Servus\n"), "Servus, Petr!");
});

test("falls back to Hello when .env.local does not set TRIAL_GREETING", () => {
  assert.equal(greetInDirectoryWith("OTHER=value\n"), "Hello, Petr!");
});
