// Values placed into an inline `<script>`. Private to the shared module: the theme's pre-paint
// script uses it, nothing outside imports it.

/**
 * What JSON leaves raw but an inline script must not contain: `<`, `>` and `/` (so no value can
 * write `</script>` or `<!--`), and the line and paragraph separators. JSON already escapes the
 * quote, the backslash and the control characters; escaping its backslashes again would change
 * the value.
 */
const unsafe = /[<>/\u2028\u2029]/g;

function unicodeEscape(character: string): string {
  return `\\u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * A JavaScript string literal of `value` for an inline script: it evaluates to `value` and
 * cannot end the script element or open an HTML comment.
 */
export function scriptStringLiteral(value: string): string {
  return JSON.stringify(value).replace(unsafe, unicodeEscape);
}
