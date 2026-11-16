import type { ProjectService } from "./types.js";

// Specified by projects.test.ts; implemented next.
export function createProjectService(): ProjectService {
  const pending = () => Promise.reject(new Error("Projects are not implemented yet."));
  return {
    listProjects: pending,
    getProject: pending,
    createProject: pending,
    updateProject: pending,
    deleteProject: pending,
  };
}
