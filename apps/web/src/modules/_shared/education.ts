import type { Education, EducationKind } from "@sebela/api-client";

import { formatDate, formatPeriod } from "./period";

/** One education record as the education section shows it. */
export interface EducationRow {
  readonly slug: string;
  readonly kind: EducationKind;
  /** The kind as a small label, for example `Certification`. */
  readonly kindLabel: string;
  readonly title: string;
  readonly institution: string | null;
  /** For example `September 1st, 2010 – June 30th, 2014`; null when the record has no date. */
  readonly period: string | null;
  /** Markdown, or null. */
  readonly description: string | null;
}

const KIND_LABELS: Record<EducationKind, string> = {
  school: "School",
  course: "Course",
  certification: "Certification",
  milestone: "Milestone",
};

// A start alone is ongoing learning; an end alone was completed on that day.
function period(startedOn: string | null, endedOn: string | null): string | null {
  if (startedOn !== null) return formatPeriod(startedOn, endedOn);
  return endedOn === null ? null : formatDate(endedOn);
}

/** The education records in the API's order (by position, then slug). */
export function toEducationRows(education: readonly Education[]): EducationRow[] {
  return education.map((record) => ({
    slug: record.slug,
    kind: record.kind,
    kindLabel: KIND_LABELS[record.kind],
    title: record.title,
    institution: record.institution,
    period: period(record.startedOn, record.endedOn),
    description: record.description,
  }));
}
