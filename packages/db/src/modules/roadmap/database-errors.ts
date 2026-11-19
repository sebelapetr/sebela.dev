// Recognising PostgreSQL refusals, private to the roadmap module.

/** The driver error behind a failed Drizzle query, which wraps it as `cause`. */
function driverError(error: unknown): { code?: unknown; constraint?: unknown } | undefined {
  const cause = error instanceof Error ? error.cause : undefined;
  return typeof cause === "object" && cause !== null ? cause : undefined;
}

/** Whether the database refused a delete because a foreign key still refers to the row. */
export function isStillReferenced(error: unknown): boolean {
  return driverError(error)?.code === "23503";
}

/** Whether the database refused a row because it breaks the named check constraint. */
export function breaksCheck(error: unknown, constraint: string): boolean {
  const cause = driverError(error);
  return cause?.code === "23514" && cause.constraint === constraint;
}

/** Whether the database refused a row because it conflicts under the named exclusion constraint. */
export function breaksExclusion(error: unknown, constraint: string): boolean {
  const cause = driverError(error);
  return cause?.code === "23P01" && cause.constraint === constraint;
}

/** Whether the database refused a row because it repeats a value under the named unique constraint. */
export function breaksUnique(error: unknown, constraint: string): boolean {
  const cause = driverError(error);
  return cause?.code === "23505" && cause.constraint === constraint;
}
