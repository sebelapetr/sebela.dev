// Behaviour of the backup script infra/scripts/backup.sh (docs/release-workflow.md, "Backups"):
// what it dumps and encrypts, where it uploads, which old backups the retention removes, that a
// failure at any step exits non-zero without the heartbeat, and that no secret reaches its output.
// The real script runs with a fake docker and a fake age first on PATH
// (fixtures/fake-backup-tools/) and a fake Bunny Storage zone with a heartbeat endpoint
// (fixtures/fake-storage.mjs); the round trip with real tools is backup.e2e.mjs.

import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  createSandbox,
  HEARTBEAT_ID,
  PASSWORD,
  RECIPIENT,
  script,
} from "./fixtures/backup-sandbox.mjs";

const SCRIPT = script("backup.sh");
const DAY = 86_400_000;
const NAME = /^postgres\/\d{8}T\d{6}Z\.dump\.age$/;

let sandbox;
let dir;
let storage;

beforeEach(async () => {
  sandbox = await createSandbox();
  ({ dir, storage } = sandbox);
});

afterEach(() => sandbox.close());

const scenario = (value) => sandbox.scenario(value);
const settings = (overrides) => sandbox.settings(overrides);
const backup = (options) => sandbox.run(SCRIPT, options);

/** The name a backup taken `daysAgo` days before now carries. */
function backupName(daysAgo, now = Date.now()) {
  const stamp = new Date(now - daysAgo * DAY).toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `${stamp}Z.dump.age`;
}

const uploads = () => storage.requests.filter(({ method }) => method === "PUT");
const deletions = () =>
  storage.requests
    .filter(({ method }) => method === "DELETE")
    .map(({ path: p }) => path.basename(p));
const stored = () => [...storage.files.keys()].sort();

function assertNoSecret(result) {
  for (const secret of [PASSWORD, HEARTBEAT_ID]) {
    assert.equal(result.stdout.includes(secret), false, "no secret on standard output");
    assert.equal(result.stderr.includes(secret), false, "no secret on standard error");
    for (const call of result.calls) {
      assert.equal(JSON.stringify(call.args).includes(secret), false, "no secret in a tool call");
    }
  }
}

