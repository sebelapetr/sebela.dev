import { test } from "node:test";
import assert from "node:assert/strict";
import { assessReadiness } from "./preflight.mjs";

const ready = {
  docker: true,
  postgres: "healthy",
  gh: true,
  branch: "master",
  base: "master",
  behind: 0,
  dirty: [],
};

test("a ready machine has nothing to block or warn about", () => {
  assert.deepEqual(assessReadiness(ready), { blocking: [], warnings: [] });
});

test("without Docker nothing can run, and the owner is told what to start", () => {
  const { blocking } = assessReadiness({ ...ready, docker: false, postgres: "unknown" });
  assert.equal(blocking.length, 1, "one cause, one message");
  assert.match(blocking[0], /Docker/);
  assert.match(blocking[0], /docker compose up --detach --wait/);
});

test("Postgres that is down or still starting blocks the run", () => {
  for (const postgres of ["down", "starting", "unhealthy", "unknown"]) {
    const { blocking } = assessReadiness({ ...ready, postgres });
    assert.equal(blocking.length, 1, postgres);
    assert.match(blocking[0], new RegExp(`Postgres is ${postgres}`));
  }
});

test("gh that is not signed in blocks the run", () => {
  const { blocking } = assessReadiness({ ...ready, gh: false });
  assert.match(blocking.join(" "), /gh auth login/);
});

test("an outdated or changed main checkout only warns, because the owner may mean it", () => {
  const behind = assessReadiness({ ...ready, behind: 2 });
  assert.deepEqual(behind.blocking, []);
  assert.match(behind.warnings[0], /2 commits behind origin\/master.*git pull/);

  const other = assessReadiness({ ...ready, branch: "fix/x" });
  assert.match(other.warnings[0], /on fix\/x, not master/);

  const dirty = assessReadiness({ ...ready, dirty: ["harness/run-phase.mjs"] });
  assert.match(dirty.warnings[0], /uncommitted changes.*harness\/run-phase\.mjs/);
});

test("a fetch that failed is not reported as up to date or as behind", () => {
  const { warnings } = assessReadiness({ ...ready, behind: null });
  assert.match(warnings[0], /could not compare with origin\/master/);
});
