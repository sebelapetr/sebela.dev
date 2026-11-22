// Behaviour of the deployment script infra/scripts/deploy.sh (docs/release-workflow.md,
// "Deployment"): which input it accepts, when it backs up before migrating, how it falls back to
// the previous release, what it records and which images it prunes, and how it brings the server's
// checkout to the release commit first. The real script runs from a temporary checkout with a bare
// origin of its own (fixtures/deploy-checkout.mjs), with a fake docker command line first on PATH
// (fixtures/fake-docker/docker), which records each call and answers from a scenario; the
// simulated deployment against real containers is deploy.e2e.mjs.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { GIT_ENV, createCheckout } from "./fixtures/deploy-checkout.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const FAKE_DOCKER = path.join(import.meta.dirname, "fixtures", "fake-docker");
const REGISTRY = "registry.example/owner";

const sha = (character) => character.repeat(40);
const A = sha("a");
const B = sha("b");
const C = sha("c");
const D = sha("d");
const line = (api, web = api, mcp = api) => `api=${api} web=${web} mcp-admin=${mcp}`;
const deployInput = (api, web = api, mcp = api) =>
  `deploy release=${repo.commits.release} ${line(api, web, mcp)}`;

let dir;
let repo;
let state;
let backupMarker;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-deploy-test-"));
  state = path.join(dir, "state");
  fs.mkdirSync(state);
  repo = createCheckout(dir);
  fs.writeFileSync(path.join(dir, "production.env"), "# placeholder\n");
  backupMarker = path.join(dir, "backup-ran");
  fs.writeFileSync(
    path.join(dir, "backup.sh"),
    `#!/bin/sh\necho backup >> "${backupMarker}"\necho '{"args":["backup"]}' >> "${path.join(dir, "docker.log")}"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(dir, "failing-backup.sh"), "#!/bin/sh\nexit 3\n", { mode: 0o755 });
  scenario({});
});

afterEach(() => {
  // A test may have taken the write permission of the state folder away.
  fs.chmodSync(state, 0o700);
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Sets what the fake docker answers. */
function scenario(value) {
  fs.writeFileSync(path.join(dir, "scenario.json"), JSON.stringify(value));
}

/** Writes the record of verified releases, oldest first. */
function record(...lines) {
  fs.writeFileSync(path.join(state, "releases"), lines.map((entry) => `${entry}\n`).join(""));
}

function releases() {
  const file = path.join(state, "releases");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
}

function environment({ ssh, backup = "backup.sh", env = {} } = {}) {
  const inherited = { ...process.env };
  delete inherited.SSH_ORIGINAL_COMMAND;
  return {
    ...inherited,
    ...GIT_ENV,
    DEPLOY_TEST_STARTS: path.join(dir, "starts"),
    PATH: `${FAKE_DOCKER}${path.delimiter}${process.env.PATH ?? ""}`,
    FAKE_DOCKER_SCENARIO: path.join(dir, "scenario.json"),
    FAKE_DOCKER_LOG: path.join(dir, "docker.log"),
    DEPLOY_ENV_FILE: path.join(dir, "production.env"),
    DEPLOY_STATE_DIR: state,
    DEPLOY_BACKUP: path.join(dir, backup),
    DEPLOY_REGISTRY: REGISTRY,
    DEPLOY_WAIT_TIMEOUT: "5",
    ...(ssh === undefined ? {} : { SSH_ORIGINAL_COMMAND: ssh }),
    ...env,
  };
}

/**
 * Runs the script with `input` as its arguments, or as the SSH command when `ssh` is set.
 * Returns the exit status, the output and the docker calls in order.
 */
function deploy(input, options = {}) {
  const args = options.ssh === undefined ? input.split(" ").filter(Boolean) : [];
  const result = spawnSync("bash", [repo.script, ...args], {
    env: environment({ ...options, ssh: options.ssh === undefined ? undefined : input }),
    encoding: "utf8",
    timeout: 30_000,
  });
  const log = path.join(dir, "docker.log");
  const calls = fs.existsSync(log)
    ? fs
        .readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((entry) => JSON.parse(entry))
    : [];
  fs.rmSync(log, { force: true });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
}

/** Which versions of the script started, in order, by the label of their commit. */
function starts() {
  const file = path.join(dir, "starts");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
}

/** The steps of the calls: pull, backup, migrate, up, ls (an image's migrations), prune. */
function steps(calls) {
  return calls.map(({ args }) => {
    if (args[0] === "backup") return "backup";
    if (args[0] === "compose") {
      if (args.includes("pull")) return "pull";
      if (args.includes("run")) return "migrate";
      if (args.includes("up")) return "up";
    }
    if (args[0] === "run") return "ls";
    if (args[0] === "image" && args[1] === "ls") return "image-ls";
    if (args[0] === "image" && args[1] === "rm") return "image-rm";
    return args.join(" ");
  });
}

const ups = (calls) => calls.filter(({ args }) => args[0] === "compose" && args.includes("up"));

/** The services a `compose up` call names; the migration is never one of them. */
const LONG_RUNNING = ["postgres", "api", "web", "mcp-admin"];
function assertStartsWithoutMigration(up) {
  assert.ok(up.args.includes("--no-deps"), "up does not start dependencies such as migrate");
  assert.deepEqual(up.args.slice(-LONG_RUNNING.length), LONG_RUNNING, "up names the services");
  assert.equal(up.args.includes("migrate"), false, "up does not start the migration");
}

const MIGRATIONS = { [A]: ["0001_a.sql"], [B]: ["0001_a.sql"], [C]: ["0001_a.sql", "0002_c.sql"] };

describe("input validation", () => {
  // Refused before the commit is looked at, so any well-formed release commit will do.
  const validated = (api, web = api, mcp = api) =>
    `deploy release=${sha("e")} ${line(api, web, mcp)}`;

  const rejected = {
    "no input": "",
    "an unknown command": "status",
    "a shell command": "ls -la",
    "an unknown service": `${validated(A)} postgres=${A}`,
    "a missing service": `deploy api=${A} web=${A}`,
    "a repeated service": `deploy api=${A} web=${A} web=${A} mcp-admin=${A}`,
    "a service without a tag": `deploy api= web=${A} mcp-admin=${A}`,
    "a short tag": validated("abc1234"),
    "an upper-case tag": validated(A.toUpperCase()),
    "a moving tag": validated("current"),
    "a tag one character too long": validated(`${A}a`),
    "rollback with arguments": `rollback ${line(A)}`,
    "a command separator": `${validated(A)};touch PWNED`,
    "a command substitution": `deploy api=$(touch PWNED) web=${A} mcp-admin=${A}`,
    backticks: `deploy api=\`touch PWNED\` web=${A} mcp-admin=${A}`,
    "a pipe": `${validated(A)} | sh`,
    "an and-list": `${validated(A)} && touch PWNED`,
    "a newline": `${validated(A)}\ntouch PWNED`,
    "a variable": `deploy api=$HOME web=${A} mcp-admin=${A}`,
    "a glob": `deploy api=* web=${A} mcp-admin=${A}`,
    "a path": `deploy api=../../${A} web=${A} mcp-admin=${A}`,
    "an option": `deploy --help`,
    "no release commit": `deploy ${line(A)}`,
    "a release commit twice": `deploy release=${A} release=${A} ${line(A)}`,
    "a short release commit": `deploy release=abc1234 ${line(A)}`,
    "a release commit that is not a SHA": `deploy release=master ${line(A)}`,
  };

  for (const via of ["arguments", "SSH command"]) {
    for (const [name, input] of Object.entries(rejected)) {
      it(`refuses ${name} given as ${via}`, () => {
        record(line(A));
        const result = deploy(input, via === "SSH command" ? { ssh: true } : {});
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /deploy: /);
        assert.deepEqual(result.calls, [], "nothing ran");
        assert.equal(repo.head(), repo.commits.old, "the checkout did not move");
        assert.deepEqual(releases(), [line(A)], "the record is unchanged");
        assert.equal(fs.existsSync(path.join(ROOT, "PWNED")), false);
        assert.equal(fs.existsSync(path.join(process.cwd(), "PWNED")), false);
      });
    }
  }

  it("takes the SSH command, never the arguments, when it runs as the forced command", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const result = spawnSync("bash", [repo.script, "deploy", line(B)], {
      env: environment({ ssh: "status" }),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.deepEqual(releases(), [line(A)]);
  });

  it("accepts the services in any order", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const release = `release=${repo.commits.release}`;
    const result = deploy(`deploy mcp-admin=${B} ${release} api=${B} web=${B}`, { ssh: true });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(releases(), [line(A), line(B)]);
  });

  it("refuses to run without its environment file or state folder", () => {
    for (const name of ["DEPLOY_ENV_FILE", "DEPLOY_STATE_DIR"]) {
      const result = deploy(deployInput(B), { env: { [name]: "" } });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(name));
      assert.deepEqual(result.calls, []);
    }
  });

  it("names the setting, not a path, when the environment file or state folder is wrong", () => {
    const wrong = {
      DEPLOY_ENV_FILE: [path.join(dir, "no-such-environment-file"), /DEPLOY_ENV_FILE/],
      DEPLOY_STATE_DIR: [path.join(dir, "no-such-state-folder"), /DEPLOY_STATE_DIR/],
    };
    for (const [name, [value, setting]] of Object.entries(wrong)) {
      const result = deploy(deployInput(B), { env: { [name]: value } });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, setting);
      assert.equal(result.stderr.includes(dir), false, "the message names no path");
      assert.deepEqual(result.calls, []);
    }
  });

  it("refuses a second deployment while one is running", async () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const holder = spawn("flock", [path.join(state, "lock"), "sleep", "5"], { stdio: "ignore" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const result = deploy(deployInput(B));
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /another deployment/);
      assert.deepEqual(result.calls, []);
    } finally {
      holder.kill();
    }
  });
});

