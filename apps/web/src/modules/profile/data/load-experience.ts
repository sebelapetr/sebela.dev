import type { ApiClient, Experience, Person } from "@sebela/api-client";

import { readImage, type ImageMedia } from "./image";

/** The content of the experience page, all of it from the API. */
export interface ExperienceContent {
  readonly name: string;
  readonly headline: string;
  /** The date the career started, `YYYY-MM-DD`; null when the profile has none. */
  readonly careerStartedOn: string | null;
  /** The published experiences in the API's order: current first, then the latest start. */
  readonly experiences: readonly Experience[];
  /**
   * The organizations' logos that can be shown, by media id (`organization.logoId`). A logo that
   * is absent, unusable or could not be read is simply not here.
   */
  readonly logos: ReadonlyMap<string, ImageMedia>;
  /**
   * The testimonial authors' photos that can be shown, by media id (`testimonial.authorPhotoId`).
   * A photo that is absent, unusable or could not be read is simply not here.
   */
  readonly authorPhotos: ReadonlyMap<string, ImageMedia>;
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

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Reads the experience page's content from the API's public routes: the person and the
 * experiences, then each organization's logo once, uncached and limited in time. A person that
 * does not exist makes the page missing; a failed read of the person or the experiences makes the
 * whole content unavailable, while a logo that cannot be read or shown is only left out.
 */
export async function loadExperience(
  client: ApiClient,
  options: LoadExperienceOptions = {},
): Promise<ExperienceResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const init = () => ({ cache: "no-store" as const, signal: AbortSignal.timeout(timeoutMs) });

  let person: Person;
  let experiences: readonly Experience[];
  try {
    const [personRead, experiencesRead] = await Promise.all([
      client.GET("/v1/person", init()),
      client.GET("/v1/experiences", init()),
    ]);
    if (personRead.data === undefined) {
      return personRead.response.status === 404 ? { status: "missing" } : { status: "unavailable" };
    }
    if (experiencesRead.data === undefined) return { status: "unavailable" };
    person = personRead.data;
    experiences = experiencesRead.data;
  } catch {
    return { status: "unavailable" };
  }

  const logoIds = [
    ...new Set(
      experiences.flatMap(({ organization }) =>
        organization.logoId === null ? [] : [organization.logoId],
      ),
    ),
  ];
  const images = await Promise.all(logoIds.map((id) => readImage(client, id, init())));
  const logos = new Map<string, ImageMedia>();
  logoIds.forEach((id, index) => {
    const image = images[index];
    if (image) logos.set(id, image);
  });

  return {
    status: "ready",
    content: {
      name: person.name,
      headline: person.headline,
      careerStartedOn: person.careerStartedOn,
      experiences,
      logos,
      authorPhotos: new Map(),
    },
  };
}
