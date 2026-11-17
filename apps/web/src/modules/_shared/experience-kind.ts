// An experience's kind in words, the same on every page that shows one: the small label that tells
// concurrent experiences apart.
import type { Experience } from "@sebela/api-client";

const KIND_LABELS: Record<Experience["kind"], string> = {
  main_job: "Full-time job",
  own_business: "Own business",
  side_project: "Side project",
};

/** The kind as a small label, for example `Side project`. */
export function experienceKindLabel(kind: Experience["kind"]): string {
  return KIND_LABELS[kind];
}
