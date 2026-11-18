// What the mock's answers may rest on: the public profile read for the Ask page, reduced on the
// server to plain, serializable records the browser can hold. Every fact an answer shows comes
// from here, so the answers never claim anything the profile does not hold.
import type { ExplorationStatus } from "@sebela/api-client";

import type { AskContent } from "../../profile";
import {
  plainText,
  TECHNOLOGY_GROUP_KEYS,
  technologyGroupOf,
  type TechnologyGroupKey,
} from "../../_shared";

export interface EvidenceExperience {
  readonly slug: string;
  readonly title: string;
  readonly organization: string;
  readonly startedOn: string;
  readonly endedOn: string | null;
  /** The summary's first paragraph as plain text; null without one. */
  readonly summary: string | null;
  /** The technologies' names, in the API's order. */
  readonly technologies: readonly string[];
  /** The projects in the API's order, and whether each has a technical case study. */
  readonly projects: readonly {
    readonly slug: string;
    readonly name: string;
    readonly caseStudy: boolean;
  }[];
}

/** The public records the mock's answers may rest on, as plain data. */
export interface AskEvidence {
  readonly name: string;
  readonly contact: {
    readonly email: string | null;
    readonly links: readonly { readonly label: string; readonly url: string }[];
  };
  readonly experiences: readonly EvidenceExperience[];
  readonly services: readonly {
    readonly slug: string;
    readonly name: string;
    readonly summary: string;
  }[];
  readonly explorations: readonly {
    readonly slug: string;
    readonly name: string;
    readonly summary: string | null;
    readonly status: ExplorationStatus;
  }[];
  /** The technology groups the experience page shows, in its order. */
  readonly technologyGroups: readonly TechnologyGroupKey[];
  /** The AI Roadmap's modules in progress, with their area, in the API's order. */
  readonly learning: readonly EvidenceLearning[];
}

/** A module in progress on the AI Roadmap, as an answer may name it. */
export interface EvidenceLearning {
  /** The area's slug. */
  readonly area: string;
  readonly areaName: string;
  readonly slug: string;
  readonly name: string;
  /** The description's first paragraph as plain text; null without one. */
  readonly summary: string | null;
  /** The API's completed and all resources of the module. */
  readonly completed: number;
  readonly total: number;
}

function summaryOf(markdown: string | null): string | null {
  const text = markdown === null ? "" : plainText(markdown);
  return text === "" ? null : text;
}

/** The Ask page's content reduced to the evidence its answers may rest on. */
export function toAskEvidence(content: AskContent): AskEvidence {
  const shown = new Set(content.technologies.map(technologyGroupOf));
  return {
    name: content.name,
    contact: {
      email: content.email,
      links: content.links.map(({ label, url }) => ({ label, url })),
    },
    experiences: content.experiences.map((experience) => ({
      slug: experience.slug,
      title: experience.title,
      organization: experience.organization.name,
      startedOn: experience.startedOn,
      endedOn: experience.endedOn,
      summary: summaryOf(experience.summary),
      technologies: experience.technologies.map(({ name }) => name),
      projects: experience.projects.map(({ slug, name, caseStudy }) => ({
        slug,
        name,
        caseStudy: caseStudy !== null,
      })),
    })),
    services: content.services.map(({ slug, name, summary }) => ({
      slug,
      name,
      summary: plainText(summary),
    })),
    explorations: content.explorations.map(({ slug, name, summary, status }) => ({
      slug,
      name,
      summary: summaryOf(summary),
      status,
    })),
    technologyGroups: TECHNOLOGY_GROUP_KEYS.filter((key) => shown.has(key)),
    learning: content.currentLearning.flatMap((area) =>
      area.modules.map((module) => ({
        area: area.slug,
        areaName: area.name,
        slug: module.slug,
        name: module.name,
        summary: summaryOf(module.description),
        completed: module.progress.completed,
        total: module.progress.total,
      })),
    ),
  };
}
