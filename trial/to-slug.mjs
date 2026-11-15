/**
 * Turns a piece of text into a URL slug: lower case, diacritics removed,
 * every run of characters other than `a-z` and `0-9` replaced by one dash,
 * no leading or trailing dashes.
 *
 * @param {string} text
 * @returns {string}
 */
export function toSlug(text) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
