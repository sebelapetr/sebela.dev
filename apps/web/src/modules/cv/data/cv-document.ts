import type { ExplorationStatus } from "@sebela/api-client";

import type { EducationRow } from "../../_shared";
import type { CvContent, CvPdf } from "../../profile";

/** One experience as the CV lists it. */
export interface CvExperience {
  readonly slug: string;
  readonly title: string;
  readonly organization: string;
  /** For example `Side project`. */
  readonly kindLabel: string;
  /** For example `August 5th, 2022 – present`. */
  readonly period: string;
  /** Markdown. */
  readonly summary: string;
  readonly responsibilities: readonly string[];
  /** The technologies' names, in their order. */
  readonly technologies: readonly string[];
}

/** One exploration as the CV's independent R&D lists it: one line with its status. */
export interface CvExplorationLine {
  readonly slug: string;
  readonly name: string;
  readonly status: ExplorationStatus;
  /** For example `Designed`. */
  readonly statusLabel: string;
  /** For example `Unimplemented design, planned or architected only`. */
  readonly statusMeaning: string;
  readonly period: string;
  /** Markdown. */
  readonly summary: string;
}

/** One group of skills. */
export interface CvSkillGroup {
  readonly key: "core" | "ai-engineering-focus" | "secondary";
  readonly label: string;
  /** The technologies' names, in catalog order. */
  readonly technologies: readonly string[];
}

/** The CV as the page prints it, top to bottom. */
export interface CvDocument {
  readonly header: {
    readonly name: string;
    readonly headline: string;
    readonly location: string | null;
    readonly email: { readonly address: string; readonly href: string } | null;
    readonly links: readonly { readonly label: string; readonly url: string }[];
  };
  /** Markdown. */
  readonly summary: string;
  readonly experiences: readonly CvExperience[];
  readonly explorations: readonly CvExplorationLine[];
  readonly skills: readonly CvSkillGroup[];
  readonly education: readonly EducationRow[];
  readonly pdf: CvPdf | null;
}

export const toCvDocument: (content: CvContent) => CvDocument = () => {
  throw new Error("Not implemented.");
};
