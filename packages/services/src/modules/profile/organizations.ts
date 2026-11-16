import type { ProfilePersistence } from "@sebela/db";

import type { OrganizationService } from "./types.js";

// Specified by organizations.test.ts; implemented next.
export function createOrganizationService(persistence: ProfilePersistence): OrganizationService {
  const unimplemented = () =>
    Promise.reject(new Error(`Organizations are not served yet (${typeof persistence}).`));
  return {
    listOrganizations: unimplemented,
    getOrganization: unimplemented,
    createOrganization: unimplemented,
    updateOrganization: unimplemented,
    deleteOrganization: unimplemented,
  };
}
