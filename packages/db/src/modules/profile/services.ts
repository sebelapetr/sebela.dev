import { asc, eq, inArray, type SQL } from "drizzle-orm";

import type { Database } from "../../database.js";
import { type Executor, now, WriteRefused } from "./relations.js";
import { experiences, explorations, projects, serviceEvidence, services } from "./schema.js";
import type {
  ServiceEvidence,
  ServiceEvidenceRecord,
  ServiceFields,
  ServicePersistence,
  ServiceRecord,
  ServiceWriteFailure,
} from "./types.js";

const serviceColumns = {
  id: services.id,
  slug: services.slug,
  name: services.name,
  summary: services.summary,
  audience: services.audience,
  deliverable: services.deliverable,
  position: services.position,
  createdAt: services.createdAt,
  updatedAt: services.updatedAt,
};

/** One stored evidence row with whatever its kind points at, joined in. */
interface EvidenceRow {
  serviceId: string;
  kind: "project" | "exploration" | "link";
  linkLabel: string | null;
  linkPath: string | null;
  project: { slug: string; name: string; summary: string } | null;
  /** The slug of the experience that owns the project, joined through it. */
  projectExperience: string | null;
  exploration: {
    slug: string;
    name: string;
    summary: string;
    status: "built" | "tested" | "designed";
  } | null;
}

/** The read form of a row; the check constraint guarantees the columns of its kind are set. */
function toEvidence(row: EvidenceRow): ServiceEvidenceRecord {
  if (row.kind === "project" && row.project && row.projectExperience !== null) {
    return { kind: "project", project: { ...row.project, experience: row.projectExperience } };
  }
  if (row.kind === "exploration" && row.exploration) {
    return { kind: "exploration", exploration: row.exploration };
  }
  if (row.kind === "link" && row.linkLabel !== null && row.linkPath !== null) {
    return { kind: "link", label: row.linkLabel, path: row.linkPath };
  }
  throw new Error("A stored piece of service evidence does not match its kind.");
}

