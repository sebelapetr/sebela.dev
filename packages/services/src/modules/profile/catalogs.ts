import type { ProfilePersistence } from "@sebela/db";

import type { CatalogService } from "./index.js";

/** The ordered technology and topic catalogs. Not implemented yet. */
export function createCatalogService(persistence: ProfilePersistence): CatalogService {
  const pending = () => Promise.reject(new Error(`not implemented over ${typeof persistence}`));
  return {
    listTechnologies: pending,
    getTechnology: pending,
    createTechnology: pending,
    updateTechnology: pending,
    deleteTechnology: pending,
    listTopics: pending,
    getTopic: pending,
    createTopic: pending,
    updateTopic: pending,
    deleteTopic: pending,
  };
}
