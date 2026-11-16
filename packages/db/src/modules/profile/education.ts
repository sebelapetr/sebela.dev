import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { EducationPersistence } from "./types.js";

/** Not implemented yet. */
export function createEducationPersistence(db: NodePgDatabase): EducationPersistence {
  const refuse = (operation: string) =>
    Promise.reject(new Error(`${operation} is not implemented for ${typeof db}`));
  return {
    listEducation: () => refuse("listEducation"),
    findEducation: (slug) => refuse(`findEducation ${slug}`),
    createEducation: (fields) => refuse(`createEducation ${fields.slug}`),
    updateEducation: (slug) => refuse(`updateEducation ${slug}`),
    deleteEducation: (slug) => refuse(`deleteEducation ${slug}`),
  };
}
