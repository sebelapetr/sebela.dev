import type { ExplorationStatus } from "@sebela/api-client";

import {
  experienceKindLabel,
  explorationStatusText,
  formatPeriod,
  toEducationRows,
  type EducationRow,
} from "../../_shared";
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

/**
 * The CV document from the content the profile module read. It keeps the API's selection and
 * order as they are: every experience the API selected for the CV, nothing else; the explorations
 * as independent R&D of their own with their stored status, never as experiences; the skill groups
 * as core, AI engineering focus and other, an empty group left out.
 */
export function toCvDocument(content: CvContent): CvDocument {
  const { primary, secondary } = content.technologies;
  const skills: CvSkillGroup[] = [
    { key: "core" as const, label: "Core", technologies: primary.core },
    {
      key: "ai-engineering-focus" as const,
      label: "AI engineering focus",
      technologies: primary.aiEngineeringFocus,
    },
    { key: "secondary" as const, label: "Other technologies & tools", technologies: secondary },
  ]
    .filter(({ technologies }) => technologies.length > 0)
    .map(({ key, label, technologies }) => ({
      key,
      label,
      technologies: technologies.map(({ name }) => name),
    }));

  return {
    header: {
      name: content.name,
      headline: content.headline,
      location: content.location,
      email: content.contact.email,
      links: content.contact.links,
    },
    summary: content.shortBio,
    experiences: content.experiences.map((experience) => ({
      slug: experience.slug,
      title: experience.title,
      organization: experience.organization.name,
      kindLabel: experienceKindLabel(experience.kind),
      period: formatPeriod(experience.startedOn, experience.endedOn),
      summary: experience.summary,
      responsibilities: experience.responsibilities,
      technologies: experience.technologies.map(({ name }) => name),
    })),
    explorations: content.explorations.map((exploration) => {
      const status = explorationStatusText(exploration.status);
      return {
        slug: exploration.slug,
        name: exploration.name,
        status: exploration.status,
        statusLabel: status.label,
        statusMeaning: status.meaning,
        period: formatPeriod(exploration.startedOn, exploration.endedOn),
        summary: exploration.summary,
      };
    }),
    skills,
    education: toEducationRows(content.education),
    pdf: content.cvPdf,
  };
}
