// Validation shared by the media and the private storage settings.

/** A Bunny S3 region code, such as `de` or `syd`. */
export const regionPattern = /^[a-z][a-z0-9-]{0,31}$/;

/** A zone password: printable, without whitespace. */
export const passwordPattern = /^[\x21-\x7e]{1,256}$/;

/** The origin of an https address that is nothing but an origin, or `null`. */
export function httpsOrigin(value: string | undefined): string | null {
  if (value === undefined || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.pathname !== "/" || url.search || url.hash || value.includes("?")) return null;
  return url.origin;
}
