/** The website's settings, read once from the environment at request time. */
export interface WebConfig {
  /** The API's base address, without a trailing slash. */
  readonly apiBaseUrl: string;
}

/** Reads the website's settings; throws an error naming every invalid variable. */
export function readWebConfig(env: Readonly<Record<string, string | undefined>>): WebConfig {
  throw new Error("not implemented", { cause: env });
}
