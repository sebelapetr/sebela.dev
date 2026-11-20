// Behaviour of the restore script infra/scripts/restore.sh (docs/release-workflow.md, "Restore"):
// it lists and fetches the encrypted backups of the zone, restores a decrypted dump from standard
// input into a database only after the name is confirmed, refuses to overwrite a database unless
// told to, compares the row counts with the source and fails when they differ, and drops only a
// confirmed database that is neither the site's nor the cluster's. The real script runs with the
// fake docker first on PATH and a fake storage zone (fixtures/backup-sandbox.mjs).

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createSandbox, PASSWORD, script, SITE, statements } from "./fixtures/backup-sandbox.mjs";

const SCRIPT = script("restore.sh");
const REHEARSAL = "fictional_rehearsal";
/** Whether a statement begins with `text`, written with the database names as values. */
const begins = (text) => (statement) => statement.startsWith(text);
const COUNTS = "profile.experiences 4\nprofile.media 2\nai_roadmap.resources 7\n";
const FEWER = "profile.experiences 4\nprofile.media 1\nai_roadmap.resources 7\n";

let sandbox;

beforeEach(async () => {
  sandbox = await createSandbox();
  sandbox.scenario({
    databases: ["fictional_site", "fictional_cluster"],
    counts: { fictional_site: COUNTS, fictional_rehearsal: COUNTS },
  });
});

afterEach(() => sandbox.close());

const restore = (args, options = {}) => sandbox.run(SCRIPT, { args, ...options });
const restoreCalls = (calls) => calls.filter(({ args }) => args.includes("pg_restore"));

