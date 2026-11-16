import type { Person, PersonCreate, PersonUpdate } from "@sebela/contracts";
import type { PersonFields, PersonRecord, ProfilePersistence } from "@sebela/db";

import { DomainError } from "../../errors.js";

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

const missing = () => new DomainError("not_found", "There is no person yet.");

function toPerson(record: PersonRecord): Person {
  return {
    ...record,
    links: record.links.map(({ label, url }) => ({ label, url })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Drops fields that are absent or `undefined`, so they stay unchanged. */
function definedChanges(changes: PersonUpdate): Partial<PersonFields> {
  return Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
}

export function createProfileService(persistence: ProfilePersistence): ProfileService {
  return {
    async getPerson() {
      const record = await persistence.findPerson();
      if (!record) throw missing();
      return toPerson(record);
    },
    async createPerson(input) {
      const result = await persistence.createPerson(input);
      if (!result.ok) throw new DomainError("conflict", "The person already exists.");
      return toPerson(result.person);
    },
    async updatePerson(changes) {
      const record = await persistence.updatePerson(definedChanges(changes));
      if (!record) throw missing();
      return toPerson(record);
    },
    async deletePerson() {
      if (!(await persistence.deletePerson())) throw missing();
    },
  };
}