describe("a backup", () => {
  it("dumps the database, encrypts it to the recipient, uploads it and pings the heartbeat", async () => {
    scenario({ dump: "fictional dump content" });
    const result = await backup();
    assert.equal(result.status, 0, result.stderr);

    const dump = result.calls.find(
      ({ tool, args }) => tool === "docker" && args.includes("pg_dump"),
    );
    assert.ok(dump, "pg_dump ran");
    assert.deepEqual(dump.args.slice(0, 6), [
      "compose",
      "--env-file",
      path.join(dir, "production.env"),
      "exec",
      "-T",
      "postgres",
    ]);
    for (const expected of [
      "--username",
      "fictional_superuser",
      "--dbname",
      "fictional_site",
      "--format",
      "custom",
      "--no-owner",
      "--no-privileges",
    ]) {
      assert.ok(dump.args.includes(expected), `pg_dump ${expected}`);
    }
    const encryption = result.calls.find(({ tool }) => tool === "age");
    assert.deepEqual(encryption.args.slice(0, 3), ["--encrypt", "--recipient", RECIPIENT]);

    const names = stored();
    assert.equal(names.length, 1);
    assert.match(names[0], NAME);
    assert.equal(
      storage.files.get(names[0]).toString(),
      `age[${RECIPIENT}](fictional dump content)`,
      "only the encrypted dump is uploaded",
    );
    assert.equal(uploads()[0].headers.accesskey, PASSWORD);
    assert.equal(storage.heartbeats(), 1);
    assertNoSecret(result);
  });

  it("names the backup by the time it was taken, in UTC", async () => {
    const before = Date.now();
    const result = await backup();
    const after = Date.now();
    assert.equal(result.status, 0, result.stderr);
    const [name] = stored();
    const match = /^postgres\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(name);
    const taken = Date.UTC(match[1], match[2] - 1, match[3], match[4], match[5], match[6]);
    assert.ok(taken >= before - 1000 && taken <= after, `${name} is the time of the backup`);
  });

  it("leaves no dump behind on the server", async () => {
    assert.equal((await backup()).status, 0);
    assert.deepEqual(sandbox.leftovers(), []);
    scenario({ failDump: true });
    assert.notEqual((await backup()).status, 0);
    assert.deepEqual(sandbox.leftovers(), []);
  });

  it("reads BACKUP_ENV_FILE before DEPLOY_ENV_FILE", async () => {
    const result = await backup({
      env: {
        BACKUP_ENV_FILE: sandbox.envFile,
        DEPLOY_ENV_FILE: path.join(dir, "absent.env"),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(stored().length, 1);
  });

  it("refuses arguments", async () => {
    const result = await backup({ args: ["--now"] });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
    assert.equal(storage.requests.length, 0);
  });
});

describe("the settings", () => {
  const required = [
    "POSTGRES_USER",
    "DATABASE_NAME",
    "BACKUP_STORAGE_ENDPOINT",
    "BACKUP_STORAGE_ZONE",
    "BACKUP_STORAGE_PASSWORD",
    "BACKUP_AGE_RECIPIENT",
    "BACKUP_HEARTBEAT_URL",
  ];

  for (const name of required) {
    for (const [label, value] of [
      ["missing", undefined],
      ["empty", ""],
      ["a placeholder", "replace-with-a-value"],
    ]) {
      it(`refuse ${name} ${label}, before anything runs`, async () => {
        settings({ [name]: value });
        const result = await backup();
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, new RegExp(name));
        assert.deepEqual(result.calls, []);
        assert.equal(storage.requests.length, 0);
        assertNoSecret(result);
      });
    }
  }

  it("refuse a missing environment file", async () => {
    const result = await backup({ env: { DEPLOY_ENV_FILE: path.join(dir, "absent.env") } });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
  });

  for (const [name, value] of [
    ["BACKUP_AGE_RECIPIENT", "AGE-SECRET-KEY-1FICTIONAL"],
    ["BACKUP_AGE_RECIPIENT", "ssh-ed25519 AAAA fictional"],
    ["BACKUP_STORAGE_ZONE", "../other-zone"],
    ["BACKUP_STORAGE_ENDPOINT", "ftp://storage.example"],
    ["BACKUP_STORAGE_PASSWORD", 'with"quote'],
    ["BACKUP_HEARTBEAT_URL", "not a url"],
    ["DATABASE_NAME", "site; DROP"],
  ]) {
    it(`refuse ${name} of the wrong form (${value})`, async () => {
      settings({ [name]: value });
      const result = await backup();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(name));
      assert.deepEqual(result.calls, []);
      assert.equal(storage.requests.length, 0);
    });
  }

  it("never print the private key when it is given as the recipient", async () => {
    settings({ BACKUP_AGE_RECIPIENT: "AGE-SECRET-KEY-1FICTIONALPRIVATEVALUE" });
    const result = await backup();
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr.includes("FICTIONALPRIVATEVALUE"), false);
  });
});

describe("failure handling", () => {
  const assertFailedWithoutHeartbeat = (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /backup: /);
    assert.equal(storage.heartbeats(), 0, "no heartbeat after a failure");
    assertNoSecret(result);
  };

  it("uploads nothing and sends no heartbeat when the dump fails", async () => {
    scenario({ failDump: true });
    const result = await backup();
    assertFailedWithoutHeartbeat(result);
    assert.deepEqual(uploads(), []);
  });

  it("uploads nothing and sends no heartbeat when the encryption fails", async () => {
    scenario({ failAge: true });
    const result = await backup();
    assertFailedWithoutHeartbeat(result);
    assert.deepEqual(uploads(), []);
  });

  it("sends no heartbeat when the upload fails", async () => {
    storage.failures.upload = true;
    const result = await backup();
    assertFailedWithoutHeartbeat(result);
    assert.deepEqual(stored(), []);
  });

  it("sends no heartbeat when the zone refuses the password", async () => {
    settings({ BACKUP_STORAGE_PASSWORD: "fictional-wrong-password" });
    const result = await backup();
    assertFailedWithoutHeartbeat(result);
    assert.equal(result.stderr.includes("fictional-wrong-password"), false);
  });

  it("sends no heartbeat when the old backups cannot be listed", async () => {
    storage.failures.list = true;
    const result = await backup();
    assertFailedWithoutHeartbeat(result);
    assert.equal(stored().length, 1, "the new backup stays");
  });

  it("sends no heartbeat when an expired backup cannot be removed", async () => {
    const expired = backupName(120);
    storage.files.set(`postgres/${expired}`, Buffer.from("old"));
    storage.failures.delete = [expired];
    const result = await backup();
    assertFailedWithoutHeartbeat(result);
  });

  it("succeeds without hiding it when only the heartbeat fails", async () => {
    storage.failures.heartbeat = true;
    const result = await backup();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /heartbeat/);
    assert.equal(stored().length, 1);
  });
});

