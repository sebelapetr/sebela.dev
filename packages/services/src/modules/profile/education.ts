import type { ProfilePersistence } from "@sebela/db";

import type { EducationService } from "./types.js";

/** Not implemented yet. */
export function createEducationService(persistence: ProfilePersistence): EducationService {
  const refuse = (operation: string) =>
    Promise.reject(new Error(`${operation} is not implemented for ${typeof persistence}`));
  return {
    listEducation: () => refuse("listEducation"),
    getEducation: (slug) => refuse(`getEducation ${slug}`),
    createEducation: (input) => refuse(`createEducation ${input.slug}`),
    updateEducation: (slug) => refuse(`updateEducation ${slug}`),
    deleteEducation: (slug) => refuse(`deleteEducation ${slug}`),
  };
}
