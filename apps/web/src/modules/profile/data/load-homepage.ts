import type {
  ApiClient,
  CurrentFocus,
  Experience,
  Exploration,
  Project,
  Service,
  Technology,
} from "@sebela/api-client";

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
  /** The date the career started, `YYYY-MM-DD`; null when the profile has none. */
  readonly careerStartedOn: string | null;
  /** The published experiences in the API's order: current first, then the latest start. */
  readonly experiences: readonly Experience[];
  /**
   * Every published project in the API's order (by experience, then position), taken from the
   * experiences; the homepage shows the selected ones.
   */
  readonly projects: readonly Project[];
  /** The technologies in the API's order: by tier, group, position, then slug. */
  readonly technologies: readonly Technology[];
  /** What is being worked on now, in the API's order: by position, then slug. */
  readonly currentFocus: readonly CurrentFocus[];
  /** The explorations (independent R&D) in the API's order: by position, then slug. */
  readonly explorations: readonly Exploration[];
  /** The services in the API's order: by position, then slug. */
  readonly services: readonly Service[];
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
 * Reads the homepage's content from the API's public routes: the person, the experiences (with
 * their projects), the technologies, the current focus, the explorations, the services and, if the
 * person has them, its photo and its CV PDF. Every request is uncached and limited in time. A photo
 * or PDF that cannot be shown or offered leaves the profile without one; a person or a list that
 * cannot be read makes the whole content unavailable, so a failed read never looks like a section
 * with nothing to show.
 */
export async function loadHomepage(
  client: ApiClient,
  options: LoadHomepageOptions = {},
): Promise<HomepageResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const init = () => ({ cache: "no-store" as const, signal: AbortSignal.timeout(timeoutMs) });

  try {
    const [personRead, experiences, technologies, currentFocus, explorations, services] =
      await Promise.all([
        client.GET("/v1/person", init()),
        client.GET("/v1/experiences", init()),
        client.GET("/v1/technologies", init()),
        client.GET("/v1/current-focus", init()),
        client.GET("/v1/explorations", init()),
        client.GET("/v1/services", init()),
      ]);
    const person = personRead.data;
    if (person === undefined) {
      return personRead.response.status === 404 ? { status: "missing" } : { status: "unavailable" };
    }
    if (
      experiences.data === undefined ||
      technologies.data === undefined ||
      currentFocus.data === undefined ||
      explorations.data === undefined ||
      services.data === undefined
    ) {
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
        careerStartedOn: person.careerStartedOn,
        experiences: experiences.data,
        projects: experiences.data.flatMap((experience) => experience.projects),
        technologies: technologies.data,
        currentFocus: currentFocus.data,
        explorations: explorations.data,
        services: services.data,
        cvPdf,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
