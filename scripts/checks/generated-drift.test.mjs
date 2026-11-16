// Behaviour of the generated-code drift check, observed through its command line in a disposable
// Git repository: a fake generator rewrites the committed generated folder, and the check reports
// whatever the regeneration changed, added or removed there.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const CHECK = path.join(import.meta.dirname, "generated-drift.mjs");

/**
 * A fake generator: writes the files named in the `GENERATE` variable (JSON object of path to
 * content) into `generated/`, after emptying it, as a real generator with a clean output does.
 */
const GENERATOR = `
const fs = require("node:fs");
const files = JSON.parse(process.env.GENERATE);
fs.rmSync("generated", { recursive: true, force: true });
for (const [name, content] of Object.entries(files)) {
  fs.mkdirSync(require("node:path").dirname("generated/" + name), { recursive: true });
  fs.writeFileSync("generated/" + name, content);
}
process.exitCode = Number(process.env.GENERATE_EXIT ?? 0);
`;

function repository(t, committed) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-drift-check-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
      encoding: "utf8",
    });
  git("init", "-b", "master");
  for (const [name, content] of Object.entries(committed)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  git("add", "--all");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "x");
  fs.writeFileSync(path.join(root, "generator.cjs"), GENERATOR);
  return { root };
}

function check(root, generated, { args, exit } = {}) {
  const result = spawnSync(
    process.execPath,
    [CHECK, ...(args ?? ["generated", "--", process.execPath, "generator.cjs"])],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GENERATE: JSON.stringify(generated),
        ...(exit === undefined ? {} : { GENERATE_EXIT: String(exit) }),
      },
    },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const committed = {
  "generated/types.ts": "export type A = string;\n",
  "generated/nested/document.json": '{ "paths": {} }\n',
  "README.md": "Outside the checked folder.\n",
};

describe("generated-code drift check", () => {
  it("passes when regeneration reproduces the committed files exactly", (t) => {
    const { root } = repository(t, committed);
    const result = check(root, {
      "types.ts": committed["generated/types.ts"],
      "nested/document.json": committed["generated/nested/document.json"],
    });
    assert.equal(result.status, 0, result.output);
  });

  it("fails on a changed file and names it", (t) => {
    const { root } = repository(t, committed);
    const result = check(root, {
      "types.ts": "export type A = number;\n",
      "nested/document.json": '{ "paths": {} }\n',
    });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /generated\/types\.ts/);
    assert.doesNotMatch(result.output, /document\.json/);
  });

  it("fails on an added file", (t) => {
    const { root } = repository(t, committed);
    const result = check(root, {
      "types.ts": "export type A = string;\n",
      "nested/document.json": '{ "paths": {} }\n',
      "nested/extra.ts": "export {};\n",
    });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /generated\/nested\/extra\.ts/);
  });

  it("fails on a removed file", (t) => {
    const { root } = repository(t, committed);
    const result = check(root, { "types.ts": "export type A = string;\n" });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /generated\/nested\/document\.json/);
  });

  it("tells how to regenerate", (t) => {
    const { root } = repository(t, committed);
    const result = check(root, {});
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /regenerate/i);
    assert.match(result.output, /generator\.cjs/);
  });

  it("ignores changes outside the checked folders", (t) => {
    const { root } = repository(t, committed);
    fs.writeFileSync(path.join(root, "README.md"), "Changed outside.\n");
    const result = check(root, {
      "types.ts": "export type A = string;\n",
      "nested/document.json": '{ "paths": {} }\n',
    });
    assert.equal(result.status, 0, result.output);
  });

  it("fails when the generator fails", (t) => {
    const { root } = repository(t, committed);
    const result = check(
      root,
      { "types.ts": "export type A = string;\n", "nested/document.json": '{ "paths": {} }\n' },
      { exit: 3 },
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /generator\.cjs/);
  });

  it("refuses to run without folders or a command", (t) => {
    const { root } = repository(t, committed);
    for (const args of [[], ["generated"], ["--", "true"], ["generated", "--"]]) {
      const result = check(root, {}, { args });
      assert.equal(result.status, 2, `${args.join(" ")}: ${result.output}`);
      assert.match(result.output, /Usage/);
    }
  });
});
