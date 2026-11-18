const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * A calendar date (`YYYY-MM-DD`, as the API stores it) in words: the month, an ordinal day and the
 * year, for example `October 1st, 2023`. Read as a calendar date, never shifted by a time zone.
 */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const monthName = MONTHS[(month ?? 0) - 1];
  if (year === undefined || monthName === undefined || day === undefined || Number.isNaN(day)) {
    throw new RangeError("Not a calendar date (YYYY-MM-DD).");
  }
  return `${monthName} ${ordinal(day)}, ${String(year)}`;
}

/**
 * The period of an experience: both dates with an en dash between them, `present` for one that is
 * ongoing (`endedOn` is null), and a single date when it started and ended on the same day.
 */
export function formatPeriod(startedOn: string, endedOn: string | null): string {
  if (endedOn === startedOn) return formatDate(startedOn);
  return `${formatDate(startedOn)} – ${endedOn === null ? "present" : formatDate(endedOn)}`;
}

function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
  return `${String(day)}${suffix}`;
}
