import type { Person, PersonCreate, PersonUpdate } from "@sebela/contracts";
import type { ProfilePersistence } from "@sebela/db";

/**
 * Operations on the person, the one profile record. Results are in the contract shape of
 * `@sebela/contracts`; expected failures are `DomainError`s:
 *
 * - `getPerson`: the person, or `not_found` while there is none.
 * - `createPerson`: creates the person; `conflict` when one exists, also when creates race.
 * - `updatePerson`: changes only the given fields, keeps `id` and `createdAt` and advances
 *   `updatedAt`; `not_found` while there is no person.
 * - `deletePerson`: removes the person; `not_found` while there is none.
 */
export interface ProfileService {
  getPerson(): Promise<Person>;
  createPerson(input: PersonCreate): Promise<Person>;
  updatePerson(changes: PersonUpdate): Promise<Person>;
  deletePerson(): Promise<void>;
}

export function createProfileService(persistence: ProfilePersistence): ProfileService {
  const notImplemented = () =>
    Promise.reject(new Error(`not implemented over ${typeof persistence}`));
  return {
    getPerson: notImplemented,
    createPerson: notImplemented,
    updatePerson: notImplemented,
    deletePerson: notImplemented,
  };
}
