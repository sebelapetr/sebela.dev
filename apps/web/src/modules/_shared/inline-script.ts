// Values placed into an inline `<script>`. Private to the shared module: the theme's pre-paint
// script uses it, nothing outside imports it.

/** A JavaScript string literal of `value` for an inline script. */
export function scriptStringLiteral(value: string): string {
  return JSON.stringify(value);
}
