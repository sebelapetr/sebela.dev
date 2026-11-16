import type { ProjectPersistence } from "./types.js";

// Specified by projects.test.ts; implemented next.
export function createProjectPersistence(): ProjectPersistence {
  const pending = () => Promise.reject(new Error("Projects are not implemented yet."));
  return {
    listProjects: pending,
    findProject: pending,
    createProject: pending,
    updateProject: pending,
    deleteProject: pending,
  };
}