describe("the checkout", () => {
  it("is brought to the release commit before Compose runs, with that commit's files", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(B), { ssh: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(repo.head(), repo.commits.release, "the checkout is at the release commit");
    assert.equal(repo.status(), "", "the checkout has no local changes");
    const composeCalls = result.calls.filter(({ args }) => args[0] === "compose");
    assert.ok(composeCalls.length > 0);
    for (const call of composeCalls) {
      assert.deepEqual(call.composeFiles, ["# release", "# release"], call.args.join(" "));
    }
    assert.deepEqual(releases(), [line(A), line(B)]);
  });

  it("runs the release's script once after the checked-out one: one re-execution, no loop", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(B));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(starts(), ["old", "release"]);
  });

  it("re-executes nothing when the checkout is at the release commit already", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    assert.equal(deploy(deployInput(B)).status, 0);
    fs.rmSync(path.join(dir, "starts"));
    const result = deploy(deployInput(C));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(starts(), ["release", "release"], "checked once, then the same script once");
    assert.equal(repo.head(), repo.commits.release);
  });

  const refused = {
    "a commit that is not on origin's master": () => repo.commits.side,
    "a commit origin does not have": () => D,
  };
  for (const [name, commit] of Object.entries(refused)) {
    it(`refuses ${name}, with nothing changed`, () => {
      record(line(A));
      scenario({ migrations: MIGRATIONS });
      const result = deploy(`deploy release=${commit()} ${line(B)}`, { ssh: true });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /not on origin\/master; nothing changed/);
      assert.deepEqual(result.calls, [], "docker never ran");
      assert.equal(repo.head(), repo.commits.old, "the checkout did not move");
      assert.deepEqual(starts(), ["old"], "the checked-out script did not re-execute");
      assert.deepEqual(releases(), [line(A)]);
    });
  }

  it("refuses a checkout with local modifications, with nothing changed", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const compose = path.join(repo.checkout, "compose.yaml");
    fs.appendFileSync(compose, "# edited on the server\n");
    const result = deploy(deployInput(B), { ssh: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /local modifications; nothing changed/);
    assert.deepEqual(result.calls, []);
    assert.equal(repo.head(), repo.commits.old);
    assert.match(fs.readFileSync(compose, "utf8"), /edited on the server/, "the edit is kept");
    assert.deepEqual(releases(), [line(A)]);
  });

  it("refuses to skip the checkout through the re-execution flag", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(B), {
      env: { DEPLOY_RELEASE_CHECKED_OUT: repo.commits.release },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not at the release commit/);
    assert.deepEqual(result.calls, []);
    assert.equal(repo.head(), repo.commits.old);
    assert.deepEqual(releases(), [line(A)]);
  });

  it("leaves the checkout as it is on a rollback", () => {
    record(line(A), line(B));
    scenario({ migrations: MIGRATIONS });
    const result = deploy("rollback", { ssh: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(repo.head(), repo.commits.old);
    assert.deepEqual(starts(), ["old"]);
    assert.deepEqual(releases(), [line(A)]);
  });
});

