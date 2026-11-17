import type { Experience } from "@sebela/api-client";

export type ExperienceKind = Experience["kind"];

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
  throw new Error(`not implemented: ${String(experiences.length)}`);
}

/**
 * Whole years since the career started, or null without a start date or before the first full
 * year.
 */
export function careerYears(careerStartedOn: string | null, today: Date): number | null {
  throw new Error(`not implemented: ${String(careerStartedOn)} ${today.toISOString()}`);
}
