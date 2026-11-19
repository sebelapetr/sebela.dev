import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CvSchema, PersonSchema } from "@sebela/contracts";

import { connection, openTestBackend, type TestBackend } from "./test-support.js";

interface Operation {
  operationId?: string;
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
    schemas: Record<
      string,
      { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown }
    >;
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
    const found =
      document.paths[path.replace(/:([A-Za-z]+)(\{[^}]*\})?/g, "{$1}")]?.[method.toLowerCase()];
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

  it("documents the organizations from their contract schemas", () => {
    expect(operation("GET", "/v1/organizations").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/OrganizationList" } },
    });
    expect(operation("GET", "/v1/organizations/:slug").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/Organization" } },
    });
    expect(operation("POST", "/v1/organizations").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/OrganizationCreate" } },
    });
    expect(operation("PATCH", "/v1/organizations/:slug").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/OrganizationUpdate" } },
    });
    expect(operation("POST", "/v1/organizations").responses["201"]?.headers).toHaveProperty(
      "Location",
    );
    expect(Object.keys(operation("POST", "/v1/organizations").responses)).toEqual(
      expect.arrayContaining(["201", "400", "409"]),
    );
    // A referenced organization is not deleted: the delete answers with a conflict.
    expect(Object.keys(operation("DELETE", "/v1/organizations/:slug").responses)).toEqual(
      expect.arrayContaining(["204", "400", "404", "409"]),
    );
    expect(operation("GET", "/v1/organizations/:slug").parameters).toEqual([
      expect.objectContaining({ name: "slug", in: "path", required: true }),
    ]);
  });

  it("documents the experiences from their contract schemas", () => {
    expect(operation("GET", "/v1/experiences").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/ExperienceList" } },
    });
    expect(operation("GET", "/v1/experiences/:slug").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/Experience" } },
    });
    expect(operation("POST", "/v1/experiences").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/ExperienceCreate" } },
    });
    expect(operation("PATCH", "/v1/experiences/:slug").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/ExperienceUpdate" } },
    });
    expect(operation("POST", "/v1/experiences").responses["201"]?.headers).toHaveProperty(
      "Location",
    );
    expect(Object.keys(operation("POST", "/v1/experiences").responses)).toEqual(
      expect.arrayContaining(["201", "400", "401", "409"]),
    );
    expect(Object.keys(operation("PATCH", "/v1/experiences/:slug").responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "404"]),
    );
    // An experience that owns projects is not deleted: the delete may be a conflict.
    expect(Object.keys(operation("DELETE", "/v1/experiences/:slug").responses)).toEqual(
      expect.arrayContaining(["204", "400", "401", "404", "409"]),
    );
    // A technology an experience links is not deleted either.
    expect(Object.keys(operation("DELETE", "/v1/technologies/:slug").responses)).toEqual(
      expect.arrayContaining(["204", "404", "409"]),
    );
    expect(operation("GET", "/v1/experiences/:slug").parameters).toEqual([
      expect.objectContaining({ name: "slug", in: "path", required: true }),
    ]);
  });

  it("documents the projects from their contract schemas", () => {
    expect(operation("GET", "/v1/projects").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/ProjectList" } },
    });
    expect(operation("GET", "/v1/projects/:slug").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/Project" } },
    });
    expect(operation("POST", "/v1/projects").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/ProjectCreate" } },
    });
    expect(operation("PATCH", "/v1/projects/:slug").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/ProjectUpdate" } },
    });
    expect(operation("POST", "/v1/projects").responses["201"]?.headers).toHaveProperty("Location");
    expect(Object.keys(operation("POST", "/v1/projects").responses)).toEqual(
      expect.arrayContaining(["201", "400", "401", "409"]),
    );
    expect(Object.keys(operation("PATCH", "/v1/projects/:slug").responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "404"]),
    );
    expect(Object.keys(operation("DELETE", "/v1/projects/:slug").responses)).toEqual(
      expect.arrayContaining(["204", "400", "401", "404", "409"]),
    );
    expect(operation("GET", "/v1/projects/:slug").parameters).toEqual([
      expect.objectContaining({ name: "slug", in: "path", required: true }),
    ]);
    // An experience carries its projects; a project names its experience by slug.
    expect(document.components.schemas["Experience"]?.properties).toHaveProperty("projects");
    expect(document.components.schemas["Project"]?.properties).toHaveProperty("experience");
  });

  it("documents the case study of a project from its contract schemas", () => {
    const address = "/v1/projects/:slug/case-study";
    expect(operation("GET", address).responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/CaseStudy" } },
    });
    expect(operation("GET", address).security).toEqual([]);
    expect(operation("POST", address).requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/CaseStudyCreate" } },
    });
    expect(operation("PATCH", address).requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/CaseStudyUpdate" } },
    });
    expect(operation("POST", address).responses["201"]?.headers).toHaveProperty("Location");
    expect(Object.keys(operation("GET", address).responses)).toEqual(
      expect.arrayContaining(["200", "400", "404"]),
    );
    // A project has at most one case study: a second create is a conflict.
    expect(Object.keys(operation("POST", address).responses)).toEqual(
      expect.arrayContaining(["201", "400", "401", "404", "409"]),
    );
    expect(Object.keys(operation("PATCH", address).responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "404"]),
    );
    expect(Object.keys(operation("DELETE", address).responses)).toEqual(
      expect.arrayContaining(["204", "400", "401", "404"]),
    );
    for (const method of ["POST", "PATCH", "DELETE"]) {
      expect(operation(method, address).security).toEqual([{ bearerAuth: [] }]);
    }
    expect(operation("GET", address).parameters).toEqual([
      expect.objectContaining({ name: "slug", in: "path", required: true }),
    ]);
    // A project carries its case study, or null; so does every project of an experience.
    expect(document.components.schemas["Project"]?.properties).toHaveProperty("caseStudy");
  });

  it("documents the explorations from their contract schemas", () => {
    expect(operation("GET", "/v1/explorations").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/ExplorationList" } },
    });
    expect(operation("GET", "/v1/explorations/:slug").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/Exploration" } },
    });
    expect(operation("POST", "/v1/explorations").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/ExplorationCreate" } },
    });
    expect(operation("PATCH", "/v1/explorations/:slug").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/ExplorationUpdate" } },
    });
    expect(operation("POST", "/v1/explorations").responses["201"]?.headers).toHaveProperty(
      "Location",
    );
    expect(Object.keys(operation("POST", "/v1/explorations").responses)).toEqual(
      expect.arrayContaining(["201", "400", "401", "409"]),
    );
    expect(Object.keys(operation("PATCH", "/v1/explorations/:slug").responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "404"]),
    );
    expect(Object.keys(operation("DELETE", "/v1/explorations/:slug").responses)).toEqual(
      expect.arrayContaining(["204", "400", "401", "404"]),
    );
    expect(operation("GET", "/v1/explorations").security).toEqual([]);
    expect(operation("GET", "/v1/explorations/:slug").parameters).toEqual([
      expect.objectContaining({ name: "slug", in: "path", required: true }),
    ]);
    // A topic an exploration links is not deleted: the delete may be a conflict.
    expect(Object.keys(operation("DELETE", "/v1/topics/:slug").responses)).toEqual(
      expect.arrayContaining(["204", "404", "409"]),
    );
    // Every defined status is documented, and an exploration names no experience or project.
    const exploration = document.components.schemas["Exploration"]?.properties ?? {};
    expect(exploration["status"]).toMatchObject({ enum: ["built", "tested", "designed"] });
    expect(exploration).not.toHaveProperty("experience");
    expect(exploration).not.toHaveProperty("project");
  });

  it("documents the services and their typed evidence from the contract schemas", () => {
    expect(operation("GET", "/v1/services").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/ServiceList" } },
    });
    expect(operation("GET", "/v1/services/:slug").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/Service" } },
    });
    expect(operation("POST", "/v1/services").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/ServiceCreate" } },
    });
    expect(operation("PATCH", "/v1/services/:slug").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/ServiceUpdate" } },
    });
    expect(operation("POST", "/v1/services").responses["201"]?.headers).toHaveProperty("Location");
    expect(Object.keys(operation("POST", "/v1/services").responses)).toEqual(
      expect.arrayContaining(["201", "400", "401", "409"]),
    );
    expect(Object.keys(operation("PATCH", "/v1/services/:slug").responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "404"]),
    );
    expect(Object.keys(operation("DELETE", "/v1/services/:slug").responses)).toEqual(
      expect.arrayContaining(["204", "400", "401", "404"]),
    );
    for (const [method, path] of [
      ["POST", "/v1/services"],
      ["PATCH", "/v1/services/:slug"],
      ["DELETE", "/v1/services/:slug"],
    ] as const) {
      expect(operation(method, path).security).toEqual([{ bearerAuth: [] }]);
    }
    expect(operation("GET", "/v1/services").security).toEqual([]);
    expect(operation("GET", "/v1/services/:slug").parameters).toEqual([
      expect.objectContaining({ name: "slug", in: "path", required: true }),
    ]);
    // A project or an exploration a service names is not deleted: the delete may be a conflict.
    for (const path of ["/v1/projects/:slug", "/v1/explorations/:slug"]) {
      expect(Object.keys(operation("DELETE", path).responses)).toEqual(
        expect.arrayContaining(["204", "404", "409"]),
      );
    }
    // The evidence is a union discriminated by its kind, never an untyped payload.
    for (const id of ["ServiceEvidence", "ServiceEvidenceInput"]) {
      expect(document.components.schemas[id]).toMatchObject({
        discriminator: { propertyName: "kind" },
      });
    }
  });

  it("documents the education records from their contract schemas", () => {
    expect(operation("GET", "/v1/education").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/EducationList" } },
    });
    expect(operation("GET", "/v1/education/:slug").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/Education" } },
    });
    expect(operation("POST", "/v1/education").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/EducationCreate" } },
    });
    expect(operation("PATCH", "/v1/education/:slug").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/EducationUpdate" } },
    });
    expect(operation("POST", "/v1/education").responses["201"]?.headers).toHaveProperty("Location");
    expect(Object.keys(operation("POST", "/v1/education").responses)).toEqual(
      expect.arrayContaining(["201", "400", "401", "409"]),
    );
    expect(Object.keys(operation("PATCH", "/v1/education/:slug").responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "404"]),
    );
    expect(Object.keys(operation("DELETE", "/v1/education/:slug").responses)).toEqual(
      expect.arrayContaining(["204", "400", "401", "404"]),
    );
    // Nothing refers to an education record, so its delete is never a conflict.
    expect(operation("DELETE", "/v1/education/:slug").responses).not.toHaveProperty("409");
    for (const [method, path] of [
      ["POST", "/v1/education"],
      ["PATCH", "/v1/education/:slug"],
      ["DELETE", "/v1/education/:slug"],
    ] as const) {
      expect(operation(method, path).security).toEqual([{ bearerAuth: [] }]);
    }
    expect(operation("GET", "/v1/education").security).toEqual([]);
    expect(operation("GET", "/v1/education/:slug").parameters).toEqual([
      expect.objectContaining({ name: "slug", in: "path", required: true }),
    ]);
    // Every defined kind is documented, and both dates may be null.
    const education = document.components.schemas["Education"]?.properties ?? {};
    expect(education["kind"]).toMatchObject({
      enum: ["school", "course", "certification", "milestone"],
    });
    for (const date of ["startedOn", "endedOn"]) {
      expect(JSON.stringify(education[date])).toContain('"null"');
    }
  });

  it("documents the testimonials from their contract schemas and embeds them in experiences", () => {
    expect(operation("GET", "/v1/testimonials").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/TestimonialList" } },
    });
    expect(operation("GET", "/v1/testimonials/:slug").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/Testimonial" } },
    });
    expect(operation("POST", "/v1/testimonials").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/TestimonialCreate" } },
    });
    expect(operation("PATCH", "/v1/testimonials/:slug").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/TestimonialUpdate" } },
    });
    expect(operation("POST", "/v1/testimonials").responses["201"]?.headers).toHaveProperty(
      "Location",
    );
    expect(Object.keys(operation("POST", "/v1/testimonials").responses)).toEqual(
      expect.arrayContaining(["201", "400", "401", "409"]),
    );
    expect(Object.keys(operation("PATCH", "/v1/testimonials/:slug").responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "404"]),
    );
    expect(Object.keys(operation("DELETE", "/v1/testimonials/:slug").responses)).toEqual(
      expect.arrayContaining(["204", "400", "401", "404"]),
    );
    // Nothing refers to a testimonial, so its delete is never a conflict.
    expect(operation("DELETE", "/v1/testimonials/:slug").responses).not.toHaveProperty("409");
    for (const [method, path] of [
      ["POST", "/v1/testimonials"],
      ["PATCH", "/v1/testimonials/:slug"],
      ["DELETE", "/v1/testimonials/:slug"],
    ] as const) {
      expect(operation(method, path).security).toEqual([{ bearerAuth: [] }]);
    }
    expect(operation("GET", "/v1/testimonials").security).toEqual([]);
    expect(operation("GET", "/v1/testimonials/:slug").parameters).toEqual([
      expect.objectContaining({ name: "slug", in: "path", required: true }),
    ]);
    // An experience carries its testimonials.
    const experience = document.components.schemas["Experience"];
    expect(experience?.required).toContain("testimonials");
    expect(JSON.stringify(experience?.properties?.["testimonials"])).toContain(
      "#/components/schemas/Testimonial",
    );
  });

  it("documents the current focus from its contract schemas", () => {
    expect(operation("GET", "/v1/current-focus").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/CurrentFocusList" } },
    });
    expect(operation("GET", "/v1/current-focus/:slug").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/CurrentFocus" } },
    });
    expect(operation("POST", "/v1/current-focus").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/CurrentFocusCreate" } },
    });
    expect(operation("PATCH", "/v1/current-focus/:slug").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/CurrentFocusUpdate" } },
    });
    expect(operation("POST", "/v1/current-focus").responses["201"]?.headers).toHaveProperty(
      "Location",
    );
    expect(Object.keys(operation("POST", "/v1/current-focus").responses)).toEqual(
      expect.arrayContaining(["201", "400", "401", "409"]),
    );
    expect(Object.keys(operation("PATCH", "/v1/current-focus/:slug").responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "404"]),
    );
    expect(Object.keys(operation("DELETE", "/v1/current-focus/:slug").responses)).toEqual(
      expect.arrayContaining(["204", "400", "401", "404"]),
    );
    // Nothing refers to a focus entry, so its delete is never a conflict.
    expect(operation("DELETE", "/v1/current-focus/:slug").responses).not.toHaveProperty("409");
    for (const [method, path] of [
      ["POST", "/v1/current-focus"],
      ["PATCH", "/v1/current-focus/:slug"],
      ["DELETE", "/v1/current-focus/:slug"],
    ] as const) {
      expect(operation(method, path).security).toEqual([{ bearerAuth: [] }]);
    }
    expect(operation("GET", "/v1/current-focus").security).toEqual([]);
    expect(operation("GET", "/v1/current-focus/:slug").parameters).toEqual([
      expect.objectContaining({ name: "slug", in: "path", required: true }),
    ]);
    // The project is resolved and may be null; the link may be null.
    const focus = document.components.schemas["CurrentFocus"];
    expect(focus?.required).toEqual(expect.arrayContaining(["project", "topics", "link"]));
    expect(JSON.stringify(focus?.properties?.["project"])).toContain(
      "#/components/schemas/CurrentFocusProject",
    );
    for (const nullable of ["project", "link"]) {
      expect(JSON.stringify(focus?.properties?.[nullable])).toContain('"null"');
    }
  });

  it("documents the media routes, the multipart upload and the binary files", () => {
    expect(operation("GET", "/v1/media").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/MediaList" } },
    });
    expect(operation("GET", "/v1/media/:id").responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/Media" } },
    });
    expect(operation("POST", "/v1/media").requestBody?.content).toEqual({
      "multipart/form-data": { schema: { $ref: "#/components/schemas/MediaUpload" } },
    });
    expect(document.components.schemas["MediaUpload"]?.additionalProperties).toBe(false);
    expect(operation("POST", "/v1/media").security).toEqual([{ bearerAuth: [] }]);
    expect(operation("POST", "/v1/media").responses["201"]?.headers).toHaveProperty("Location");
    expect(Object.keys(operation("POST", "/v1/media").responses)).toEqual(
      expect.arrayContaining(["201", "400", "401", "413", "415", "429"]),
    );
    expect(operation("PATCH", "/v1/media/:id").requestBody?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/MediaUpdate" } },
    });
    // Attached media is not deleted: the delete answers with a conflict.
    expect(Object.keys(operation("DELETE", "/v1/media/:id").responses)).toEqual(
      expect.arrayContaining(["204", "400", "404", "409"]),
    );
    const file = operation("GET", "/v1/media/files/:key{.+}");
    expect(file.security).toEqual([]);
    expect(file.parameters).toEqual([
      expect.objectContaining({ name: "key", in: "path", required: true }),
    ]);
    const binary = { schema: { type: "string", format: "binary" } };
    expect(file.responses["200"]?.content).toEqual({
      "image/png": binary,
      "image/jpeg": binary,
      "image/webp": binary,
      "application/pdf": binary,
    });
    expect(Object.keys(file.responses)).toEqual(expect.arrayContaining(["200", "404", "429"]));
  });

  it("documents the public assembled CV from its contract schemas", () => {
    const read = operation("GET", "/v1/cv");

    expect(read.security).toEqual([]);
    expect(read.responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/Cv" } },
    });
    expect(Object.keys(read.responses)).toContain("404");
    expect(Object.keys(document.components.schemas["Cv"]?.properties ?? {}).sort()).toEqual(
      Object.keys(CvSchema.shape).sort(),
    );
    expect(document.components.schemas).toHaveProperty("CvExploration");
    expect(document.paths["/v1/cv"]).toEqual({ get: read });
  });

  it("documents the roadmap tree and its private writes from their contract schemas", () => {
    const read = operation("GET", "/v1/roadmap");
    expect(read.security).toEqual([]);
    expect(read.responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/Roadmap" } },
    });
    for (const [kind, schema] of [
      ["areas", "RoadmapArea"],
      ["modules", "RoadmapModule"],
      ["resources", "RoadmapResource"],
    ] as const) {
      const list = `/v1/roadmap/${kind}`;
      const item = `/v1/roadmap/${kind}/:slug`;
      expect(operation("GET", item).security).toEqual([]);
      expect(operation("GET", item).responses["200"]?.content).toEqual({
        "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
      });
      expect(operation("POST", list).requestBody?.content).toEqual({
        "application/json": { schema: { $ref: `#/components/schemas/${schema}Create` } },
      });
      expect(operation("PATCH", item).requestBody?.content).toEqual({
        "application/json": { schema: { $ref: `#/components/schemas/${schema}Update` } },
      });
      expect(operation("POST", list).responses["201"]?.headers).toHaveProperty("Location");
      expect(Object.keys(operation("POST", list).responses)).toEqual(
        expect.arrayContaining(["201", "400", "401", "409"]),
      );
      expect(Object.keys(operation("PATCH", item).responses)).toEqual(
        expect.arrayContaining(["200", "400", "401", "404"]),
      );
      for (const [method, path] of [
        ["POST", list],
        ["PATCH", item],
        ["DELETE", item],
      ] as const) {
        expect(operation(method, path).security).toEqual([{ bearerAuth: [] }]);
      }
    }
    // A parent with children cannot be deleted; a resource has nothing referring to it yet.
    for (const kind of ["areas", "modules"]) {
      expect(Object.keys(operation("DELETE", `/v1/roadmap/${kind}/:slug`).responses)).toEqual(
        expect.arrayContaining(["204", "400", "401", "404", "409"]),
      );
    }
    // Progress is derived and documented as such.
    expect(document.components.schemas).toHaveProperty("RoadmapProgress");
    expect(document.components.schemas).toHaveProperty("RoadmapSummary");
  });

  it("documents the public roadmap detail and current-learning reads", () => {
    for (const [path, schema, params] of [
      ["/v1/roadmap/tree/:area", "RoadmapAreaDetail", ["area"]],
      ["/v1/roadmap/tree/:area/:module", "RoadmapModuleDetail", ["area", "module"]],
      ["/v1/roadmap/current", "RoadmapCurrent", []],
    ] as const) {
      const read = operation("GET", path);
      expect(read.security, path).toEqual([]);
      expect(read.responses["200"]?.content).toEqual({
        "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
      });
      expect(read.parameters?.map(({ name, in: where }) => [name, where]) ?? []).toEqual(
        params.map((name) => [name, "path"]),
      );
      expect(Object.keys(document.paths[path.replace(/:([a-z]+)/g, "{$1}")] ?? {})).toEqual([
        "get",
      ]);
    }
    for (const path of ["/v1/roadmap/tree/:area", "/v1/roadmap/tree/:area/:module"]) {
      expect(Object.keys(operation("GET", path).responses)).toEqual(
        expect.arrayContaining(["200", "400", "404"]),
      );
    }
    expect(Object.keys(operation("GET", "/v1/roadmap/current").responses)).not.toContain("404");
    expect(document.components.schemas).toHaveProperty("RoadmapCurrentArea");
    expect(document.components.schemas).toHaveProperty("RoadmapCurrentModule");
  });

  it("documents the public diary reads and its private notes and time-entry writes", () => {
    const content = (schema: string) => ({
      "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
    });
    expect(operation("GET", "/v1/roadmap/diary").security).toEqual([]);
    expect(operation("GET", "/v1/roadmap/diary").responses["200"]?.content).toEqual(
      content("Diary"),
    );
    const day = operation("GET", "/v1/roadmap/diary/:date");
    expect(day.security).toEqual([]);
    expect(day.responses["200"]?.content).toEqual(content("DiaryDay"));
    expect(Object.keys(day.responses)).toEqual(expect.arrayContaining(["400", "404"]));

    const notes = operation("PATCH", "/v1/roadmap/diary/:date");
    expect(notes.requestBody?.content).toEqual(content("DiaryNotesWrite"));
    expect(notes.responses["200"]?.content).toEqual(content("DiaryDay"));
    expect(Object.keys(operation("DELETE", "/v1/roadmap/diary/:date").responses)).toEqual(
      expect.arrayContaining(["204", "401", "404"]),
    );

    const create = operation("POST", "/v1/roadmap/time-entries");
    expect(create.requestBody?.content).toEqual(content("TimeEntryCreate"));
    expect(create.responses["201"]?.content).toEqual(content("TimeEntryWrite"));
    expect(Object.keys(create.responses)).toEqual(
      expect.arrayContaining(["201", "400", "401", "409"]),
    );
    const update = operation("PATCH", "/v1/roadmap/time-entries/:id");
    expect(update.requestBody?.content).toEqual(content("TimeEntryUpdate"));
    expect(update.responses["200"]?.content).toEqual(content("TimeEntryWrite"));
    expect(Object.keys(update.responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "404", "409"]),
    );
    expect(Object.keys(operation("DELETE", "/v1/roadmap/time-entries/:id").responses)).toEqual(
      expect.arrayContaining(["204", "401", "404"]),
    );
    for (const [method, path] of [
      ["PATCH", "/v1/roadmap/diary/:date"],
      ["DELETE", "/v1/roadmap/diary/:date"],
      ["POST", "/v1/roadmap/time-entries"],
      ["PATCH", "/v1/roadmap/time-entries/:id"],
      ["DELETE", "/v1/roadmap/time-entries/:id"],
    ] as const) {
      expect(operation(method, path).security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
    }
  });

  it("documents the public bookshelf reads and its private book writes", () => {
    const content = (schema: string) => ({
      "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
    });
    const list = operation("GET", "/v1/roadmap/books");
    expect(list.security).toEqual([]);
    expect(list.responses["200"]?.content).toEqual(content("RoadmapBookList"));
    const item = operation("GET", "/v1/roadmap/books/:slug");
    expect(item.security).toEqual([]);
    expect(item.responses["200"]?.content).toEqual(content("RoadmapBook"));
    expect(Object.keys(item.responses)).toEqual(expect.arrayContaining(["400", "404"]));

    const create = operation("POST", "/v1/roadmap/books");
    expect(create.requestBody?.content).toEqual(content("RoadmapBookCreate"));
    expect(create.responses["201"]?.content).toEqual(content("RoadmapBook"));
    expect(create.responses["201"]?.headers).toHaveProperty("Location");
    expect(Object.keys(create.responses)).toEqual(
      expect.arrayContaining(["201", "400", "401", "409"]),
    );
    const update = operation("PATCH", "/v1/roadmap/books/:slug");
    expect(update.requestBody?.content).toEqual(content("RoadmapBookUpdate"));
    expect(Object.keys(update.responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "404"]),
    );
    expect(Object.keys(operation("DELETE", "/v1/roadmap/books/:slug").responses)).toEqual(
      expect.arrayContaining(["204", "401", "404", "409"]),
    );
    for (const [method, path] of [
      ["POST", "/v1/roadmap/books"],
      ["PATCH", "/v1/roadmap/books/:slug"],
      ["DELETE", "/v1/roadmap/books/:slug"],
    ] as const) {
      expect(operation(method, path).security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
    }
    expect(document.components.schemas).toHaveProperty("RoadmapBookResource");
  });

  it("documents the public event reads and its private event writes", () => {
    const content = (schema: string) => ({
      "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
    });
    const list = operation("GET", "/v1/roadmap/events");
    expect(list.security).toEqual([]);
    expect(list.responses["200"]?.content).toEqual(content("RoadmapEventList"));
    const item = operation("GET", "/v1/roadmap/events/:slug");
    expect(item.security).toEqual([]);
    expect(item.responses["200"]?.content).toEqual(content("RoadmapEvent"));
    expect(Object.keys(item.responses)).toEqual(expect.arrayContaining(["400", "404"]));

    const create = operation("POST", "/v1/roadmap/events");
    expect(create.requestBody?.content).toEqual(content("RoadmapEventCreate"));
    expect(create.responses["201"]?.content).toEqual(content("RoadmapEvent"));
    expect(create.responses["201"]?.headers).toHaveProperty("Location");
    expect(Object.keys(create.responses)).toEqual(
      expect.arrayContaining(["201", "400", "401", "409"]),
    );
    const update = operation("PATCH", "/v1/roadmap/events/:slug");
    expect(update.requestBody?.content).toEqual(content("RoadmapEventUpdate"));
    expect(update.responses["200"]?.content).toEqual(content("RoadmapEvent"));
    expect(Object.keys(update.responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "404", "409"]),
    );
    expect(Object.keys(operation("DELETE", "/v1/roadmap/events/:slug").responses)).toEqual(
      expect.arrayContaining(["204", "401", "404", "409"]),
    );
    for (const [method, path] of [
      ["POST", "/v1/roadmap/events"],
      ["PATCH", "/v1/roadmap/events/:slug"],
      ["DELETE", "/v1/roadmap/events/:slug"],
    ] as const) {
      expect(operation(method, path).security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
    }
    expect(document.components.schemas).toHaveProperty("DiaryEvent");
  });

  it("documents the learning statistics as one public read without parameters", () => {
    const read = operation("GET", "/v1/roadmap/statistics");
    expect(read.operationId).toBe("getRoadmapStatistics");
    expect(read.security).toEqual([]);
    expect(read.parameters ?? []).toEqual([]);
    expect(read.responses["200"]?.content).toEqual({
      "application/json": { schema: { $ref: "#/components/schemas/RoadmapStatistics" } },
    });
    for (const component of [
      "LearningTimeTotals",
      "LearningTimeDay",
      "LearningTimeWeek",
      "LearningTimeMonth",
      "LearningTimeArea",
      "LearningTimeModule",
      "LearningTimeResource",
      "LearningTimeEvent",
    ]) {
      expect(document.components.schemas, component).toHaveProperty(component);
    }
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
