import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backendMaintenance } from "./backend.mjs";

const OWNER = "feat-1-fixture";

// A worktree with the package scripts the backend stages look for and a generated .env.local.
function worktree(
  t,
  { scripts = {}, env = `STORAGE_WORKTREE=feat-1-fixture-0123456789\n`, installed = true } = {},
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sebela-backend-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const all = { install: true, migrate: true, storage: true, seed: true, ...scripts };
  if (all.install) write("package.json", JSON.stringify({ name: "fixture" }));
  write(
    "packages/db/package.json",
    JSON.stringify({ scripts: all.migrate ? { "db:migrate": "fixture" } : {} }),
  );
  write(
    "apps/api/package.json",
    JSON.stringify({
      scripts: {
        ...(all.storage ? { storage: "fixture" } : {}),
        ...(all.seed ? { seed: "fixture" } : {}),
      },
    }),
  );
  if (env !== null) write(".env.local", env);
  if (installed) fs.mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
  return root;
}

// Records every program the stages start and fails the one whose arguments match `failOn`.
function fakeRunner(failOn = null) {
  const calls = [];
  return {
    calls,
    run({ cwd, args, env }) {
      calls.push({ cwd, args, env });
      return failOn !== null && args.join(" ").includes(failOn) ? 1 : 0;
    },
  };
}

function maintenance(runner, env = {}) {
  const notices = [];
  const backend = backendMaintenance({
    run: (call) => runner.run(call),
    env: { PATH: "/fixture/bin", ...env },
    log: (text) => notices.push(text),
  });
  return { backend, notices };
}

const commands = (runner) => runner.calls.map(({ args }) => args.join(" "));

test("setup installs, migrates, prepares storage and seeds an empty profile, in that order", (t) => {
  const root = worktree(t);
  const runner = fakeRunner();

  maintenance(runner).backend.setup({ root, owner: OWNER });

  assert.deepEqual(commands(runner), [
    "install --frozen-lockfile --prefer-offline",
    "--filter @sebela/db db:migrate",
    `--silent --filter @sebela/api storage prepare ${OWNER}`,
    "--silent --filter @sebela/api seed --if-empty",
  ]);
  for (const call of runner.calls) assert.equal(call.cwd, root);
});

test("the stages read the worktree's own settings, not the caller's", (t) => {
  const root = worktree(t);
  const runner = fakeRunner();

  maintenance(runner, {
    DATABASE_NAME: "fixture_main",
    DATABASE_PASSWORD: "fixture-main-secret",
    POSTGRES_PASSWORD: "fixture-superuser-secret",
    STORAGE_WORKTREE: "",
    STORAGE_LOCAL_ROOT: "/fixture/shared",
    API_PORT: "1",
    MEDIA_MAX_BYTES: "1",
  }).backend.setup({ root, owner: OWNER });

  for (const { env } of runner.calls) {
    assert.equal(env.PATH, "/fixture/bin");
    for (const name of [
      "DATABASE_NAME",
      "DATABASE_PASSWORD",
      "POSTGRES_PASSWORD",
      "STORAGE_WORKTREE",
      "STORAGE_LOCAL_ROOT",
      "API_PORT",
      "MEDIA_MAX_BYTES",
    ]) {
      assert.equal(name in env, false, name);
    }
  }
});

for (const [stage, failOn] of [
  ["install", "install"],
  ["migration", "db:migrate"],
  ["storage", "storage prepare"],
  ["seed", "seed --if-empty"],
]) {
  test(`a failing ${stage} stage stops setup and is reported by name`, (t) => {
    const root = worktree(t);
    const runner = fakeRunner(failOn);

    assert.throws(
      () => maintenance(runner).backend.setup({ root, owner: OWNER }),
      new RegExp(`${stage} stage.*run create again`, "s"),
    );

    assert.ok(commands(runner).at(-1).includes(failOn), "nothing runs after the failure");
  });
}

test("a stage whose script this checkout does not have yet is skipped with a notice", (t) => {
  const root = worktree(t, { scripts: { storage: false, seed: false } });
  const runner = fakeRunner();
  const { backend, notices } = maintenance(runner);

  backend.setup({ root, owner: OWNER });

  assert.deepEqual(commands(runner), [
    "install --frozen-lockfile --prefer-offline",
    "--filter @sebela/db db:migrate",
  ]);
  assert.match(notices.join(""), /storage.*skipped/s);
  assert.match(notices.join(""), /seed.*skipped/s);
});

test("a checkout without a workspace runs nothing", (t) => {
  const root = worktree(t, {
    scripts: { install: false, migrate: false, storage: false, seed: false },
  });
  const runner = fakeRunner();

  maintenance(runner).backend.setup({ root, owner: OWNER });

  assert.deepEqual(runner.calls, []);
});

test("an environment file without a storage folder stops setup before storage is touched", (t) => {
  const root = worktree(t, { env: "DATABASE_NAME=fixture\n" });
  const runner = fakeRunner();

  assert.throws(
    () => maintenance(runner).backend.setup({ root, owner: OWNER }),
    /STORAGE_WORKTREE.*delete .*\.env\.local.*run create again/s,
  );

  assert.equal(
    commands(runner).some((command) => command.includes("storage")),
    false,
  );
  assert.equal(fs.readFileSync(path.join(root, ".env.local"), "utf8"), "DATABASE_NAME=fixture\n");
});

test("an empty storage folder setting counts as missing", (t) => {
  const root = worktree(t, { env: "STORAGE_WORKTREE=\n" });

  assert.throws(
    () => maintenance(fakeRunner()).backend.setup({ root, owner: OWNER }),
    /STORAGE_WORKTREE/,
  );
});

test("teardown removes the worktree's storage namespace", (t) => {
  const root = worktree(t);
  const runner = fakeRunner();

  maintenance(runner).backend.teardown({ root, owner: OWNER });

  assert.deepEqual(commands(runner), [`--silent --filter @sebela/api storage remove ${OWNER}`]);
  assert.equal(runner.calls[0].cwd, root);
});

test("a failing storage removal stops teardown and is reported", (t) => {
  const root = worktree(t);

  assert.throws(
    () => maintenance(fakeRunner("storage remove")).backend.teardown({ root, owner: OWNER }),
    /storage.*remove/s,
  );
});

test("teardown refuses a worktree whose tools are not installed, unless forced", (t) => {
  const root = worktree(t, { installed: false });
  const runner = fakeRunner();
  const { backend, notices } = maintenance(runner);

  assert.throws(() => backend.teardown({ root, owner: OWNER }), /pnpm install.*--force/s);

  backend.teardown({ root, owner: OWNER, force: true });
  assert.deepEqual(runner.calls, []);
  assert.match(notices.join(""), /storage/);
});

test("teardown skips storage for a worktree that never had a storage folder", (t) => {
  for (const env of [null, "DATABASE_NAME=fixture\n"]) {
    const root = worktree(t, { env });
    const runner = fakeRunner();
    const { backend, notices } = maintenance(runner);

    backend.teardown({ root, owner: OWNER });

    assert.deepEqual(runner.calls, []);
    assert.match(notices.join(""), /storage/);
  }
});

test("teardown skips a checkout without the storage command", (t) => {
  const root = worktree(t, { scripts: { storage: false } });
  const runner = fakeRunner();

  maintenance(runner).backend.teardown({ root, owner: OWNER });

  assert.deepEqual(runner.calls, []);
});
