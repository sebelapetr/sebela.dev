import type { Experience, Technology } from "@sebela/api-client";

import { careerYears, experienceKindLabel } from "../../_shared";

/** A role held now. */
export interface CurrentRole {
  readonly slug: string;
  readonly title: string;
  readonly organization: string;
  /** For example `Side project`. */
  readonly kind: string;
}

/** The homepage's compact Experience block. */
export interface ExperienceSnapshot {
  /** Whole years of professional software development; null when unknown or under one. */
  readonly years: number | null;
  /** The roles without an end date, in the API's order. */
  readonly current: readonly CurrentRole[];
  /** The core technologies' names, in the API's order. */
  readonly core: readonly string[];
  /** The AI engineering focus technologies' names, in the API's order. */
  readonly aiFocus: readonly string[];
}

export interface ExperienceSnapshotSource {
  readonly careerStartedOn: string | null;
  readonly experiences: readonly Experience[];
  readonly technologies: readonly Technology[];
}

/**
 * The homepage's compact Experience block: the career's whole years (software development overall),
 * the roles held now, and the primary technologies as two lines — core and AI engineering focus.
 * Secondary technologies stay on the experience page.
 */
export function toExperienceSnapshot(
  source: ExperienceSnapshotSource,
  today: Date,
): ExperienceSnapshot {
  const primary = source.technologies.filter((technology) => technology.tier === "primary");
  return {
    years: careerYears(source.careerStartedOn, today),
    current: source.experiences
      .filter((experience) => experience.endedOn === null)
      .map((experience) => ({
        slug: experience.slug,
        title: experience.title,
        organization: experience.organization.name,
        kind: experienceKindLabel(experience.kind),
      })),
    core: primary
      .filter((technology) => technology.group === "core")
      .map((technology) => technology.name),
    aiFocus: primary
      .filter((technology) => technology.group === "ai_engineering_focus")
      .map((technology) => technology.name),
  };
}
