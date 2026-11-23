// Whether a pull request can change the Python agent's behaviour, and so runs its paid model
// evals. Not implemented yet: it prints no decision.

/** The documented operations the agent's sources call. */
export function operationsCalledBy() {
  return { called: [], unmatched: [] };
}