describe("a deployment", () => {
  it("pulls, migrates once, recreates the services, waits for health and records the tag set", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(B, A, B));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      steps(result.calls).filter((step) => step !== "ls" && !step.startsWith("image")),
      ["pull", "migrate", "up"],
    );
    const [up] = ups(result.calls);
    assertStartsWithoutMigration(up);
    assert.deepEqual(up.tags, { api: B, web: A, "mcp-admin": B });
    assert.ok(up.args.includes("--wait"));
    assert.ok(up.args.includes("--detach"));
    assert.ok(up.args.includes(path.join(dir, "production.env")), "the environment file");
    assert.deepEqual(releases(), [line(A), line(B, A, B)]);
  });

  it("does not record the same tag set twice", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    assert.equal(deploy(deployInput(A)).status, 0);
    assert.deepEqual(releases(), [line(A)]);
  });
});

// The record of verified releases is what a rollback and the fallback of a failed deployment read.
// A state folder the script cannot keep it in is found before anything changes, never after the
// running services were replaced. (Permission checks do not bind root, so these tests need an
// ordinary user, as CI and the server's deploy user are.)
describe("the state folder", () => {
  const recordFile = () => path.join(state, "releases");

  /** Refused before anything ran: no Docker call, the checkout and the record as they were. */
  function assertNothingChanged(result, message, recorded) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.match(result.stderr, /nothing changed/);
    assert.equal(result.stderr.includes(dir), false, "the message names no path");
    assert.deepEqual(result.calls, [], "docker never ran");
    assert.equal(repo.head(), repo.commits.old, "the checkout did not move");
    assert.deepEqual(starts(), ["old"], "the script did not re-execute");
    assert.deepEqual(releases(), recorded);
  }

  for (const [name, input] of [
    ["a deployment", () => deployInput(B)],
    ["a rollback", () => "rollback"],
  ]) {
    it(`refuses ${name} when the record is not writable, with nothing changed`, () => {
      record(line(A), line(C));
      fs.chmodSync(recordFile(), 0o444);
      scenario({ migrations: MIGRATIONS });
      const result = deploy(input(), { ssh: true });
      assertNothingChanged(result, /record of verified releases is not writable/, [
        line(A),
        line(C),
      ]);
    });

    it(`refuses ${name} when the state folder is not writable, with nothing changed`, () => {
      record(line(A), line(C));
      fs.writeFileSync(path.join(state, "lock"), "");
      fs.chmodSync(state, 0o555);
      scenario({ migrations: MIGRATIONS });
      const result = deploy(input(), { ssh: true });
      assertNothingChanged(result, /state folder is not writable/, [line(A), line(C)]);
    });

    it(`refuses ${name} when the lock cannot be opened, with nothing changed`, () => {
      record(line(A), line(C));
      fs.writeFileSync(path.join(state, "lock"), "", { mode: 0o444 });
      scenario({ migrations: MIGRATIONS });
      const result = deploy(input(), { ssh: true });
      assertNothingChanged(result, /lock .* cannot be opened/, [line(A), line(C)]);
    });
  }

  it("refuses a record that is not a file, with nothing changed", () => {
    fs.mkdirSync(recordFile());
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(B), { ssh: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /record of verified releases is not a file; nothing changed/);
    assert.deepEqual(result.calls, []);
    assert.equal(repo.head(), repo.commits.old);
  });

  it("names the user that needs the access", () => {
    record(line(A));
    fs.chmodSync(recordFile(), 0o444);
    const result = deploy(deployInput(B));
    assert.ok(result.stderr.includes(os.userInfo().username), result.stderr);
  });

  it("says that a healthy release is running but not recorded, and does not roll it back", () => {
    record(line(A));
    const image = `${REGISTRY}/sebela-api:${D}`;
    scenario({ migrations: MIGRATIONS, chmodOnUp: { [recordFile()]: "444" }, images: [image] });
    const result = deploy(deployInput(B));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /is running but is NOT recorded/);
    assert.ok(result.stderr.includes(`\ndeploy:   ${line(B)}\n`), "the exact line to append");
    assert.equal(result.stderr.includes(dir), false, "the message names no path");
    assert.deepEqual(
      ups(result.calls).map(({ tags }) => tags),
      [{ api: B, web: B, "mcp-admin": B }],
      "the healthy release keeps running: the previous one is not started",
    );
    assert.equal(steps(result.calls).includes("image-rm"), false, "no image is removed");
    assert.deepEqual(releases(), [line(A)]);
  });

  it("records the release when the deployment is run again after the record was repaired", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS, chmodOnUp: { [recordFile()]: "444" } });
    assert.notEqual(deploy(deployInput(B)).status, 0);
    fs.chmodSync(recordFile(), 0o644);
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(B));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(releases(), [line(A), line(B)]);
  });

  it("says that a rollback is running but the record still names the newer release", () => {
    record(line(A), line(B));
    scenario({ migrations: MIGRATIONS, chmodOnUp: { [state]: "555" } });
    const result = deploy("rollback");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /is running, but the record still names/);
    assert.ok(result.stderr.includes(`\ndeploy:   ${line(B)}\n`), "the exact line to remove");
    assert.equal(result.stderr.includes(dir), false, "the message names no path");
    assert.deepEqual(
      ups(result.calls).map(({ tags }) => tags),
      [{ api: A, web: A, "mcp-admin": A }],
      "the previous release keeps running",
    );
    assert.equal(steps(result.calls).includes("image-rm"), false, "no image is removed");
    assert.deepEqual(releases(), [line(A), line(B)]);
  });
});

