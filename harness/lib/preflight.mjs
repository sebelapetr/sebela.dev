// What must hold on the owner's machine before the phase loop starts an iteration. Pure — the
// caller gathers the facts (harness/preflight.mjs). Blocking: without it every agent would fail or
// improvise; warnings: the owner may mean it. Intent: docs/agents.md, "The phase loop".

const START_POSTGRES =
  "start Postgres in the main checkout with `docker compose up --detach --wait`";

// facts: { docker, postgres, gh, branch, base, behind, dirty }
//   behind  commits the main checkout lacks from origin/<base>, null when the fetch failed
export function assessReadiness(facts) {
  const blocking = [];
  const warnings = [];

  if (!facts.docker) {
    blocking.push(`Docker is not running; start Docker Desktop, then ${START_POSTGRES}`);
  } else if (facts.postgres !== "healthy") {
    blocking.push(`Postgres is ${facts.postgres}; ${START_POSTGRES}`);
  }
  if (!facts.gh) blocking.push("gh is not signed in to GitHub; run `gh auth login`");

  if (facts.branch !== facts.base) {
    warnings.push(
      `the main checkout is on ${facts.branch}, not ${facts.base}; the loop runs the harness from it`,
    );
  }
  if (facts.behind === null) {
    warnings.push(`could not compare with origin/${facts.base}; is the network up?`);
  } else if (facts.behind > 0) {
    warnings.push(
      `the main checkout is ${facts.behind} commits behind origin/${facts.base}; run \`git pull\``,
    );
  }
  if (facts.dirty.length > 0) {
    warnings.push(
      `the main checkout has uncommitted changes: ${facts.dirty.slice(0, 5).join(", ")}`,
    );
  }
  return { blocking, warnings };
}
