import type { Person } from "@sebela/contracts";
import type { PersonRecord } from "@sebela/db";

/** The stored person in the contract shape, with ISO timestamps. */
export function toPerson(record: PersonRecord): Person {
  return {
    ...record,
    links: record.links.map(({ label, url }) => ({ label, url })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