describe("migration detection", () => {
  it("backs up first when the release adds a migration", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(C));
    assert.equal(result.status, 0, result.stderr);
    const order = steps(result.calls);
    assert.ok(order.indexOf("backup") >= 0, "the backup ran");
    assert.ok(order.indexOf("backup") < order.indexOf("migrate"), "before the migration");
    assert.ok(order.indexOf("pull") < order.indexOf("backup"), "after the pull");
  });

  it("does not back up when the migrations are the same", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(B));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(steps(result.calls).includes("backup"), false);
  });

  it("backs up on the first deployment, when there is no current release", () => {
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(A));
    assert.equal(result.status, 0, result.stderr);
    assert.ok(steps(result.calls).includes("backup"));
    assert.deepEqual(releases(), [line(A)]);
  });

  it("backs up when the current image's migrations cannot be read", () => {
    record(line(D));
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(B));
    assert.equal(result.status, 0, result.stderr);
    assert.ok(steps(result.calls).includes("backup"));
  });

  it("stops when the new image's migrations cannot be read", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(D));
    assert.notEqual(result.status, 0);
    assert.equal(steps(result.calls).includes("migrate"), false);
    assert.equal(ups(result.calls).length, 0);
    assert.deepEqual(releases(), [line(A)]);
  });

  it("fails closed with a clear message while there is no backup script", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(C), { backup: "missing-backup.sh" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /new migration/);
    assert.match(result.stderr, /backup/);
    assert.match(result.stderr, /DEPLOY_BACKUP/);
    assert.equal(result.stderr.includes(dir), false, "the message names no path");
    assert.equal(steps(result.calls).includes("migrate"), false);
    assert.equal(ups(result.calls).length, 0, "nothing was recreated");
    assert.deepEqual(releases(), [line(A)]);
  });

  it("still deploys a release without a new migration while there is no backup script", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(B), { backup: "missing-backup.sh" });
    assert.equal(result.status, 0, result.stderr);
  });

  it("stops before the migration when the backup fails", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const result = deploy(deployInput(C), { backup: "failing-backup.sh" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /backup/);
    assert.equal(steps(result.calls).includes("migrate"), false);
    assert.equal(ups(result.calls).length, 0);
    assert.deepEqual(releases(), [line(A)]);
  });
});

