import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export interface PersonLinkRecord {
  label: string;
  url: string;
}

/** Writable fields of the person as they are stored. */
export interface PersonFields {
  name: string;
  headline: string;
  shortBio: string;
  longBio: string | null;
  location: string | null;
  email: string | null;
  links: PersonLinkRecord[];
  availability: string | null;
  /** Calendar date, `YYYY-MM-DD`. */
  careerStartedOn: string | null;
}

export interface PersonRecord extends PersonFields {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePersonResult =
  { ok: true; person: PersonRecord } | { ok: false; reason: "conflict" };

/** Persistence operations of the profile domain. */
export interface ProfilePersistence {
  findPerson(): Promise<PersonRecord | null>;
  createPerson(fields: PersonFields): Promise<CreatePersonResult>;
  updatePerson(changes: Partial<PersonFields>): Promise<PersonRecord | null>;
  deletePerson(): Promise<boolean>;
}

export function createProfilePersistence(db: NodePgDatabase): ProfilePersistence {
  const notImplemented = () => Promise.reject(new Error(`not implemented over ${typeof db}`));
  return {
    findPerson: notImplemented,
    createPerson: notImplemented,
    updatePerson: notImplemented,
    deletePerson: notImplemented,
  };
}
