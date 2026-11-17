import type { Experience, Technology } from "@sebela/api-client";

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

export function toExperienceSnapshot(
  source: ExperienceSnapshotSource,
  today: Date,
): ExperienceSnapshot {
  throw new Error(`not implemented: ${String(source.experiences.length)} ${today.toISOString()}`);
}
