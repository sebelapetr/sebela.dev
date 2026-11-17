import type { Project } from "@sebela/api-client";

/** One project of the homepage's Selected work: a teaser of its case study. */
export interface SelectedWorkItem {
  readonly slug: string;
  /** The row's number, two digits: `01`, `02`, … */
  readonly number: string;
  readonly name: string;
  /** For example `May 2nd, 2022 – present`. */
  readonly period: string;
  readonly technologies: readonly { readonly slug: string; readonly name: string }[];
  /** Markdown. */
  readonly problem: string;
  /** The person's own role from the case study; null without a case study, never invented. */
  readonly role: string | null;
  /** Markdown: the project's outcome. */
  readonly result: string;
  /** The exact item on the experience page: the case study when there is one, else the project. */
  readonly href: string;
}

/**
 * The projects selected for the homepage, in the API's order (by experience, then position), as
 * numbered teasers. Projects that are not selected are left out; without any, the list is empty.
 */
export function toSelectedWork(_projects: readonly Project[]): SelectedWorkItem[] {
  throw new Error(`not implemented: ${JSON.stringify([_projects])}`);
}