/** The services by position, then slug, with their evidence in its stored order. */
async function loadServices(db: Executor, where: SQL | undefined): Promise<ServiceRecord[]> {
  const rows = await db
    .select(serviceColumns)
    .from(services)
    .where(where)
    .orderBy(asc(services.position), asc(services.slug));
  if (rows.length === 0) return [];

  const evidenceRows: EvidenceRow[] = await db
    .select({
      serviceId: serviceEvidence.serviceId,
      kind: serviceEvidence.kind,
      linkLabel: serviceEvidence.linkLabel,
      linkPath: serviceEvidence.linkPath,
      project: { slug: projects.slug, name: projects.name, summary: projects.summary },
      projectExperience: experiences.slug,
      exploration: {
        slug: explorations.slug,
        name: explorations.name,
        summary: explorations.summary,
        status: explorations.status,
      },
    })
    .from(serviceEvidence)
    .leftJoin(projects, eq(serviceEvidence.projectId, projects.id))
    .leftJoin(experiences, eq(projects.experienceId, experiences.id))
    .leftJoin(explorations, eq(serviceEvidence.explorationId, explorations.id))
    .where(
      inArray(
        serviceEvidence.serviceId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(serviceEvidence.serviceId), asc(serviceEvidence.position));

  const grouped = new Map<string, ServiceEvidenceRecord[]>();
  for (const row of evidenceRows) {
    grouped.set(row.serviceId, [...(grouped.get(row.serviceId) ?? []), toEvidence(row)]);
  }
  return rows.map((row) => ({ ...row, evidence: grouped.get(row.id) ?? [] }));
}

async function loadService(db: Executor, id: string): Promise<ServiceRecord> {
  const [record] = await loadServices(db, eq(services.id, id));
  if (!record) throw new Error("The written service is missing.");
  return record;
}

/**
 * The ids of the records with the given slugs, locked against a concurrent delete until the
 * transaction ends. Refuses repeated and unknown slugs with the failures of the given kind.
 */
async function targetIds(
  tx: Executor,
  table: typeof projects | typeof explorations,
  slugs: string[],
  refusals: { repeated: ServiceWriteFailure; unknown: (slugs: string[]) => ServiceWriteFailure },
): Promise<Map<string, string>> {
  if (new Set(slugs).size !== slugs.length) throw new WriteRefused(refusals.repeated);
  if (slugs.length === 0) return new Map();

  const rows = await tx
    .select({ id: table.id, slug: table.slug })
    .from(table)
    .where(inArray(table.slug, slugs))
    .for("key share");
  const ids = new Map(rows.map((row) => [row.slug, row.id]));
  const unknown = slugs.filter((slug) => !ids.has(slug));
  if (unknown.length > 0) throw new WriteRefused(refusals.unknown(unknown));
  return ids;
}

/** Replaces all evidence of the service with the given pieces in their order. */
async function writeEvidence(tx: Executor, serviceId: string, evidence: ServiceEvidence[]) {
  const projectIds = await targetIds(
    tx,
    projects,
    evidence.flatMap((piece) => (piece.kind === "project" ? [piece.project] : [])),
    {
      repeated: { ok: false, reason: "repeated_projects" },
      unknown: (slugs) => ({ ok: false, reason: "unknown_projects", slugs }),
    },
  );
  const explorationIds = await targetIds(
    tx,
    explorations,
    evidence.flatMap((piece) => (piece.kind === "exploration" ? [piece.exploration] : [])),
    {
      repeated: { ok: false, reason: "repeated_explorations" },
      unknown: (slugs) => ({ ok: false, reason: "unknown_explorations", slugs }),
    },
  );

  await tx.delete(serviceEvidence).where(eq(serviceEvidence.serviceId, serviceId));
  if (evidence.length === 0) return;
  await tx.insert(serviceEvidence).values(
    evidence.map((piece, position) => ({
      serviceId,
      position,
      kind: piece.kind,
      projectId: piece.kind === "project" ? projectIds.get(piece.project) : null,
      explorationId: piece.kind === "exploration" ? explorationIds.get(piece.exploration) : null,
      linkLabel: piece.kind === "link" ? piece.label : null,
      linkPath: piece.kind === "link" ? piece.path : null,
    })),
  );
}

/** Runs a write; a refusal rolls it back and becomes its failure. */
async function refusable<T>(write: () => Promise<T>): Promise<T | ServiceWriteFailure> {
  try {
    return await write();
  } catch (error) {
    // Every refusal thrown by the service writes is a `ServiceWriteFailure`.
    if (error instanceof WriteRefused) return error.failure as ServiceWriteFailure;
    throw error;
  }
}

/**
 * The services and their ordered evidence. Every write runs in one transaction, so a service and
 * its evidence are stored completely or not at all. Named projects and explorations are locked
 * while the evidence is written, an update locks its service so concurrent replacements
 * serialize, the evidence rows cascade only with their service, and a named project or
 * exploration cannot be deleted. A check constraint keeps each row to the columns of its kind.
 */
export function createServicePersistence(db: Database): ServicePersistence {
  return {
    listServices() {
      return loadServices(db, undefined);
    },
    async findService(slug) {
      const [record] = await loadServices(db, eq(services.slug, slug));
      return record ?? null;
    },
    createService({ evidence, ...fields }) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .insert(services)
            .values(fields)
            .onConflictDoNothing({ target: services.slug })
            .returning({ id: services.id });
          if (!row) return { ok: false, reason: "conflict" } as const;
          await writeEvidence(tx, row.id, evidence);
          return { ok: true, service: await loadService(tx, row.id) } as const;
        }),
      );
    },
    updateService(slug, { evidence, ...changes }) {
      return refusable(() =>
        db.transaction(async (tx) => {
          const [current] = await tx
            .select({ id: services.id })
            .from(services)
            .where(eq(services.slug, slug))
            .for("update");
          if (!current) return { ok: false, reason: "not_found" } as const;

          const fields: Partial<ServiceFields> = changes;
          await tx
            .update(services)
            .set({ ...fields, updatedAt: now })
            .where(eq(services.id, current.id));
          if (evidence !== undefined) await writeEvidence(tx, current.id, evidence);
          return { ok: true, service: await loadService(tx, current.id) } as const;
        }),
      );
    },
    async deleteService(slug) {
      const rows = await db
        .delete(services)
        .where(eq(services.slug, slug))
        .returning({ id: services.id });
      return rows.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
    },
  };
}
