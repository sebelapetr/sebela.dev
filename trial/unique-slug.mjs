import { toSlug } from "./to-slug.mjs";

/**
 * Returns the slug of `text` if it is free, otherwise the slug with the
 * lowest numeric suffix (`-2`, `-3`, ...) that is not in `taken`.
 *
 * @param {string} text
 * @param {Iterable<string>} taken an array or a Set of slugs already in use
 * @returns {string}
 */
export function uniqueSlug(text, taken) {
  const used = taken instanceof Set ? taken : new Set(taken);
  const base = toSlug(text);
  if (!used.has(base)) {
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) {
    n += 1;
  }
  return `${base}-${n}`;
}
