// The server's checkout that the tests of infra/scripts/deploy.sh run the real script from
// (deploy.test.mjs, deploy.e2e.mjs): a temporary Git repository with a bare `origin` of its own,
// so the script's `git fetch` reaches nothing but that folder. `master` on origin holds two
// commits, `old` and `release`; a branch `side` holds a commit that is not on master. The checkout
// is a clone left at `old`, as a server checkout is before a deployment brings it to the release.
//
// Every commit carries the real deploy.sh with one line added after its first: it appends the
// commit's label (`old`, `release`, `side`) to the file named by DEPLOY_TEST_STARTS, so a test sees
// which version of the script ran and how often. Each commit's compose.yaml and
// infra/production/compose.yaml begin with a comment naming the commit, so the fake docker can
// tell which files Compose was given.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const REAL_SCRIPT = path.join(ROOT, "infra", "scripts", "deploy.sh");

/** Git without the user's or the system's configuration, with a fictional author. */
export const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Fictional Author",
  GIT_AUTHOR_EMAIL: "author@example.invalid",
  GIT_COMMITTER_NAME: "Fictional Author",
  GIT_COMMITTER_EMAIL: "author@example.invalid",
};

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    env: { ...process.env, ...GIT_ENV },
    encoding: "utf8",
  }).trim();
}

/** The real deploy.sh with a line after the shebang that records `label` as one start. */
function labelledScript(label, scriptFile = REAL_SCRIPT) {
  const [shebang, ...rest] = fs.readFileSync(scriptFile, "utf8").split("\n");
  const marker = `printf '%s\\n' ${label} >>"\${DEPLOY_TEST_STARTS:-/dev/null}"`;
  return [shebang, marker, ...rest].join("\n");
}

function writeCommit(work, label, scriptFile) {
  const scripts = path.join(work, "infra", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(work, "infra", "production"), { recursive: true });
  fs.writeFileSync(path.join(scripts, "deploy.sh"), labelledScript(label, scriptFile), {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(work, "compose.yaml"), `# ${label}\nservices: {}\n`);
  fs.writeFileSync(path.join(work, "infra", "production", "compose.yaml"), `# ${label}\n`);
  git(work, ["add", "--all"]);
  git(work, ["commit", "--quiet", "--message", label]);
  return git(work, ["rev-parse", "HEAD"]);
}

/**
 * Creates the origin and the checkout in `dir`. Returns the checkout's folder, its deploy.sh, the
 * commits by label and `head()`, the commit the checkout is at.
 */
export function createCheckout(dir, { oldScript } = {}) {
  const work = path.join(dir, "source");
  const origin = path.join(dir, "origin.git");
  const checkout = path.join(dir, "checkout");
  fs.mkdirSync(work);
  git(work, ["init", "--quiet", "--initial-branch=master"]);
  const old = writeCommit(work, "old", oldScript);
  const release = writeCommit(work, "release");
  git(work, ["switch", "--quiet", "--create", "side"]);
  const side = writeCommit(work, "side");
  git(dir, ["clone", "--quiet", "--bare", work, origin]);
  git(dir, ["clone", "--quiet", "--branch", "master", origin, checkout]);
  git(checkout, ["reset", "--quiet", "--hard", old]);
  fs.rmSync(work, { recursive: true, force: true });
  return {
    checkout,
    script: path.join(checkout, "infra", "scripts", "deploy.sh"),
    commits: { old, release, side },
    head: () => git(checkout, ["rev-parse", "HEAD"]),
    status: () => git(checkout, ["status", "--porcelain"]),
  };
}
