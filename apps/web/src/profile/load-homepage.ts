import type { ApiClient, Media, Person } from "@sebela/api-client";

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

/**
 * What the homepage can show: the content, a profile that is not published yet, or content that
 * cannot be read now (the API failed, was unreachable or too slow). Never an empty profile.
 */
export type HomepageResult =
  | { readonly status: "ready"; readonly profile: HomepageProfile }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadHomepageOptions {
  /** How long each request may take; 5 seconds by default. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Reads the homepage's content from the API's public routes: the person and, if it has one, its
 * photo. Every request is uncached and limited in time. A photo that cannot be shown leaves the
 * profile without one; a person that cannot be read makes the whole content unavailable.
 */
export async function loadHomepage(
  client: ApiClient,
  options: LoadHomepageOptions = {},
): Promise<HomepageResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const init = () => ({ cache: "no-store" as const, signal: AbortSignal.timeout(timeoutMs) });

  let person: Person;
  try {
    const { data, response } = await client.GET("/v1/person", init());
    if (data === undefined) {
      return response.status === 404 ? { status: "missing" } : { status: "unavailable" };
    }
    person = data;
  } catch {
    return { status: "unavailable" };
  }

  const photo = person.photoId === null ? null : await readPhoto(client, person.photoId, init());
  return {
    status: "ready",
    profile: {
      name: person.name,
      headline: person.headline,
      shortBio: person.shortBio,
      photo,
      contact: {
        email:
          person.email === null
            ? null
            : { address: person.email, href: `mailto:${encodeEmail(person.email)}` },
        links: person.links.filter((link) => isWebUrl(link.url)),
      },
    },
  };
}

async function readPhoto(
  client: ApiClient,
  id: string,
  init: { readonly cache: "no-store"; readonly signal: AbortSignal },
): Promise<HomepagePhoto | null> {
  try {
    const { data } = await client.GET("/v1/media/{id}", { params: { path: { id } }, ...init });
    return data === undefined ? null : toPhoto(data);
  } catch {
    return null;
  }
}

function toPhoto(media: Media): HomepagePhoto | null {
  if (!media.mediaType.startsWith("image/")) return null;
  if (media.url === null || !isWebUrl(media.url)) return null;
  if (media.width === null || media.height === null) return null;
  return {
    url: media.url,
    altText: media.altText ?? "",
    width: media.width,
    height: media.height,
  };
}

/** Encodes the local part of an address for a mailto link; `@` and the domain stay readable. */
function encodeEmail(address: string): string {
  const at = address.lastIndexOf("@");
  return `${encodeURIComponent(address.slice(0, at))}@${address.slice(at + 1)}`;
}

function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
