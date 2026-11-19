import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { RecentChangesSchema, recentChangesLimit, type PersonCreate } from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { samplePng } from "../../testing.js";
import { createApiKeyService } from "../api-keys/index.js";
import { createMediaService, type CleanupFailure, type MediaService } from "../media/index.js";
import { createProfileService, type ProfileService } from "../profile/index.js";
import { openStorage } from "../storage/index.js";
import { createAuditService, type AuditService, type AuditedWrite } from "./index.js";

const person: PersonCreate = {
  name: "Ada Example",
  headline: "Fictional engineer",
  shortBio: "A made-up person for tests.",
  longBio: null,
  location: null,
  email: null,
  links: [],
  availability: null,
  careerStartedOn: null,
  servicesIntro: null,
  collaborationSteps: [],
  servicesNote: null,
  photoId: null,
  cvPdfId: null,
};

const UNKNOWN_KEY = "00000000-0000-4000-8000-000000000000";

async function filesBelow(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

describe("the audit service", () => {
  let database: TemporaryDatabase;
  let folder: string;
  let persistence: Persistence;
  /** The services the tests prepare and inspect content with, outside any audited write. */
  let services: { profile: ProfileService; media: MediaService; audit: AuditService };
  let failures: CleanupFailure[];
  let keyId: string;

  /** An audited write by the fixture key, with the given entity, records and work. */
  const write = <T>(
    overrides: Pick<AuditedWrite<T>, "entity" | "records" | "run"> & Partial<AuditedWrite<T>>,
  ): AuditedWrite<T> => ({
    actor: { keyId },
    operation: { operationId: "fixtureWrite", method: "PATCH", route: "/v1/fixture/:slug" },
    provenance: "mcp-admin/update_content",
    ...overrides,
  });

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    folder = await mkdtemp(join(tmpdir(), "sebela-audit-"));
    failures = [];
    persistence = createPersistence(database.config);
    const storage = openStorage({
      driver: "local",
      root: folder,
      environment: "test",
      worktree: "audit",
      publicBaseUrl: "https://media.example.test/files",
    });
    const media = {
      storage,
      limits: { maxBytes: 64 * 1024, maxImageDimension: 2000 },
      onCleanupFailure: (failure: CleanupFailure) => failures.push(failure),
    };
    services = {
      profile: createProfileService(persistence.profile),
      media: createMediaService(persistence.profile, media),
      audit: createAuditService(persistence, { media }),
    };
    keyId = (await createApiKeyService(persistence.apiKeys).createKey("fixture-admin")).metadata.id;
  });

  beforeEach(() => {
    failures.length = 0;
  });

  afterEach(async () => {
    // Content of one test never leaks into the next: remove what the tests create.
    for (const { slug } of await services.profile.listTopics()) {
      await services.profile.deleteTopic(slug);
    }
    await services.profile.deletePerson().catch(() => undefined);
    for (const { id } of await services.media.listMedia()) await services.media.deleteMedia(id);
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
    await rm(folder, { recursive: true, force: true });
  });

  it("records a create with its actor, operation, provenance and after", async () => {
    const created = await services.audit.write(
      write({
        operation: { operationId: "createTopic", method: "POST", route: "/v1/topics" },
        entity: "topic",
        records: [],
        run: ({ profile }) => profile.createTopic({ slug: "agents", name: "Agents", position: 1 }),
        recordsOf: (topic) => [topic.slug],
      }),
    );

    const changes = await services.audit.recentChanges();

    expect(RecentChangesSchema.parse({ changes })).toEqual({ changes });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      actor: { keyId, keyName: "fixture-admin" },
      operation: { operationId: "createTopic", method: "POST", route: "/v1/topics" },
      provenance: "mcp-admin/update_content",
      entity: "topic",
      record: "agents",
      action: "created",
      before: null,
      after: created,
    });
  });

  it("records an update with the record before and after it", async () => {
    const before = await services.profile.createTopic({
      slug: "evals",
      name: "Evals",
      position: 2,
    });

    const after = await services.audit.write(
      write({
        entity: "topic",
        records: ["evals"],
        run: ({ profile }) => profile.updateTopic("evals", { name: "Evaluations" }),
      }),
    );

    const [change] = await services.audit.recentChanges();
    expect(change).toMatchObject({ record: "evals", action: "updated", before, after });
  });

  it("records a delete with nothing after it, and the person with no record name", async () => {
    const created = await services.profile.createPerson(person);

    await services.audit.write(
      write({
        operation: { operationId: "deletePerson", method: "DELETE", route: "/v1/person" },
        provenance: null,
        entity: "person",
        records: [null],
        run: ({ profile }) => profile.deletePerson(),
      }),
    );

    const [change] = await services.audit.recentChanges();
    expect(change).toMatchObject({
      entity: "person",
      record: null,
      action: "deleted",
      provenance: null,
      before: created,
      after: null,
    });
  });

  it("rolls the content back when the audit cannot be stored", async () => {
    const audited = services.audit.write(
      write({
        actor: { keyId: UNKNOWN_KEY },
        entity: "topic",
        records: [],
        run: ({ profile }) => profile.createTopic({ slug: "lost", name: "Lost", position: 3 }),
        recordsOf: (topic) => [topic.slug],
      }),
    );

    await expect(audited).rejects.toThrow();
    await expect(services.profile.getTopic("lost")).rejects.toMatchObject({ code: "not_found" });
    await expect(services.audit.recentChanges()).resolves.not.toContainEqual(
      expect.objectContaining({ record: "lost" }),
    );
  });

  it("records nothing for a refused write and rethrows its refusal", async () => {
    const count = (await services.audit.recentChanges()).length;

    const audited = services.audit.write(
      write({
        entity: "topic",
        records: ["missing"],
        run: ({ profile }) => profile.updateTopic("missing", { name: "Missing" }),
      }),
    );

    await expect(audited).rejects.toBeInstanceOf(DomainError);
    await expect(services.audit.recentChanges()).resolves.toHaveLength(count);
  });

  it("refuses and rolls back a write that changed no record it can name", async () => {
    const audited = services.audit.write(
      write({
        entity: "topic",
        records: [],
        run: ({ profile }) => profile.createTopic({ slug: "nameless", name: "X", position: 4 }),
      }),
    );

    await expect(audited).rejects.toThrow();
    await expect(services.profile.getTopic("nameless")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses a provenance label outside the contract before writing", async () => {
    const audited = services.audit.write(
      write({
        provenance: "Not A Label",
        entity: "topic",
        records: [],
        run: ({ profile }) => profile.createTopic({ slug: "labelled", name: "X", position: 5 }),
        recordsOf: (topic) => [topic.slug],
      }),
    );

    await expect(audited).rejects.toMatchObject({ code: "validation_failed" });
    await expect(services.profile.getTopic("labelled")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  describe("media", () => {
    const upload = (actorKey: () => string) =>
      services.audit.write(
        write({
          actor: { keyId: actorKey() },
          operation: { operationId: "uploadMedia", method: "POST", route: "/v1/media" },
          entity: "media",
          records: [],
          run: ({ media }) =>
            media.uploadMedia({
              bytes: samplePng({ width: 4, height: 3 }),
              filename: "office.png",
              declaredType: "image/png",
              altText: "A fictional office.",
            }),
          recordsOf: (uploaded) => [uploaded.id],
        }),
      );

    const remove = (id: string, actorKey: string) =>
      services.audit.write(
        write({
          actor: { keyId: actorKey },
          operation: { operationId: "deleteMedia", method: "DELETE", route: "/v1/media/:id" },
          entity: "media",
          records: [id],
          run: ({ media }) => media.deleteMedia(id),
        }),
      );

    it("records an upload and keeps its file", async () => {
      const uploaded = await upload(() => keyId);

      const [change] = await services.audit.recentChanges();
      expect(change).toMatchObject({ entity: "media", record: uploaded.id, after: uploaded });
      expect(await filesBelow(folder)).toEqual([uploaded.key.split("/").at(-1)]);
    });

    it("removes the stored file again when the audit of an upload fails", async () => {
      await expect(upload(() => UNKNOWN_KEY)).rejects.toThrow();

      await expect(services.media.listMedia()).resolves.toEqual([]);
      expect(await filesBelow(folder)).toEqual([]);
      expect(failures).toEqual([]);
    });

    it("removes a deleted file only once the deletion and its audit committed", async () => {
      const uploaded = await services.media.uploadMedia({
        bytes: samplePng({ width: 5, height: 3 }),
        filename: "desk.png",
        declaredType: "image/png",
      });

      await expect(remove(uploaded.id, UNKNOWN_KEY)).rejects.toThrow();
      await expect(services.media.getMedia(uploaded.id)).resolves.toEqual(uploaded);
      expect(await filesBelow(folder)).toHaveLength(1);

      await remove(uploaded.id, keyId);
      await expect(services.media.listMedia()).resolves.toEqual([]);
      expect(await filesBelow(folder)).toEqual([]);
      const [change] = await services.audit.recentChanges();
      expect(change).toMatchObject({ record: uploaded.id, action: "deleted", before: uploaded });
    });
  });

  it("lists at most the newest changes, newest first", async () => {
    for (let index = 0; index < recentChangesLimit + 2; index += 1) {
      await services.audit.write(
        write({
          entity: "topic",
          records: [],
          run: ({ profile }) =>
            profile.createTopic({ slug: `topic-${String(index)}`, name: "T", position: index }),
          recordsOf: (topic) => [topic.slug],
        }),
      );
    }

    const changes = await services.audit.recentChanges();

    expect(changes).toHaveLength(recentChangesLimit);
    expect(changes[0]?.record).toBe(`topic-${String(recentChangesLimit + 1)}`);
    expect(changes.at(-1)?.record).toBe("topic-2");
  });
});
