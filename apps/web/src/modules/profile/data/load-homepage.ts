import type { ApiClient, Person, Project } from "@sebela/api-client";

import { toContact, type Contact } from "./contact";
import { readCvPdf, type CvPdf } from "./cv-pdf";
import { readImage, type ImageMedia } from "./image";

/** The person's photo, ready for an image element. */
export type HomepagePhoto = ImageMedia;

/** The content of the homepage, all of it from the API. */
export interface HomepageProfile {
  readonly name: string;
  readonly headline: string;
  /** Markdown. */
  readonly shortBio: string;
  readonly photo: HomepagePhoto | null;
  readonly contact: Contact;
  /** Every published project in the API's order; the homepage shows the selected ones. */
  readonly projects: readonly Project[];
  /** The current CV PDF; null without one or when it cannot be offered. */
  readonly cvPdf: CvPdf | null;
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
 * Reads the homepage's content from the API's public routes: the person, the projects and, if the
 * person has them, its photo and its CV PDF. Every request is uncached and limited in time. A photo
 * or PDF that cannot be shown or offered leaves the profile without one; a person or projects that cannot be read make the whole
 * content unavailable, so a failed read never looks like having no selected work.
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

  let projects: readonly Project[];
  try {
    const { data } = await client.GET("/v1/projects", init());
    if (data === undefined) return { status: "unavailable" };
    projects = data;
  } catch {
    return { status: "unavailable" };
  }

  const [photo, cvPdf] = await Promise.all([
    person.photoId === null ? null : readImage(client, person.photoId, init()),
    person.cvPdfId === null ? null : readCvPdf(client, person.cvPdfId, init()),
  ]);
  return {
    status: "ready",
    profile: {
      name: person.name,
      headline: person.headline,
      shortBio: person.shortBio,
      photo,
      contact: toContact(person),
      projects,
      cvPdf,
    },
  };
}
