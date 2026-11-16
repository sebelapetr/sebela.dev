// The profile entry: re-exports selected operations of its private files.
import { readProfile } from "@sebela/db";

import { experienceTitles } from "./experiences.js";

export function getProfile(): { name: string; experiences: string[] } {
  return { name: readProfile().name, experiences: experienceTitles() };
}
