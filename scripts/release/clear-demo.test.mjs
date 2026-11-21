// Behaviour of infra/scripts/clear-demo.sh (docs/release-workflow.md, "Clearing the demo
// content"): it clears the profile and the roadmap of the production database only after the
// database's name is confirmed and a backup has succeeded, through the API image's clear-content
// command. The real script runs with the fake docker first on PATH (fixtures/backup-sandbox.mjs)
// and a stand-in backup script that records its run in the same log.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createSandbox, script } from "./fixtures/backup-sandbox.mjs";

const SCRIPT = script("clear-demo.sh");

let sandbox;
let backupScript;

beforeEach(async () => {
  sandbox = await createSandbox();
  backupScript = path.join(sandbox.dir, "backup.sh");
  fs.writeFileSync(
    backupScript,
    [
      "#!/usr/bin/env bash",
      `printf '{"tool":"backup","args":[]}\\n' >>"$FAKE_TOOLS_LOG"`,
      'exit "${FICTIONAL_BACKUP_STATUS:-0}"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
});

afterEach(() => sandbox.close());

const clear = (args, env = {}) =>
  sandbox.run(SCRIPT, { args, env: { CLEAR_BACKUP: backupScript, ...env } });
const clearing = (calls) => calls.filter(({ args }) => args.includes("dist/cli/clear-content.js"));

describe("clearing the demo content", () => {
  it("backs up first, then clears through the API image with the confirmation", async () => {
    const result = await clear(["--confirm", "fictional_site"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.calls.map(({ tool }) => tool),
      ["backup", "docker"],
    );
    const [call] = clearing(result.calls);
    assert.deepEqual(call.args.slice(0, 6), [
      "compose",
      "--env-file",
      sandbox.envFile,
      "exec",
      "-T",
      "api",
    ]);
    assert.deepEqual(call.args.slice(6), [
      "node",
      "dist/cli/clear-content.js",
      "--confirm",
      "fictional_site",
    ]);
  });

  it("clears nothing when the backup fails", async () => {
    const result = await clear(["--confirm", "fictional_site"], { FICTIONAL_BACKUP_STATUS: "1" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /backup/);
    assert.deepEqual(clearing(result.calls), []);
  });

  for (const [label, args] of [
    ["without a confirmation", []],
    ["with an empty confirmation", ["--confirm", ""]],
    ["with the name of another database", ["--confirm", "fictional_other"]],
    ["with an extra argument", ["--confirm", "fictional_site", "--now"]],
  ]) {
    it(`neither backs up nor clears ${label}`, async () => {
      const result = await clear(args);
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.calls, []);
    });
  }

  it("fails when the clear-content command fails", async () => {
    sandbox.scenario({ failClear: true });
    const result = await clear(["--confirm", "fictional_site"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /clear-demo: /);
  });
});
