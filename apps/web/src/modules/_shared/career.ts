// The length of the person's career, the same on every page that states it: the years count
// software development overall, never one technology or the AI work (.plan/done/03-web/prd.md).

/**
 * Whole years since the career started, or null without a start date or before the first full
 * year.
 */
export function careerYears(careerStartedOn: string | null, today: Date): number | null {
  if (careerStartedOn === null) return null;
  const [year = 0, month = 1, day = 1] = careerStartedOn.split("-").map(Number);
  const beforeAnniversary =
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  const years = today.getUTCFullYear() - year - (beforeAnniversary ? 1 : 0);
  return years >= 1 ? years : null;
}
