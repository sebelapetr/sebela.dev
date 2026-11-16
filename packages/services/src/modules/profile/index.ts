import type {
  Person,
  PersonCreate,
  PersonUpdate,
  Technology,
  TechnologyCreate,
  TechnologyUpdate,
  Topic,
  TopicCreate,
  TopicUpdate,
} from "@sebela/contracts";
import type { PersonFields, PersonRecord, ProfilePersistence } from "@sebela/db";

import { DomainError } from "../../errors.js";
import { createCatalogService } from "./catalogs.js";
import { definedChanges } from "./changes.js";

/**
 * Operations on the ordered technology and topic catalogs, addressed by slug. Results are in the
 * contract shape; expected failures are `DomainError`s:
 *
 * - `listTechnologies`/`listTopics`: every record in catalog order, possibly none.
 * - `get…`: the record, or `not_found`.
 * - `create…`: `conflict` when the slug is taken, also when creates race; a technology whose group
 *   disagrees with its tier is `validation_failed`.
 * - `update…`: changes only the given fields, keeps `id`, `slug` and `createdAt` and advances
 *   `updatedAt`; `not_found` for an unknown slug; a technology change that leaves group and tier
 *   disagreeing (for example only `tier: "secondary"` on a `core` technology) is
 *   `validation_failed`.
 * - `delete…`: removes the record; `not_found` for an unknown slug.
 */
export interface CatalogService {
  listTechnologies(): Promise<Technology[]>;
  getTechnology(slug: string): Promise<Technology>;
  createTechnology(input: TechnologyCreate): Promise<Technology>;
  updateTechnology(slug: string, changes: TechnologyUpdate): Promise<Technology>;
  deleteTechnology(slug: string): Promise<void>;
  listTopics(): Promise<Topic[]>;
  getTopic(slug: string): Promise<Topic>;
  createTopic(input: TopicCreate): Promise<Topic>;
  updateTopic(slug: string, changes: TopicUpdate): Promise<Topic>;
  deleteTopic(slug: string): Promise<void>;
}

/**
 * Operations on the person, the one profile record. Results are in the contract shape of
 * `@sebela/contracts`; expected failures are `DomainError`s:
 *
 * - `getPerson`: the person, or `not_found` while there is none.
 * - `createPerson`: creates the person; `conflict` when one exists, also when creates race.
 * - `updatePerson`: changes only the given fields, keeps `id` and `createdAt` and advances
 *   `updatedAt`; `not_found` while there is no person.
 * - `deletePerson`: removes the person; `not_found` while there is none.
 *
 * It also includes the catalog operations of `CatalogService`.
 */
export interface ProfileService extends CatalogService {
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

export function createProfileService(persistence: ProfilePersistence): ProfileService {
  return {
    ...createCatalogService(persistence),
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
      const record = await persistence.updatePerson(definedChanges<PersonFields>(changes));
      if (!record) throw missing();
      return toPerson(record);
    },
    async deletePerson() {
      if (!(await persistence.deletePerson())) throw missing();
    },
  };
}
