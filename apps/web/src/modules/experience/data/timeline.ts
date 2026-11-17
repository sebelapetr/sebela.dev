import type { Experience } from "@sebela/api-client";

import { formatPeriod } from "./period";

export type ExperienceKind = Experience["kind"];

const KIND_LABELS: Record<ExperienceKind, string> = {
  main_job: "Main job",
  own_business: "Own business",
  side_project: "Side project",
};

/** One testimonial, shown only beside the experience it belongs to. */
export interface TimelineTestimonial {
  readonly slug: string;
  readonly quote: string;
  readonly authorName: string;
  readonly authorRole: string;
}

/** One experience as the timeline shows it. */
export interface TimelineEntry {
  readonly slug: string;
  /** The stable anchor of the experience on the page, `experience-<slug>`. */
  readonly anchor: string;
  readonly title: string;
  readonly organization: { readonly name: string; readonly website: string | null };
  readonly kind: ExperienceKind;
  /** The small label that tells concurrent experiences apart, for example `Side project`. */
  readonly kindLabel: string;
  /** For example `October 1st, 2023 – July 10th, 2024` or `August 5th, 2022 – present`. */
  readonly period: string;
  /** Whether the experience is ongoing; only these are expanded when the page opens. */
  readonly current: boolean;
  /** Markdown. */
  readonly summary: string;
  readonly responsibilities: readonly string[];
  readonly technologies: readonly { readonly slug: string; readonly name: string }[];
  readonly testimonials: readonly TimelineTestimonial[];
}

/**
 * The timeline's entries from the API's experiences, in the API's order (current first, then the
 * latest start). Every experience stays its own entry with its own kind: nothing is grouped under
 * an employer and nothing is inferred from names.
 */
export function toTimelineEntries(experiences: readonly Experience[]): TimelineEntry[] {
  return experiences.map((experience) => ({
    slug: experience.slug,
    anchor: `experience-${experience.slug}`,
    title: experience.title,
    organization: {
      name: experience.organization.name,
      website: experience.organization.website,
    },
    kind: experience.kind,
    kindLabel: KIND_LABELS[experience.kind],
    period: formatPeriod(experience.startedOn, experience.endedOn),
    current: experience.endedOn === null,
    summary: experience.summary,
    responsibilities: experience.responsibilities,
    technologies: experience.technologies.map(({ slug, name }) => ({ slug, name })),
    testimonials: experience.testimonials
      .filter((testimonial) => testimonial.experience === experience.slug)
      .toSorted((a, b) => a.position - b.position)
      .map(({ slug, quote, authorName, authorRole }) => ({ slug, quote, authorName, authorRole })),
  }));
}

/**
 * Whole years since the career started, or null without a start date or before the first full
 * year.
 */
export function careerYears(careerStartedOn: string | null, today: Date): number | null {
  if (careerStartedOn === null) return null;
  const [year = 0, month = 1, day = 1] = careerStartedOn.split("-").map(Number);
  const beforeAnniversary =
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  const years = today.getUTCFullYear() - year - (beforeAnniversary ? 1 : 0);
  return years >= 1 ? years : null;
}
