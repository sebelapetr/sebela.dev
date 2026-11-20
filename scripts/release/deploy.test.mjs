// Behaviour of the deployment script infra/scripts/deploy.sh (docs/release-workflow.md,
// "Deployment"): which input it accepts, when it backs up before migrating, how it falls back to
// the previous release, what it records and which images it prunes. The real script runs with a
// fake docker command line first on PATH (fixtures/fake-docker/docker), which records each call
// and answers from a scenario; the simulated deployment against real containers is
// deploy.e2e.mjs.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(ROOT, "infra", "scripts", "deploy.sh");
const FAKE_DOCKER = path.join(import.meta.dirname, "fixtures", "fake-docker");
const REGISTRY = "registry.example/owner";

const sha = (character) => character.repeat(40);
const A = sha("a");
const B = sha("b");
const C = sha("c");
const D = sha("d");
const line = (api, web = api, mcp = api) => `api=${api} web=${web} mcp-admin=${mcp}`;
const deployInput = (api, web = api, mcp = api) => `deploy ${line(api, web, mcp)}`;

let dir;
let state;
let backupMarker;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-deploy-test-"));
  state = path.join(dir, "state");
  fs.mkdirSync(state);
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
  const result = spawnSync("bash", [SCRIPT, ...args], {
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

const MIGRATIONS = { [A]: ["0001_a.sql"], [B]: ["0001_a.sql"], [C]: ["0001_a.sql", "0002_c.sql"] };

describe("input validation", () => {
  const rejected = {
    "no input": "",
    "an unknown command": "status",
    "a shell command": "ls -la",
    "an unknown service": `${deployInput(A)} postgres=${A}`,
    "a missing service": `deploy api=${A} web=${A}`,
    "a repeated service": `deploy api=${A} web=${A} web=${A} mcp-admin=${A}`,
    "a service without a tag": `deploy api= web=${A} mcp-admin=${A}`,
    "a short tag": deployInput("abc1234"),
    "an upper-case tag": deployInput(A.toUpperCase()),
    "a moving tag": deployInput("current"),
    "a tag one character too long": deployInput(`${A}a`),
    "rollback with arguments": `rollback ${line(A)}`,
    "a command separator": `${deployInput(A)};touch PWNED`,
    "a command substitution": `deploy api=$(touch PWNED) web=${A} mcp-admin=${A}`,
    backticks: `deploy api=\`touch PWNED\` web=${A} mcp-admin=${A}`,
    "a pipe": `${deployInput(A)} | sh`,
    "an and-list": `${deployInput(A)} && touch PWNED`,
    "a newline": `${deployInput(A)}\ntouch PWNED`,
    "a variable": `deploy api=$HOME web=${A} mcp-admin=${A}`,
    "a glob": `deploy api=* web=${A} mcp-admin=${A}`,
    "a path": `deploy api=../../${A} web=${A} mcp-admin=${A}`,
    "an option": `deploy --help`,
  };

  for (const via of ["arguments", "SSH command"]) {
    for (const [name, input] of Object.entries(rejected)) {
      it(`refuses ${name} given as ${via}`, () => {
        record(line(A));
        const result = deploy(input, via === "SSH command" ? { ssh: true } : {});
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /deploy: /);
        assert.deepEqual(result.calls, [], "nothing ran");
        assert.deepEqual(releases(), [line(A)], "the record is unchanged");
        assert.equal(fs.existsSync(path.join(ROOT, "PWNED")), false);
        assert.equal(fs.existsSync(path.join(process.cwd(), "PWNED")), false);
      });
    }
  }

  it("takes the SSH command, never the arguments, when it runs as the forced command", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const result = spawnSync("bash", [SCRIPT, "deploy", line(B)], {
      env: environment({ ssh: "status" }),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.deepEqual(releases(), [line(A)]);
  });

  it("accepts the services in any order", () => {
    record(line(A));
    scenario({ migrations: MIGRATIONS });
    const result = deploy(`deploy mcp-admin=${B} api=${B} web=${B}`, { ssh: true });
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
