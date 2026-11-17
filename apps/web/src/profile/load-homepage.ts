import type { ApiClient } from "@sebela/api-client";

/** The person's photo, ready for an image element. */
export interface HomepagePhoto {
  readonly url: string;
  /** The media's alternative text; empty when the media has none. */
  readonly altText: string;
  readonly width: number;
  readonly height: number;
}

/** The content of the homepage, all of it from the API. */
export interface HomepageProfile {
  readonly name: string;
  readonly headline: string;
  /** Markdown. */
  readonly shortBio: string;
  readonly photo: HomepagePhoto | null;
  readonly contact: {
    readonly email: { readonly address: string; readonly href: string } | null;
    /** The person's web links, in their order. */
    readonly links: readonly { readonly label: string; readonly url: string }[];
  };
}

export type HomepageResult =
  | { readonly status: "ready"; readonly profile: HomepageProfile }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadHomepageOptions {
  /** How long each request may take. */
  readonly timeoutMs?: number;
}

/** Reads the homepage's content from the API's public routes. */
export function loadHomepage(
  client: ApiClient,
  options: LoadHomepageOptions = {},
): Promise<HomepageResult> {
  return Promise.reject(new Error("not implemented", { cause: [client, options] }));
}
