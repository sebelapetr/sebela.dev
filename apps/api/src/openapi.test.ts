import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PersonSchema } from "@sebela/contracts";

import { connection, openTestBackend, type TestBackend } from "./test-support.js";

interface Operation {
  parameters?: { name: string; in: string; required?: boolean; schema: Record<string, unknown> }[];
  security?: Record<string, string[]>[];
  requestBody?: { content: Record<string, { schema: { $ref?: string } }> };
  responses: Record<
    string,
    {
      content?: Record<string, { schema: { $ref?: string } }>;
      headers?: Record<string, unknown>;
    }
  >;
}

interface Document {
  openapi: string;
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, { properties?: Record<string, unknown> }>;
    securitySchemes: Record<string, unknown>;
  };
}

describe("the OpenAPI document and the reference", () => {
  let backend: TestBackend;
  let document: Document;

  beforeAll(async () => {
    backend = await openTestBackend();
    const response = await backend.api().app.request("/openapi.json", {}, connection());
    expect(response.status).toBe(200);
    document = (await response.json()) as Document;
  });

  afterAll(async () => {
    await backend.close();
  });

  const operation = (method: string, path: string): Operation => {
    const found = document.paths[path.replace(/:([A-Za-z]+)/g, "{$1}")]?.[method.toLowerCase()];
    if (!found) throw new Error(`${method} ${path} is not documented`);
    return found;
  };

  it("is OpenAPI 3.1 with bearer security", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.components.securitySchemes).toEqual({
      bearerAuth: expect.objectContaining({ type: "http", scheme: "bearer" }) as unknown,
    });
  });

  it("documents every registered route, its access, its rate limit and its errors", () => {
    for (const route of backend.api().routes) {
      const documented = operation(route.method, route.path);
      const statuses = Object.keys(documented.responses);

      if (route.access === "private") {
        expect(documented.security).toEqual([{ bearerAuth: [] }]);
        expect(statuses).toContain("401");
      } else {
        expect(documented.security).toEqual([]);
        expect(statuses).not.toContain("401");
      }
      if (route.hasBody) {
        expect(statuses).toEqual(expect.arrayContaining(["400", "413", "415"]));
      }
      expect(statuses).toEqual(expect.arrayContaining(["429", "500"]));
      expect(documented.responses["429"]?.headers).toHaveProperty("Retry-After");
      for (const status of statuses.filter((code) => Number(code) >= 400)) {
        expect(documented.responses[status]?.content?.["application/json"]?.schema.$ref).toBe(
          "#/components/schemas/ErrorResponse",
        );
      }
    }
  });

  it("is generated from the contract schemas", () => {
    expect(Object.keys(document.components.schemas["Person"]?.properties ?? {}).sort()).toEqual(
      Object.keys(PersonSchema.shape).sort(),
    );
    expect(operation("GET", "/v1/person").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/Person" } },
    });
    expect(operation("POST", "/v1/person").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/PersonCreate" } },
    });
    expect(operation("PATCH", "/v1/person").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/PersonUpdate" } },
    });
    expect(Object.keys(operation("POST", "/v1/person").responses)).toEqual(
      expect.arrayContaining(["201", "409"]),
    );
    expect(Object.keys(operation("DELETE", "/v1/person").responses)).toEqual(
      expect.arrayContaining(["204", "404"]),
    );
  });

  it("documents the catalogs from their contract schemas, with the slug path parameter", () => {
    expect(operation("GET", "/v1/technologies").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/TechnologyList" } },
    });
    expect(operation("GET", "/v1/topics").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/TopicList" } },
    });
    expect(operation("POST", "/v1/technologies").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/TechnologyCreate" } },
    });
    expect(operation("PATCH", "/v1/topics/:slug").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/TopicUpdate" } },
    });
    expect(operation("POST", "/v1/topics").responses["201"]?.headers).toHaveProperty("Location");
    for (const [method, path] of [
      ["GET", "/v1/technologies/:slug"],
      ["PATCH", "/v1/technologies/:slug"],
      ["DELETE", "/v1/technologies/:slug"],
      ["GET", "/v1/topics/:slug"],
      ["PATCH", "/v1/topics/:slug"],
      ["DELETE", "/v1/topics/:slug"],
    ] as const) {
      const documented = operation(method, path);
      expect(documented.parameters).toEqual([
        expect.objectContaining({
          name: "slug",
          in: "path",
          required: true,
          schema: expect.objectContaining({
            type: "string",
            pattern: expect.any(String) as unknown,
          }) as unknown,
        }),
      ]);
      expect(Object.keys(documented.responses)).toEqual(expect.arrayContaining(["400", "404"]));
    }
    expect(Object.keys(operation("POST", "/v1/technologies").responses)).toEqual(
      expect.arrayContaining(["201", "409"]),
    );
  });

  it("documents the health route", () => {
    expect(operation("GET", "/health").responses["200"]).toBeDefined();
  });

  it("serves a browsable reference of the document without a key", async () => {
    const response = await backend.api().app.request("/reference", {}, connection());

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("/openapi.json");
  });
});
