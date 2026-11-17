import type { Education, EducationKind } from "@sebela/api-client";

export interface EducationRow {
  readonly slug: string;
  readonly kind: EducationKind;
  readonly kindLabel: string;
  readonly title: string;
  readonly institution: string | null;
  readonly period: string | null;
  readonly description: string | null;
}

export function toEducationRows(education: readonly Education[]): EducationRow[] {
  throw new Error(`not implemented (${String(education.length)})`);
}
