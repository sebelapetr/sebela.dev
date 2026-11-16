import type { ExperienceService } from "./types.js";

const notImplemented = () => Promise.reject(new Error("Not implemented."));

export function createExperienceService(): ExperienceService {
  return {
    listExperiences: notImplemented,
    getExperience: notImplemented,
    createExperience: notImplemented,
    updateExperience: notImplemented,
    deleteExperience: notImplemented,
  };
}
