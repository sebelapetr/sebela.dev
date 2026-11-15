/**
 * Formats a number of minutes for people: `"45 min"`, `"1 h 30 min"`, `"2 h"`.
 * Durations of a day or more stay in hours (`"25 h"`).
 *
 * @param {number} minutes a non-negative integer
 * @returns {string}
 * @throws {RangeError} when `minutes` is not a non-negative integer
 */
export function formatDuration(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new RangeError("minutes must be a non-negative integer");
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest} min`;
  }
  if (rest === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${rest} min`;
}
