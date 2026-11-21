import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import { createApiKeyPersistence } from "../api-keys/index.js";
import { createAuditPersistence } from "../audit/index.js";
import { createProfilePersistence, type ProfilePersistence } from "../profile/index.js";
import { createRoadmapPersistence, type RoadmapPersistence } from "../roadmap/index.js";
import { createMaintenancePersistence, type MaintenancePersistence } from "./index.js";

describe("maintenance persistence: clearing the content", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;
  let roadmap: RoadmapPersistence;
  let maintenance: MaintenancePersistence;

  /** Rows of every table of a schema, as `table count`. */
  const rows = async (schema: string) => {
    const result = await connection.db.execute<{ table: string; count: number }>(sql`
      select tablename as table,
             (xpath('/row/count/text()',
               query_to_xml(format('select count(*) from %I.%I', schemaname, tablename),
                 false, true, '')))[1]::text::int as count
        from pg_tables where schemaname = ${schema} order by tablename`);
    return result.rows;
  };
  const total = async (schema: string) =>
    (await rows(schema)).reduce((sum, { count }) => sum + count, 0);

  /** Fictional content in both schemas: media, an organization with its logo, a roadmap area. */
  const fill = async () => {
    const logo = await profile.createMedia({
      key: "media/fictional-logo.png",
      mediaType: "image/png",
      byteSize: 120,
      width: 64,
      height: 32,
      altText: "A fictional logo.",
    });
    await profile.createMedia({
      key: "media/fictional-cv.pdf",
      mediaType: "application/pdf",
      byteSize: 900,
      width: null,
      height: null,
      altText: null,
    });
    const organization = await profile.createOrganization({
      slug: "northwind",
      name: "Northwind Fictional",
      website: null,
      description: null,
      logoId: logo.id,
    });
    expect(organization.ok).toBe(true);
    const area = await roadmap.createRoadmapArea({
      slug: "fictional-area",
      name: "Fictional area",
      description: null,
      weight: 10,
      position: 1,
    });
    expect(area.ok).toBe(true);
  };

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    profile = createProfilePersistence(connection.db);
    roadmap = createRoadmapPersistence(connection.db);
    maintenance = createMaintenancePersistence(connection.db);
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  it("empties every table of the profile and the roadmap and returns the media's storage keys", async () => {
    await fill();
    expect(await total("profile")).toBeGreaterThan(0);
    expect(await total("ai_roadmap")).toBeGreaterThan(0);

    const keys = await maintenance.clearContent();

    expect([...keys].sort()).toEqual(["media/fictional-cv.pdf", "media/fictional-logo.png"]);
    expect(await total("profile")).toBe(0);
    expect(await total("ai_roadmap")).toBe(0);
    expect(await profile.listOrganizations()).toEqual([]);
    expect(await profile.findPerson()).toBeNull();
  });

  it("keeps the API keys and the audit of earlier changes", async () => {
    const key = await createApiKeyPersistence(connection.db).insertKey({
      name: "fixture-owner",
      publicId: "pubmaint",
      secretHash: "hash",
    });
    await createAuditPersistence(connection.db).recordChanges([
      {
        keyId: key.id,
        operationId: "createOrganization",
        method: "POST",
        route: "/v1/organizations",
        provenance: null,
        entity: "organization",
        record: "northwind",
        action: "created",
        before: null,
        after: { slug: "northwind" },
      },
    ]);
    await fill();

    await maintenance.clearContent();

    expect(await total("auth")).toBe(1);
    expect(await total("audit")).toBe(1);
  });

  it("returns no keys and changes nothing on an empty database", async () => {
    await maintenance.clearContent();
    expect(await maintenance.clearContent()).toEqual([]);
    expect(await total("profile")).toBe(0);
  });
});
