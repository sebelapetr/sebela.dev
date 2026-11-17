import { sql } from "drizzle-orm";

import type { Database } from "../../database.js";
import { checkMediaReferences, type MediaReference, refusingMedia } from "./media.js";
import { persons } from "./schema.js";
import type { MediaReferenceFailure } from "./types.js";

export interface PersonLinkRecord {
  label: string;
  url: string;
}

/** One step of how the person works with a client, in its intended order. */
export interface CollaborationStepRecord {
  title: string;
  /** Markdown. */
  description: string;
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
  /** Markdown: the introduction of the services page. */
  servicesIntro: string | null;
  collaborationSteps: CollaborationStepRecord[];
  /** Markdown: the note before the services page's closing action. */
  servicesNote: string | null;
}

/** Media attached to the person, by media id; `null` while none is attached. */
export interface PersonMedia {
  /** An image. */
  photoId: string | null;
  /** A PDF: the current, manually prepared CV PDF. */
  cvPdfId: string | null;
}

export interface PersonRecord extends PersonFields, PersonMedia {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePersonResult =
  { ok: true; person: PersonRecord } | { ok: false; reason: "conflict" } | MediaReferenceFailure;

export type UpdatePersonResult =
  { ok: true; person: PersonRecord } | { ok: false; reason: "not_found" } | MediaReferenceFailure;

/** Operations on the one person. */
export interface PersonPersistence {
  /** The person, or `null` when none exists. */
  findPerson(): Promise<PersonRecord | null>;
  /**
   * Creates the person; `conflict` when one already exists, also for a racing create; see
   * `MediaReferenceFailure`. Omitted media is `null`.
   */
  createPerson(fields: PersonFields & Partial<PersonMedia>): Promise<CreatePersonResult>;
  /** Changes only the given fields; `not_found` when there is no person. */
  updatePerson(changes: Partial<PersonFields & PersonMedia>): Promise<UpdatePersonResult>;
  /** `true` when a person was deleted, `false` when there was none. */
  deletePerson(): Promise<boolean>;
}

/** The stored columns of the person. */
export const personColumns = {
  id: persons.id,
  name: persons.name,
  headline: persons.headline,
  shortBio: persons.shortBio,
  longBio: persons.longBio,
  location: persons.location,
  email: persons.email,
  links: persons.links,
  availability: persons.availability,
  careerStartedOn: persons.careerStartedOn,
  servicesIntro: persons.servicesIntro,
  collaborationSteps: persons.collaborationSteps,
  servicesNote: persons.servicesNote,
  photoId: persons.photoId,
  cvPdfId: persons.cvPdfId,
  createdAt: persons.createdAt,
  updatedAt: persons.updatedAt,
};

/** The photo must be an image and the CV PDF a PDF. */
const personMedia = (fields: Partial<PersonMedia>): MediaReference[] => [
  { field: "photoId", id: fields.photoId, kind: "image" },
  { field: "cvPdfId", id: fields.cvPdfId, kind: "pdf" },
];

/**
 * The singleton person in `profile.persons`. There is at most one row: the unique `singleton`
 * column decides concurrent creates inside the database, and the loser sees a conflict.
 */
export function createPersonPersistence(db: Database): PersonPersistence {
  return {
    async findPerson() {
      const [row] = await db.select(personColumns).from(persons).limit(1);
      return row ?? null;
    },
    createPerson(fields) {
      return refusingMedia(() =>
        db.transaction(async (tx) => {
          await checkMediaReferences(tx, personMedia(fields));
          const [row] = await tx
            .insert(persons)
            .values(fields)
            .onConflictDoNothing({ target: persons.singleton })
            .returning(personColumns);
          return row
            ? ({ ok: true, person: row } as const)
            : ({ ok: false, reason: "conflict" } as const);
        }),
      );
    },
    updatePerson(changes) {
      return refusingMedia(() =>
        db.transaction(async (tx) => {
          await checkMediaReferences(tx, personMedia(changes));
          // `clock_timestamp()`, not `now()`: it advances also within one transaction.
          const [row] = await tx
            .update(persons)
            .set({ ...changes, updatedAt: sql`clock_timestamp()` })
            .returning(personColumns);
          return row
            ? ({ ok: true, person: row } as const)
            : ({ ok: false, reason: "not_found" } as const);
        }),
      );
    },
    async deletePerson() {
      const rows = await db.delete(persons).returning({ id: persons.id });
      return rows.length > 0;
    },
  };
}
