import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OrganizationListSchema, OrganizationSchema, type Organization } from "@sebela/contracts";

import type { WriteEvent } from "./app.js";
import {
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  type TestBackend,
} from "./test-support.js";

/** Fictional organizations. */
const northwind = {
  slug: "northwind",
  name: "Northwind Example",
  website: "https://northwind.example.com/",
  description: "A **fictional** logistics company.",
};
const acme = { slug: "acme", name: "acme" };

describe("the organization API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("organization routes")).key);
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { profile } = backend.services;
    for (const { slug } of await profile.listOrganizations()) {
      await profile.deleteOrganization(slug);
    }
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());

  it("lists no organizations publicly", async () => {
    const response = await request("/v1/organizations");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("creates an organization with its address, and reads it publicly", async () => {
    const created = await request("/v1/organizations", "POST", json(northwind, auth));

    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe("/v1/organizations/northwind");
    const body = OrganizationSchema.parse(await created.json());
    expect(body).toMatchObject(northwind);
    expect(Object.keys(body).sort()).toEqual(
      [...Object.keys(northwind), "id", "createdAt", "updatedAt"].sort(),
    );

    const read = await request("/v1/organizations/northwind");
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(body);
  });

  it("lists by name ignoring case, then by slug, with unset fields as null", async () => {
    for (const organization of [
      northwind,
      { slug: "beta-two", name: "Beta" },
      acme,
      { slug: "beta-one", name: "beta" },
    ]) {
      expect((await request("/v1/organizations", "POST", json(organization, auth))).status).toBe(
        201,
      );
    }

    const listed = OrganizationListSchema.parse(await (await request("/v1/organizations")).json());

    expect(listed.map((organization) => organization.slug)).toEqual([
      "acme",
      "beta-one",
      "beta-two",
      "northwind",
    ]);
    expect(listed[0]).toMatchObject({ website: null, description: null });
  });

  it("refuses a duplicate slug with a conflict", async () => {
    await request("/v1/organizations", "POST", json(northwind, auth));

    const again = await request("/v1/organizations", "POST", json(northwind, auth));

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { code: "conflict", message: anyText } });
  });

  it.each([
    ["a missing name", { slug: "acme" }, "name"],
    ["a name that is too long", { ...acme, name: "x".repeat(201) }, "name"],
    ["a description that is too long", { ...acme, description: "x".repeat(5001) }, "description"],
    ["a website that is not a URL", { ...acme, website: "acme" }, "website"],
    ["a website with a script scheme", { ...acme, website: "javascript:alert(1)" }, "website"],
    ["an invalid slug", { ...acme, slug: "Acme Inc" }, "slug"],
    ["a logo reference before media exists", { ...acme, logo: "acme.png" }, "logo"],
    ["a logo media identifier", { ...acme, logoMediaId: "acme-logo" }, "logoMediaId"],
  ])("refuses %s with the field", async (_, body, field) => {
    const response = await request("/v1/organizations", "POST", json(body, auth));

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: { path: string; message: string }[] };
    };
    expect(error.code).toBe("validation_failed");
    // A known field is named by its path; an unknown one, such as a logo, by the message.
    expect(
      error.fields?.some(({ path, message }) => path === field || message.includes(`"${field}"`)),
    ).toBe(true);
    await expect(backend.services.profile.listOrganizations()).resolves.toEqual([]);
  });

  it("updates only the given fields, keeping the slug, id and creation time", async () => {
    const created = (await (
      await request("/v1/organizations", "POST", json(northwind, auth))
    ).json()) as Organization;

    const updated = await request(
      "/v1/organizations/northwind",
      "PATCH",
      json({ name: "Northwind", website: null }, auth),
    );

    expect(updated.status).toBe(200);
    const body = (await updated.json()) as Organization;
    expect(body).toMatchObject({
      ...northwind,
      name: "Northwind",
      website: null,
      id: created.id,
      createdAt: created.createdAt,
    });
    expect(Date.parse(body.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it.each([
    ["a change of the slug", { slug: "renamed" }],
    ["an empty change", {}],
    ["a logo reference", { logo: "northwind.png" }],
  ])("refuses %s", async (_, body) => {
    await request("/v1/organizations", "POST", json(northwind, auth));

    const response = await request("/v1/organizations/northwind", "PATCH", json(body, auth));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
  });

  it("answers a missing organization with not found", async () => {
    for (const response of [
      await request("/v1/organizations/missing"),
      await request("/v1/organizations/missing", "PATCH", json({ name: "X" }, auth)),
      await request("/v1/organizations/missing", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: anyText } });
    }
  });

  it("refuses a malformed slug in the path with the field", async () => {
    for (const response of [
      await request("/v1/organizations/Not%20A%20Slug"),
      await request("/v1/organizations/north.wind", "PATCH", json({ name: "X" }, auth)),
      await request("/v1/organizations/UPPER", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "validation_failed",
          message: anyText,
          fields: [expect.objectContaining({ path: "slug" })],
        },
      });
    }
  });

  it("checks the key before the path and the body", async () => {
    expect((await request("/v1/organizations/Not%20A%20Slug", "DELETE")).status).toBe(401);
    expect((await request("/v1/organizations", "POST", json({}))).status).toBe(401);
    await expect(backend.services.profile.listOrganizations()).resolves.toEqual([]);
  });

  it("deletes an organization with the key, and reports each write", async () => {
    const events: WriteEvent[] = [];
    const { app } = backend.api({
      onWrite: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });
    await app.request(
      "/v1/organizations",
      { method: "POST", ...json(northwind, auth) },
      connection(),
    );

    const deleted = await app.request(
      "/v1/organizations/northwind",
      { method: "DELETE", headers: auth },
      connection(),
    );

    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(events).toEqual([
      { operationId: "createOrganization", method: "POST", path: "/v1/organizations" },
      {
        operationId: "deleteOrganization",
        method: "DELETE",
        path: "/v1/organizations/northwind",
      },
    ]);
    expect((await request("/v1/organizations/northwind")).status).toBe(404);
  });
});
