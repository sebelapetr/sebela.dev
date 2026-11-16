// Write helpers shared by records with ordered catalog links; private to the profile module.
import { asc, desc, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { experiences, technologies, topics } from "./schema.js";

/** A connection or an open transaction; both run the same queries. */
export type Executor = Pick<NodePgDatabase, "select" | "insert" | "update" | "delete">;

/** `clock_timestamp()`, not `now()`: it advances also within one transaction. */
export const now = sql`clock_timestamp()`;

/** Experiences: current roles (no end) first, then the latest start, the latest end and the slug. */
export const experienceOrder = [
  asc(sql`${experiences.endedOn} IS NOT NULL`),
  desc(experiences.startedOn),
  desc(experiences.endedOn),
  asc(experiences.slug),
];

/** Thrown inside a transaction to roll it back and return the failure instead. */
export class WriteRefused<Failure extends { reason: string }> extends Error {
  constructor(readonly failure: Failure) {
    super(failure.reason);
  }
}

/** The technology refusals every record with technology links shares. */
type TechnologyFailure =
  | { ok: false; reason: "unknown_technologies"; slugs: string[] }
  | { ok: false; reason: "repeated_technologies" };

/**
 * The ids of the technologies with the given slugs, in their order, locked against a concurrent
 * delete until the transaction ends. Refuses repeated and unknown slugs.
 */
export async function technologyIds(tx: Executor, slugs: string[]): Promise<string[]> {
  if (new Set(slugs).size !== slugs.length) {
    throw new WriteRefused<TechnologyFailure>({ ok: false, reason: "repeated_technologies" });
  }
  if (slugs.length === 0) return [];

  const rows = await tx
    .select({ id: technologies.id, slug: technologies.slug })
    .from(technologies)
    .where(inArray(technologies.slug, slugs))
    .for("key share");
  const ids = new Map(rows.map((row) => [row.slug, row.id]));
  const unknown = slugs.filter((slug) => !ids.has(slug));
  if (unknown.length > 0) {
    throw new WriteRefused<TechnologyFailure>({
      ok: false,
      reason: "unknown_technologies",
      slugs: unknown,
    });
  }
  return slugs.map((slug) => ids.get(slug) ?? "");
}

/** The topic refusals every record with topic links shares. */
type TopicFailure =
  | { ok: false; reason: "unknown_topics"; slugs: string[] }
  | { ok: false; reason: "repeated_topics" };

/**
 * The ids of the topics with the given slugs, in their order, locked against a concurrent delete
 * until the transaction ends. Refuses repeated and unknown slugs.
 */
export async function topicIds(tx: Executor, slugs: string[]): Promise<string[]> {
  if (new Set(slugs).size !== slugs.length) {
    throw new WriteRefused<TopicFailure>({ ok: false, reason: "repeated_topics" });
  }
  if (slugs.length === 0) return [];

  const rows = await tx
    .select({ id: topics.id, slug: topics.slug })
    .from(topics)
    .where(inArray(topics.slug, slugs))
    .for("key share");
  const ids = new Map(rows.map((row) => [row.slug, row.id]));
  const unknown = slugs.filter((slug) => !ids.has(slug));
  if (unknown.length > 0) {
    throw new WriteRefused<TopicFailure>({ ok: false, reason: "unknown_topics", slugs: unknown });
  }
  return slugs.map((slug) => ids.get(slug) ?? "");
}
