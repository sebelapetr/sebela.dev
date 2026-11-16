import type { Cv, CvExploration, Media, Technology } from "@sebela/contracts";
import type { CvPersistence, ExplorationRecord, MediaRecord } from "@sebela/db";

import { DomainError } from "../../errors.js";
import { toTechnology } from "./catalogs.js";
import { toEducation } from "./education.js";
import { toExperience } from "./experiences.js";
import { toPerson } from "./person.js";
import type { CvService } from "./types.js";

/** The public address of a stored media key, or `null` when the storage cannot address it. */
export type MediaAddress = (key: string) => string | null;

/** An exploration as the CV lists it: concise, with the status exactly as stored. */
function toCvExploration(record: ExplorationRecord): CvExploration {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    summary: record.summary,
    status: record.status,
    concepts: record.concepts,
    startedOn: record.startedOn,
    endedOn: record.endedOn,
    technologies: record.technologies.map(toTechnology),
  };
}

/** The CV PDF in the media contract shape, addressed like the media service addresses it. */
function toCvPdf(record: MediaRecord, address: MediaAddress): Media {
  return {
    id: record.id,
    key: record.key,
    mediaType: record.mediaType,
    byteSize: record.byteSize,
    width: record.width,
    height: record.height,
    altText: record.altText,
    url: address(record.key),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** The catalog, already in catalog order, split into its tiers and groups, keeping that order. */
function grouped(technologies: Technology[]): Cv["technologies"] {
  const primary = technologies.filter(({ tier }) => tier === "primary");
  return {
    primary: {
      core: primary.filter(({ group }) => group === "core"),
      aiEngineeringFocus: primary.filter(({ group }) => group === "ai_engineering_focus"),
    },
    secondary: technologies.filter(({ tier }) => tier === "secondary"),
  };
}

export function createCvService(persistence: CvPersistence, mediaAddress: MediaAddress): CvService {
  return {
    async getCv() {
      const record = await persistence.readCv();
      if (!record) throw new DomainError("not_found", "There is no person yet.");
      return {
        person: toPerson(record.person),
        experiences: record.experiences.map(toExperience),
        technologies: grouped(record.technologies.map(toTechnology)),
        education: record.education.map(toEducation),
        explorations: record.explorations.map(toCvExploration),
        cvPdf: record.cvPdf && toCvPdf(record.cvPdf, mediaAddress),
      };
    },
  };
}