/** The ISO week (`2026-W47`) of a time, as `date +%G-W%V` gives it. */
function isoWeek(time) {
  const date = new Date(time);
  // The Thursday of the same Monday-to-Sunday week decides the ISO year and week.
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday - yearStart) / DAY + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

describe("retention", () => {
  it("keeps 14 days of daily backups and the newest of each week for three months", async () => {
    const now = Date.now();
    const daily = Array.from({ length: 130 }, (_, index) => index + 1);
    for (const daysAgo of daily)
      storage.files.set(`postgres/${backupName(daysAgo, now)}`, Buffer.from("x"));

    const result = await backup();
    assert.equal(result.status, 0, result.stderr);

    const expected = new Set();
    const weeks = new Set();
    for (const daysAgo of daily) {
      const name = backupName(daysAgo, now);
      if (daysAgo < 14) expected.add(name);
      else if (daysAgo < 92) {
        const week = isoWeek(now - daysAgo * DAY);
        if (!weeks.has(week)) expected.add(name);
        weeks.add(week);
      }
    }
    const kept = stored().map((key) => path.basename(key));
    const fresh = kept.filter(
      (name) => !daily.some((daysAgo) => backupName(daysAgo, now) === name),
    );
    assert.equal(fresh.length, 1, "the new backup is kept");
    assert.deepEqual(kept.filter((name) => !fresh.includes(name)).sort(), [...expected].sort());
    assert.equal(deletions().length, daily.length - expected.size);
    assert.equal(storage.heartbeats(), 1);
  });

  it("keeps every backup younger than 14 days, however many there are", async () => {
    const now = Date.now();
    const names = [0.1, 0.2, 0.5, 3, 3.5, 13.5].map((daysAgo) => backupName(daysAgo, now));
    for (const name of names) storage.files.set(`postgres/${name}`, Buffer.from("x"));
    assert.equal((await backup()).status, 0);
    assert.deepEqual(deletions(), []);
    assert.equal(stored().length, names.length + 1);
  });

  it("removes every backup older than three months", async () => {
    const now = Date.now();
    for (const daysAgo of [93, 100, 200, 400]) {
      storage.files.set(`postgres/${backupName(daysAgo, now)}`, Buffer.from("x"));
    }
    assert.equal((await backup()).status, 0);
    assert.equal(deletions().length, 4);
    assert.equal(stored().length, 1);
  });

  it("leaves files that are not backups alone", async () => {
    for (const name of [
      "notes.txt",
      "20260101T000000Z.dump",
      "manual-copy.dump.age",
      "2026-01-01.dump.age",
    ]) {
      storage.files.set(`postgres/${name}`, Buffer.from("x"));
    }
    assert.equal((await backup()).status, 0);
    assert.deepEqual(deletions(), []);
    assert.equal(stored().length, 5);
  });

  it("counts a backup that is already gone as removed", async () => {
    const expired = backupName(120);
    storage.files.set(`postgres/${expired}`, Buffer.from("x"));
    // Gone between the listing and the deletion: the fake answers 404 for a missing file.
    const originalDelete = storage.files.delete.bind(storage.files);
    storage.files.delete = (key) => (originalDelete(key), false);
    const result = await backup();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(storage.heartbeats(), 1);
  });
});
