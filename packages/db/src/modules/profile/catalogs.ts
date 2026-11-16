import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { CatalogPersistence } from "./index.js";

/** The ordered technology and topic catalogs. Not implemented yet. */
export function createCatalogPersistence(db: NodePgDatabase): CatalogPersistence {
  const pending = () => Promise.reject(new Error(`not implemented over ${typeof db}`));
  return {
    listTechnologies: pending,
    findTechnology: pending,
    createTechnology: pending,
    updateTechnology: pending,
    deleteTechnology: pending,
    listTopics: pending,
    findTopic: pending,
    createTopic: pending,
    updateTopic: pending,
    deleteTopic: pending,
  };
}
