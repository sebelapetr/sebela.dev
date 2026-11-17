// What the mock's answers may rest on: the public profile read for the Ask page, reduced on the
// server to plain, serializable records the browser can hold. Every fact an answer shows comes
// from here, so the answers never claim anything the profile does not hold.
import type { ExplorationStatus } from "@sebela/api-client";

import type { AskContent } from "../../profile";
import type { TechnologyGroupKey } from "../../_shared";

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
  throw new Error(`not implemented for ${String(markdown.length)}/${String(max)}`);
}

/** The Ask page's content reduced to the evidence its answers may rest on. */
export function toAskEvidence(content: AskContent): AskEvidence {
  throw new Error(`not implemented for ${content.name}`);
}
