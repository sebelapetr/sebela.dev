import type { Experience, Project } from "@sebela/api-client";

import type { ImageMedia } from "../../profile";

import { anchorId, formatPeriod } from "../../_shared";

export type ExperienceKind = Experience["kind"];

const KIND_LABELS: Record<ExperienceKind, string> = {
  main_job: "Full-time job",
  own_business: "Own business",
  side_project: "Side project",
};

/** One testimonial, shown only beside the experience it belongs to. */
export interface TimelineTestimonial {
  readonly slug: string;
  readonly quote: string;
  readonly authorName: string;
  readonly authorRole: string;
  /** The author's photo; null without one or when it cannot be shown. */
  readonly authorPhoto: ImageMedia | null;
}

/** A project's case study: the person's own role and the long-form account. */
export interface TimelineCaseStudy {
  /** The stable anchor of the case study, `case-study-<project slug>`. */
  readonly anchor: string;
  /** Plain text: the person's own contribution, for example `Lead engineer`. */
  readonly role: string;
  /** Markdown: the long-form account. */
  readonly body: string;
}

/** One project inside its experience. */
export interface TimelineProject {
  readonly slug: string;
  /** The stable anchor of the project, `project-<slug>`. */
  readonly anchor: string;
  readonly name: string;
  /** For example `March 1st, 2022 – present`. */
  readonly period: string;
  /** Markdown: the context, what the project is. */
  readonly summary: string;
  /** Markdown: the problem the project solved. */
  readonly problem: string;
  /** Markdown: the work done, the solution. */
  readonly workDone: string;
  /** Markdown: the project's outcome, which may be the team's rather than the person's own. */
  readonly result: string;
  readonly technologies: readonly { readonly slug: string; readonly name: string }[];
  /** Null when the project has none: nothing is shown in its place. */
  readonly caseStudy: TimelineCaseStudy | null;
}

/** One experience as the timeline shows it. */
export interface TimelineEntry {
  readonly slug: string;
  /** The stable anchor of the experience on the page, `experience-<slug>`. */
  readonly anchor: string;
  readonly title: string;
  readonly organization: {
    readonly name: string;
    readonly website: string | null;
    /** The organization's logo; null without one or when it cannot be shown. */
    readonly logo: ImageMedia | null;
  };
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
  /** The projects delivered within this experience, by their position, then slug. */
  readonly projects: readonly TimelineProject[];
  readonly testimonials: readonly TimelineTestimonial[];
}

/**
 * The timeline's entries from the API's experiences, in the API's order (current first, then the
 * latest start). Every experience stays its own entry with its own kind: nothing is grouped under
 * an employer and nothing is inferred from names. `logos` holds the logos that can be shown, by
 * media id; an organization whose logo is not there has none. `authorPhotos` holds the testimonial
 * authors' photos the same way; a testimonial whose photo is not there has none.
 */
export function toTimelineEntries(
  experiences: readonly Experience[],
  logos: ReadonlyMap<string, ImageMedia> = new Map(),
  authorPhotos: ReadonlyMap<string, ImageMedia> = new Map(),
): TimelineEntry[] {
  return experiences.map((experience) => ({
    slug: experience.slug,
    anchor: anchorId({ kind: "experience", slug: experience.slug }),
    title: experience.title,
    organization: {
      name: experience.organization.name,
      website: experience.organization.website,
      logo:
        experience.organization.logoId === null
          ? null
          : (logos.get(experience.organization.logoId) ?? null),
    },
    kind: experience.kind,
    kindLabel: KIND_LABELS[experience.kind],
    period: formatPeriod(experience.startedOn, experience.endedOn),
    current: experience.endedOn === null,
    summary: experience.summary,
    responsibilities: experience.responsibilities,
    technologies: experience.technologies.map(({ slug, name }) => ({ slug, name })),
    projects: experience.projects
      .filter((project) => project.experience === experience.slug)
      .toSorted((a, b) => a.position - b.position || compareText(a.slug, b.slug))
      .map(toTimelineProject),
    testimonials: experience.testimonials
      .filter((testimonial) => testimonial.experience === experience.slug)
      .toSorted((a, b) => a.position - b.position)
      .map(({ slug, quote, authorName, authorRole, authorPhotoId }) => ({
        slug,
        quote,
        authorName,
        authorRole,
        authorPhoto: authorPhotoId === null ? null : (authorPhotos.get(authorPhotoId) ?? null),
      })),
  }));
}

function toTimelineProject(project: Project): TimelineProject {
  return {
    slug: project.slug,
    anchor: anchorId({ kind: "project", slug: project.slug }),
    name: project.name,
    period: formatPeriod(project.startedOn, project.endedOn),
    summary: project.summary,
    problem: project.problem,
    workDone: project.workDone,
    result: project.result,
    technologies: project.technologies.map(({ slug, name }) => ({ slug, name })),
    caseStudy:
      project.caseStudy === null
        ? null
        : {
            anchor: anchorId({ kind: "case-study", project: project.slug }),
            role: project.caseStudy.role,
            body: project.caseStudy.body,
          },
  };
}

/** Code-point order, the same in every locale, so the server and the browser agree. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
