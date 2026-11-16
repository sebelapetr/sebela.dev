import type { Persistence } from "@sebela/db";

import type { CleanupFailure, MediaLimits } from "../media/index.js";
import type { ProfileServiceOptions } from "../profile/index.js";
import type { OpenedStorage } from "../storage/index.js";

/** The kinds of record a seed folder holds, each in its own data file. */
export type SeedKind =
  | "person"
  | "technologies"
  | "topics"
  | "organizations"
  | "experiences"
  | "projects"
  | "caseStudies"
  | "explorations"
  | "services"
  | "education"
  | "testimonials"
  | "currentFocus";

/** How many records of one kind a load created and how many existing ones it updated. */
export interface SeedCount {
  readonly created: number;
  readonly updated: number;
}

/** What one load did; counts only, never content. */
export interface SeedReport {
  readonly records: Readonly<Record<SeedKind, SeedCount>>;
  readonly media: {
    /** Files stored and recorded by this load. */
    readonly uploaded: number;
    /** Declared files whose identical content was already recorded and reused. */
    readonly reused: number;
    /** Media a seed record no longer refers to and nothing else uses, deleted after the load. */
    readonly removed: number;
  };
}

export interface SeedService {
  loadSeed(folder: string | URL): Promise<SeedReport>;
}

export interface SeedServiceOptions {
  readonly storage: OpenedStorage;
  readonly limits: MediaLimits;
  onCleanupFailure(failure: CleanupFailure): void;
  readonly mediaAddress?: ProfileServiceOptions["mediaAddress"];
}

export function createSeedService(
  persistence: Pick<Persistence, "profile" | "transaction">,
  options: SeedServiceOptions,
): SeedService {
  return {
    loadSeed: (folder) =>
      Promise.reject(
        new Error(
          `Loading ${String(folder)} with ${String(options.limits.maxBytes)} into ${typeof persistence} is not implemented yet.`,
        ),
      ),
  };
}
