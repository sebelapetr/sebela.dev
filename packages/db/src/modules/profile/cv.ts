import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { PersonRecord } from "./person.js";
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
  experiences: ExperienceRecord[];
  technologies: TechnologyRecord[];
  education: EducationRecord[];
  explorations: ExplorationRecord[];
  cvPdf: MediaRecord | null;
}

export interface CvPersistence {
  /** Not yet implemented. */
  readCv(): Promise<CvRecord | null>;
}

export function createCvPersistence(db: NodePgDatabase): CvPersistence {
  return {
    readCv: () => Promise.reject(new Error(`Reading the CV from ${typeof db} is not implemented.`)),
  };
}
