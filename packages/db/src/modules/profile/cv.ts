import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { loadTechnologies } from "./catalogs.js";
import { loadEducation } from "./education.js";
import { loadExperiences } from "./experiences.js";
import { loadExplorations } from "./explorations.js";
import { mediaColumns } from "./media.js";
import { personColumns, type PersonRecord } from "./person.js";
import { experiences, media, persons } from "./schema.js";
import type {
  EducationRecord,
  ExperienceRecord,
  ExplorationRecord,
  MediaRecord,
  TechnologyRecord,
} from "./types.js";

/** The stored facts the CV is assembled from, read together. */
export interface CvRecord {
  person: PersonRecord;
  /** Only the experiences with `inCv`, in the experience order, each fully resolved. */
  experiences: ExperienceRecord[];
  /** Every technology in catalog order: tier, group, position, then slug. */
  technologies: TechnologyRecord[];
  /** Every education record, by position, then slug. */
  education: EducationRecord[];
  /** Every exploration with its stored status, by position, then slug. */
  explorations: ExplorationRecord[];
  /** The media record the person's `cvPdfId` names, or `null` without one. */
  cvPdf: MediaRecord | null;
}

export interface CvPersistence {
  /**
   * Reads the stored facts of the CV in one read-only, repeatable-read transaction, so every
   * section comes from the same snapshot. `null` when there is no person. Writes nothing.
   */
  readCv(): Promise<CvRecord | null>;
}

export function createCvPersistence(db: NodePgDatabase): CvPersistence {
  return {
    readCv() {
      return db.transaction(
        async (tx) => {
          const [person] = await tx.select(personColumns).from(persons).limit(1);
          if (!person) return null;
          const [cvPdf] = person.cvPdfId
            ? await tx.select(mediaColumns).from(media).where(eq(media.id, person.cvPdfId))
            : [];
          return {
            person,
            experiences: await loadExperiences(tx, eq(experiences.inCv, true)),
            technologies: await loadTechnologies(tx),
            education: await loadEducation(tx),
            explorations: await loadExplorations(tx, undefined),
            cvPdf: cvPdf ?? null,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
