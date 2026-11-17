import type { Project } from "@sebela/api-client";

import { anchorHref, formatPeriod } from "../../_shared";

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
export function toSelectedWork(projects: readonly Project[]): SelectedWorkItem[] {
  return projects
    .filter((project) => project.selectedForHomepage)
    .map((project, position) => ({
      slug: project.slug,
      number: String(position + 1).padStart(2, "0"),
      name: project.name,
      period: formatPeriod(project.startedOn, project.endedOn),
      technologies: project.technologies.map(({ slug, name }) => ({ slug, name })),
      problem: project.problem,
      role: project.caseStudy?.role ?? null,
      result: project.result,
      href:
        project.caseStudy === null
          ? anchorHref({ kind: "project", slug: project.slug })
          : anchorHref({ kind: "case-study", project: project.slug }),
    }));
}
