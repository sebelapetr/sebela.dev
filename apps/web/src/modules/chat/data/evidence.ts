// What the mock's answers may rest on: the public profile read for the Ask page, reduced on the
// server to plain, serializable records the browser can hold. Every fact an answer shows comes
// from here, so the answers never claim anything the profile does not hold.
import type { ExplorationStatus } from "@sebela/api-client";

import type { AskContent } from "../../profile";
import { TECHNOLOGY_GROUP_KEYS, technologyGroupOf, type TechnologyGroupKey } from "../../_shared";

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
}

/**
 * The first paragraph of a Markdown text as plain words on one line, without marks or link
 * targets, cut at a word with an ellipsis to at most `max` characters; empty without words.
 */
export function plainText(markdown: string, max = 280): string {
  const paragraph = markdown.trim().split(/\n\s*\n/, 1)[0] ?? "";
  const words = paragraph
    .split("\n")
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, ""))
    .join(" ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (words.length <= max) return words;
  const cut = words.slice(0, max - 1);
  const space = words[max - 1] === " " ? cut.length : cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
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
  };
}
