import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import {
  createProfilePersistence,
  type OrganizationFields,
  type ProfilePersistence,
} from "./index.js";

const northwind: OrganizationFields & { slug: string } = {
  slug: "northwind",
  name: "Northwind Example",
  website: "https://northwind.example.com/",
  description: "A fictional logistics company.",
};

const organization = (slug: string, name: string): OrganizationFields & { slug: string } => ({
  slug,
  name,
  website: null,
  description: null,
});

describe("organization persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    profile = createProfilePersistence(connection.db);
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    await connection.db.execute(sql`DROP TABLE IF EXISTS profile.fictional_references`);
    for (const { slug } of await profile.listOrganizations()) {
      await profile.deleteOrganization(slug);
    }
  });

  it("lists nothing while there are no organizations", async () => {
    await expect(profile.listOrganizations()).resolves.toEqual([]);
  });

  it("creates an organization and reads it back by slug", async () => {
    const created = await profile.createOrganization(northwind);

    expect(created).toMatchObject({ ok: true, organization: northwind });
    const found = await profile.findOrganization("northwind");
    expect(found).toMatchObject(northwind);
    expect(found?.id).toEqual(expect.any(String));
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
  });

  it("stores an organization without a website or description", async () => {
    await profile.createOrganization(organization("acme", "Acme"));

    await expect(profile.findOrganization("acme")).resolves.toMatchObject({
      website: null,
      description: null,
    });
  });

  it("finds nothing for an unknown slug", async () => {
    await expect(profile.findOrganization("missing")).resolves.toBeNull();
  });

  it("refuses a duplicate slug as a conflict, also for concurrent creates", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => profile.createOrganization(northwind)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, reason: "conflict" })),
    );
  });

  it("orders by name ignoring case, then by slug", async () => {
    await profile.createOrganization(organization("zeta", "zeta Works"));
    await profile.createOrganization(organization("beta-two", "Beta"));
    await profile.createOrganization(organization("alpha", "Alpha"));
    await profile.createOrganization(organization("beta-one", "Beta"));
    await profile.createOrganization(organization("yonder", "Yonder"));

    const slugs = (await profile.listOrganizations()).map((record) => record.slug);

    expect(slugs).toEqual(["alpha", "beta-one", "beta-two", "yonder", "zeta"]);
  });

  it("updates given fields, keeps the slug, id and createdAt and advances updatedAt", async () => {
    const created = await profile.createOrganization(northwind);
    if (!created.ok) throw new Error("expected an organization");

    const updated = await profile.updateOrganization("northwind", {
      name: "Northwind",
      website: null,
    });

    if (!updated.ok) throw new Error("expected the updated organization");
    expect(updated.organization).toMatchObject({
      ...northwind,
      name: "Northwind",
      website: null,
      id: created.organization.id,
      createdAt: created.organization.createdAt,
    });
    expect(updated.organization.updatedAt.getTime()).toBeGreaterThan(
      created.organization.updatedAt.getTime(),
    );
  });

  it("updates nothing for an unknown slug", async () => {
    await expect(profile.updateOrganization("missing", { name: "Missing" })).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("deletes an organization once", async () => {
    await profile.createOrganization(northwind);

    await expect(profile.deleteOrganization("northwind")).resolves.toEqual({ ok: true });
    await expect(profile.deleteOrganization("northwind")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
    await expect(profile.findOrganization("northwind")).resolves.toBeNull();
  });

  it("refuses to delete an organization that another record references", async () => {
    // A stand-in for a later referencing table, such as experiences: a plain foreign key.
    await connection.db.execute(
      sql`CREATE TABLE profile.fictional_references (
        organization_id uuid NOT NULL REFERENCES profile.organizations (id)
      )`,
    );
    const created = await profile.createOrganization(northwind);
    if (!created.ok) throw new Error("expected an organization");
    await connection.db.execute(
      sql`INSERT INTO profile.fictional_references VALUES (${created.organization.id})`,
    );

    await expect(profile.deleteOrganization("northwind")).resolves.toEqual({
      ok: false,
      reason: "referenced",
    });
    await expect(profile.findOrganization("northwind")).resolves.toMatchObject(northwind);
  });
});