describe("rollback on failure", () => {
  it("redeploys the previous tags when the services do not become healthy", () => {
    record(line(A), line(B));
    scenario({ migrations: MIGRATIONS, unhealthy: [C] });
    const result = deploy(deployInput(C, B, B));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /previous release/);
    assert.deepEqual(
      ups(result.calls).map(({ tags }) => tags),
      [
        { api: C, web: B, "mcp-admin": B },
        { api: B, web: B, "mcp-admin": B },
      ],
    );
    ups(result.calls).forEach(assertStartsWithoutMigration);
    assert.deepEqual(releases(), [line(A), line(B)], "the failed release is not recorded");
  });

  it("redeploys the previous tags when the migration fails", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS, failMigrate: [B] });
    const result = deploy(deployInput(B));
    assert.notEqual(result.status, 0);
    assert.deepEqual(
      ups(result.calls).map(({ tags }) => tags),
      [{ api: A, web: A, "mcp-admin": A }],
    );
    assert.deepEqual(releases(), [line(A)]);
  });

  it("exits non-zero with nothing to fall back to on the first deployment", () => {
    scenario({ migrations: MIGRATIONS, unhealthy: [A] });
    const result = deploy(deployInput(A));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no previous release/);
    assert.equal(ups(result.calls).length, 1);
    assert.deepEqual(releases(), []);
  });

  it("exits non-zero when the previous release does not come back either", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS, unhealthy: [A, B] });
    const result = deploy(deployInput(B));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /previous release/);
    assert.deepEqual(releases(), [line(A)]);
  });
});

