/**
 * A calendar date (`YYYY-MM-DD`, as the API stores it) in words: the month, an ordinal day and the
 * year, for example `October 1st, 2023`. Read as a calendar date, never shifted by a time zone.
 */
export function formatDate(isoDate: string): string {
  throw new Error(`not implemented: ${isoDate}`);
}

/**
 * The period of an experience: both dates with an en dash between them, `present` for one that is
 * ongoing (`endedOn` is null), and a single date when it started and ended on the same day.
 */
export function formatPeriod(startedOn: string, endedOn: string | null): string {
  throw new Error(`not implemented: ${startedOn} ${String(endedOn)}`);
}
