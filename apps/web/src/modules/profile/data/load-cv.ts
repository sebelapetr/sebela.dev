import type { ApiClient, Cv } from "@sebela/api-client";

import { toContact, type Contact } from "./contact";
import { toCvPdf, type CvPdf } from "./cv-pdf";

/**
 * The content of the CV page: the API's assembled CV, unchanged in its selection and order, with
 * the person's header facts and contacts ready for links and the PDF's upload day.
 */
export interface CvContent {
  readonly name: string;
  readonly headline: string;
  readonly location: string | null;
  /** Markdown. */
  readonly shortBio: string;
  readonly contact: Contact;
  /** The experiences the API selected for the CV, in its order: current first, then the latest start. */
  readonly experiences: Cv["experiences"];
  /** The technologies in their tiers and groups, each in catalog order. */
  readonly technologies: Cv["technologies"];
  /** The education records by position, then slug. */
  readonly education: Cv["education"];
  /** The explorations (independent R&D) with their stored status, by position, then slug. */
  readonly explorations: Cv["explorations"];
  /** The current, manually uploaded PDF; null without one or when it cannot be offered. */
  readonly cvPdf: CvPdf | null;
}

/**
 * What the CV page can show: the content, a profile that is not published yet, or content that
 * cannot be read now. Never an empty CV.
 */
export type CvResult =
  | { readonly status: "ready"; readonly content: CvContent }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface LoadCvOptions {
  /** How long the request may take; 5 seconds by default. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Reads the CV from the API's public CV route, uncached and limited in time. The API assembles
 * the CV (which experiences it holds, in what order); nothing here selects or reorders it. A
 * person that does not exist makes the page missing; any other failed read makes it unavailable.
 */
export async function loadCv(client: ApiClient, options: LoadCvOptions = {}): Promise<CvResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let cv: Cv;
  try {
    const { data, response } = await client.GET("/v1/cv", {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (data === undefined) {
      return response.status === 404 ? { status: "missing" } : { status: "unavailable" };
    }
    cv = data;
  } catch {
    return { status: "unavailable" };
  }

  const { person } = cv;
  return {
    status: "ready",
    content: {
      name: person.name,
      headline: person.headline,
      location: person.location,
      shortBio: person.shortBio,
      contact: toContact(person),
      experiences: cv.experiences,
      technologies: cv.technologies,
      education: cv.education,
      explorations: cv.explorations,
      cvPdf: toCvPdf(cv.cvPdf),
    },
  };
}
