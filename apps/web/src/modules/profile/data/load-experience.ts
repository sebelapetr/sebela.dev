import type { ApiClient, Experience } from "@sebela/api-client";

/** The content of the experience page, all of it from the API. */
export interface ExperienceContent {
  readonly name: string;
  readonly headline: string;
  /** The date the career started, `YYYY-MM-DD`; null when the profile has none. */
  readonly careerStartedOn: string | null;
  /** The published experiences in the API's order: current first, then the latest start. */
  readonly experiences: readonly Experience[];
}

/**
 * What the experience page can show: the content (possibly without experiences), a profile that
 * is not published yet, or content that cannot be read now. Never an empty profile.
 */
export type ExperienceResult =
  | { readonly status: "ready"; readonly content: ExperienceContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadExperienceOptions {
  /** How long each request may take; 5 seconds by default. */
  readonly timeoutMs?: number;
}

/**
 * Reads the experience page's content from the API's public routes: the person and the
 * experiences, uncached and limited in time. A person that does not exist makes the page missing;
 * any failed read makes the whole content unavailable.
 */
export function loadExperience(
  client: ApiClient,
  options: LoadExperienceOptions = {},
): Promise<ExperienceResult> {
  return Promise.reject(
    new Error(`not implemented: ${typeof client} ${String(options.timeoutMs)}`),
  );
}
