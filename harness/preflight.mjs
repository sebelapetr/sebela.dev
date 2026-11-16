// Before each iteration of the phase loop: gathers whether this machine can run one — Docker, the
// shared Postgres, gh, the main checkout — and lets lib/preflight.mjs judge it.

import { assessReadiness } from "./lib/preflight.mjs";
import { quiet } from "./run-tools.mjs";
import { postgresHealth } from "./steward.mjs";

export function checkReadiness({ mainRoot, base }) {
  const docker = quiet("docker", ["info", "--format", "{{.ServerVersion}}"]) !== null;
  const git = (...args) => quiet("git", args, { cwd: mainRoot });
  const fetched = git("fetch", "--quiet", "origin", base) !== null;
  const behind = fetched ? git("rev-list", "--count", `HEAD..origin/${base}`) : null;
  return assessReadiness({
    docker,
    postgres: docker ? postgresHealth(mainRoot) : "unknown",
    gh: quiet("gh", ["auth", "status"]) !== null,
    branch: (git("rev-parse", "--abbrev-ref", "HEAD") ?? "").trim(),
    base,
    behind: behind === null ? null : Number(behind.trim()),
    dirty: (git("status", "--porcelain", "--untracked-files=no") ?? "")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3)),
  });
}
