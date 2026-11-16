import type { ExperiencePersistence } from "./types.js";

const notImplemented = () => Promise.reject(new Error("Not implemented."));

export function createExperiencePersistence(): ExperiencePersistence {
  return {
    listExperiences: notImplemented,
    findExperience: notImplemented,
    createExperience: notImplemented,
    updateExperience: notImplemented,
    deleteExperience: notImplemented,
  };
}