describe("the rollback command", () => {
  for (const via of ["arguments", "SSH command"]) {
    it(`redeploys the previous verified release, given as ${via}`, () => {
      record(line(A), line(B), line(C));
      scenario({ migrations: MIGRATIONS });
      const result = deploy("rollback", via === "SSH command" ? { ssh: true } : {});
      assert.equal(result.status, 0, result.stderr);
      assert.equal(steps(result.calls).includes("backup"), false);
      assert.equal(steps(result.calls).includes("migrate"), false);
      assert.deepEqual(
        ups(result.calls).map(({ tags }) => tags),
        [{ api: B, web: B, "mcp-admin": B }],
      );
      ups(result.calls).forEach(assertStartsWithoutMigration);
      assert.deepEqual(releases(), [line(A), line(B)]);
    });
  }

  it("refuses when there is no previous release", () => {
    record(line(A));
    const result = deploy("rollback");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no previous release/);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(releases(), [line(A)]);
  });

  it("returns to the current release when the previous one is unhealthy", () => {
    record(line(A), line(B));
    scenario({ migrations: MIGRATIONS, unhealthy: [A] });
    const result = deploy("rollback");
    assert.notEqual(result.status, 0);
    assert.deepEqual(
      ups(result.calls).map(({ tags }) => tags),
      [
        { api: A, web: A, "mcp-admin": A },
        { api: B, web: B, "mcp-admin": B },
      ],
    );
    assert.deepEqual(releases(), [line(A), line(B)]);
  });
});

describe("image retention", () => {
  const image = (service, tag) => `${REGISTRY}/sebela-${service}:${tag}`;

  it("removes the images of releases older than the previous one", () => {
    record(line(A), line(B, A, B));
    scenario({
      migrations: MIGRATIONS,
      images: [
        image("api", A),
        image("api", B),
        image("api", C),
        image("web", A),
        image("web", C),
        image("mcp-admin", A),
        image("mcp-admin", B),
        image("mcp-admin", C),
        image("mcp-admin", "current"),
      ],
    });
    const result = deploy(deployInput(C, C, C));
    assert.equal(result.status, 0, result.stderr);
    const removed = result.calls
      .filter(({ args }) => args[0] === "image" && args[1] === "rm")
      .flatMap(({ args }) => args.slice(2).filter((arg) => !arg.startsWith("-")));
    // Kept: the current release (C everywhere) and the previous one (api B, web A, mcp-admin B).
    assert.deepEqual(
      removed.sort(),
      [image("api", A), image("mcp-admin", A), image("mcp-admin", "current")].sort(),
    );
  });

  it("removes nothing after a failed deployment", () => {
    record(line(A), line(B));
    scenario({ migrations: MIGRATIONS, unhealthy: [C], images: [image("api", A)] });
    const result = deploy(deployInput(C));
    assert.notEqual(result.status, 0);
    assert.equal(steps(result.calls).includes("image-rm"), false);
  });
});
