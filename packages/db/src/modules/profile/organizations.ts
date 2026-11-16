import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { OrganizationPersistence } from "./types.js";

// Specified by organizations.test.ts; implemented next.
export function createOrganizationPersistence(db: NodePgDatabase): OrganizationPersistence {
  const unimplemented = () =>
    Promise.reject(new Error(`Organizations are not stored yet (${typeof db}).`));
  return {
    listOrganizations: unimplemented,
    findOrganization: unimplemented,
    createOrganization: unimplemented,
    updateOrganization: unimplemented,
    deleteOrganization: unimplemented,
  };
}
