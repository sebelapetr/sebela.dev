import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  OrganizationListSchema,
  OrganizationSchema,
  type OrganizationCreate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError } from "../../errors.js";
import { createProfileService, type ProfileService } from "./index.js";

const northwind: OrganizationCreate = {
  slug: "northwind",
  name: "Northwind Example",
  website: "https://northwind.example.com/",
  description: "A fictional logistics company.",
};

const acme: OrganizationCreate = { slug: "acme", name: "Acme", website: null, description: null };

describe("organization service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let profile: ProfileService;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    profile = createProfileService(persistence.profile);
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const { slug } of await persistence.profile.listOrganizations()) {
      await persistence.profile.deleteOrganization(slug);
    }
  });

  it("lists no organizations", async () => {
    await expect(profile.listOrganizations()).resolves.toEqual([]);
  });

  it("creates organizations in the contract shape and lists them by name", async () => {
    const second = await profile.createOrganization(northwind);
    const first = await profile.createOrganization(acme);

    expect(OrganizationSchema.parse(second)).toEqual(second);
    expect(second).toMatchObject(northwind);
    const listed = await profile.listOrganizations();
    expect(OrganizationListSchema.parse(listed)).toEqual([first, second]);
    await expect(profile.getOrganization("northwind")).resolves.toEqual(second);
  });

  it("reports an unknown slug as not found", async () => {
    await expect(profile.getOrganization("missing")).rejects.toBeInstanceOf(DomainError);
    await expect(profile.getOrganization("missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(profile.updateOrganization("missing", { name: "X" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(profile.deleteOrganization("missing")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses a duplicate slug as a conflict", async () => {
    await profile.createOrganization(northwind);

    await expect(profile.createOrganization(northwind)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("changes only the given fields and keeps id, slug and createdAt", async () => {
    const created = await profile.createOrganization(northwind);

    const updated = await profile.updateOrganization("northwind", {
      website: null,
      description: undefined,
    });

    expect(updated).toMatchObject({ ...northwind, website: null });
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("deletes an organization", async () => {
    await profile.createOrganization(northwind);

    await profile.deleteOrganization("northwind");

    await expect(profile.getOrganization("northwind")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses to delete a referenced organization as a conflict", async () => {
    // Persistence reports a reference that a foreign key holds (tested in @sebela/db); this one
    // reports it for every delete. A real experience reference is in `experiences.test.ts`.
    const referenced = createProfileService({
      ...persistence.profile,
      deleteOrganization: () => Promise.resolve({ ok: false, reason: "referenced" }),
    });

    await expect(referenced.deleteOrganization("northwind")).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("northwind") as unknown,
    });
  });
});