describe("listing and fetching", () => {
  it("lists the backups of the zone, oldest first, and nothing else", async () => {
    const { files } = sandbox.storage;
    files.set("postgres/20261102T020000Z.dump.age", Buffer.from("b"));
    files.set("postgres/20261101T020000Z.dump.age", Buffer.from("a"));
    files.set("postgres/notes.txt", Buffer.from("n"));
    const result = await restore(["list"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "20261101T020000Z.dump.age\n20261102T020000Z.dump.age\n");
    assert.equal(result.stderr.includes(PASSWORD), false);
  });

  it("fetches one encrypted backup to standard output, byte for byte", async () => {
    const content = Buffer.from([0, 1, 2, 250, 251, 10, 13, 0]);
    sandbox.storage.files.set("postgres/20261101T020000Z.dump.age", content);
    const result = await restore(["fetch", "20261101T020000Z.dump.age"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, content);
  });

  it("fails on a backup that does not exist", async () => {
    const result = await restore(["fetch", "20261101T020000Z.dump.age"]);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
  });

  for (const name of ["../secrets", "20261101T020000Z.dump", "x;y", ""]) {
    it(`refuses to fetch ${JSON.stringify(name)} without asking the zone`, async () => {
      const result = await restore(["fetch", name]);
      assert.notEqual(result.status, 0);
      assert.equal(sandbox.storage.requests.length, 0);
    });
  }
});

describe("restoring into a database", () => {
  it("creates the database, restores the dump from standard input and compares with the site", async () => {
    const result = await restore(
      ["into", "fictional_rehearsal", "--confirm", "fictional_rehearsal"],
      { input: "fictional decrypted dump" },
    );
    assert.equal(result.status, 0, result.stderr);

    const sql = statements(result.calls);
    assert.ok(
      sql.some((statement) =>
        begins(`CREATE DATABASE "${REHEARSAL}" OWNER "fictional_app"`)(statement),
      ),
      "the database is created for the application's role",
    );
    assert.ok(
      sql.some((statement) => /^CREATE EXTENSION IF NOT EXISTS vector/.test(statement)),
      "the vector extension is created before the restore",
    );
    const [restored] = restoreCalls(result.calls);
    assert.equal(restored.stdin, "fictional decrypted dump");
    for (const expected of [
      "--dbname",
      "fictional_rehearsal",
      "--no-owner",
      "--role",
      "fictional_app",
      "--exit-on-error",
      "--single-transaction",
    ]) {
      assert.ok(restored.args.includes(expected), `pg_restore ${expected}`);
    }
    assert.match(result.stdout, /profile\.media\s+2\s+2/);
    assert.match(result.stdout, /equal/i);
  });

  it("fails when the row counts differ from the source", async () => {
    sandbox.scenario({
      databases: ["fictional_site"],
      counts: { fictional_site: COUNTS, fictional_rehearsal: FEWER },
    });
    const result = await restore([
      "into",
      "fictional_rehearsal",
      "--confirm",
      "fictional_rehearsal",
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /profile\.media/);
  });

  it("compares with the database --compare names", async () => {
    sandbox.scenario({
      databases: ["fictional_site"],
      counts: {
        fictional_site: FEWER,
        fictional_copy: COUNTS,
        fictional_rehearsal: COUNTS,
      },
    });
    const result = await restore([
      "into",
      "fictional_rehearsal",
      "--confirm",
      "fictional_rehearsal",
      "--compare",
      "fictional_copy",
    ]);
    assert.equal(result.status, 0, result.stderr);
  });

  it("only reports the counts when it restores over the site's own database", async () => {
    sandbox.scenario({ databases: ["fictional_site"], counts: { fictional_site: FEWER } });
    const result = await restore([
      "into",
      "fictional_site",
      "--confirm",
      "fictional_site",
      "--replace",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /profile\.media\s+1/);
  });

  it("refuses a database that exists unless --replace is given", async () => {
    const result = await restore(["into", "fictional_site", "--confirm", "fictional_site"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--replace/);
    assert.deepEqual(restoreCalls(result.calls), []);
    assert.equal(
      statements(result.calls).some((statement) => /^(?:CREATE|DROP) DATABASE/.test(statement)),
      false,
    );
  });

  it("drops and recreates a database it is told to replace", async () => {
    const result = await restore([
      "into",
      "fictional_site",
      "--confirm",
      "fictional_site",
      "--replace",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const sql = statements(result.calls);
    const dropped = sql.findIndex((statement) =>
      begins(`DROP DATABASE "${SITE}" WITH (FORCE)`)(statement),
    );
    const created = sql.findIndex((statement) => begins(`CREATE DATABASE "${SITE}"`)(statement));
    assert.ok(dropped !== -1 && created > dropped, "dropped, then created");
  });

  for (const [label, args] of [
    ["without a confirmation", ["into", "fictional_rehearsal"]],
    [
      "with a confirmation of another name",
      ["into", "fictional_rehearsal", "--confirm", "fictional_site"],
    ],
    ["with an invalid name", ["into", "Rehearsal;DROP", "--confirm", "Rehearsal;DROP"]],
    [
      "with an unknown option",
      ["into", "fictional_rehearsal", "--confirm", "fictional_rehearsal", "--force"],
    ],
    [
      "with an invalid comparison name",
      ["into", "fictional_rehearsal", "--confirm", "fictional_rehearsal", "--compare", "x y"],
    ],
  ]) {
    it(`does nothing ${label}`, async () => {
      const result = await restore(args, { input: "fictional decrypted dump" });
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.calls, []);
    });
  }

  it("fails when the restore fails", async () => {
    sandbox.scenario({ databases: [], counts: { fictional_site: COUNTS }, failRestore: true });
    const result = await restore([
      "into",
      "fictional_rehearsal",
      "--confirm",
      "fictional_rehearsal",
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /restore: /);
  });

  it("says the replaced database is now empty when the restore over it fails", async () => {
    sandbox.scenario({
      databases: ["fictional_site"],
      counts: { fictional_site: COUNTS },
      failRestore: true,
    });
    const result = await restore([
      "into",
      "fictional_site",
      "--confirm",
      "fictional_site",
      "--replace",
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fictional_site is now empty/);
  });

  it("refuses an unknown command and settings of the wrong form", async () => {
    assert.notEqual((await restore(["recover"])).status, 0);
    sandbox.settings({ DATABASE_USER: "app; DROP" });
    const result = await restore([
      "into",
      "fictional_rehearsal",
      "--confirm",
      "fictional_rehearsal",
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DATABASE_USER/);
    assert.deepEqual(result.calls, []);
  });
});

describe("dropping a rehearsal database", () => {
  it("drops a confirmed database", async () => {
    sandbox.scenario({ databases: ["fictional_rehearsal"] });
    const result = await restore([
      "drop",
      "fictional_rehearsal",
      "--confirm",
      "fictional_rehearsal",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      statements(result.calls).some((statement) =>
        begins(`DROP DATABASE "${REHEARSAL}" WITH (FORCE)`)(statement),
      ),
    );
  });

  for (const name of ["fictional_site", "fictional_cluster"]) {
    it(`never drops ${name}`, async () => {
      const result = await restore(["drop", name, "--confirm", name]);
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.calls, []);
    });
  }

  it("does nothing without the confirmation", async () => {
    const result = await restore(["drop", "fictional_rehearsal", "--confirm", "fictional_other"]);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
  });
});
