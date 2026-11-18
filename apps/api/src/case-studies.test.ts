import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CaseStudySchema, ExperienceSchema, ProjectSchema } from "@sebela/contracts";

import type { WriteEvent } from "./app.js";
import {
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  testConfig,
  type TestBackend,
} from "./test-support.js";

/** The fictional narrative of a fictional project. */
const narrative = {
  role: "Lead engineer of a team of four.",
  body: "## Context\n\nDispatchers planned **every** route by hand.\n\n<b>kept as written</b>",
};

const ADDRESS = "/v1/projects/routing-engine/case-study";

/**
 * The documented request-body limit (`.env.example`), so the longest allowed narrative is proven
 * to fit what a deployment accepts; the shared test limit is smaller.
 */
const documented = parseEnv(
  readFileSync(new URL("../../../.env.example", import.meta.url), "utf8"),
);
const config = testConfig({ bodyLimitBytes: Number(documented["API_BODY_LIMIT_BYTES"]) });

interface FieldError {
  path: string;
  message: string;
}

describe("the case-study API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("case-study routes")).key);
    const { profile } = backend.services;
    await profile.createOrganization({
      logoId: null,
      slug: "northwind",
      name: "Northwind",
      website: null,
      description: null,
    });
    await profile.createExperience({
      slug: "northwind-lead",
      organization: "northwind",
      title: "Engineer",
      kind: "main_job",
      startedOn: "2021-03-01",
      endedOn: null,
      summary: "A fictional role.",
      responsibilities: [],
      inCv: true,
      technologies: [],
    });
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { profile } = backend.services;
    for (const { slug, caseStudy } of await profile.listProjects()) {
      if (caseStudy) await profile.deleteCaseStudy(slug);
      await profile.deleteProject(slug);
    }
    for (const [position, slug] of ["routing-engine", "fleet-dashboard"].entries()) {
      await profile.createProject({
        coverId: null,
        slug,
        experience: "northwind-lead",
        name: slug,
        summary: "A fictional project.",
        problem: "A fictional problem.",
        workDone: "Fictional work.",
        result: "A fictional result.",
        startedOn: "2022-01-01",
        endedOn: null,
        links: [],
        selectedForHomepage: true,
        position,
        technologies: [],
      });
    }
  });

  const request = async (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api({ config }).app.request(path, { method, ...init }, connection());
  const create = (body: object, path = ADDRESS) => request(path, "POST", json(body, auth));

  it("creates the case study at its project's address and reads it publicly", async () => {
    const created = await create(narrative);

    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe(ADDRESS);
    const body = CaseStudySchema.parse(await created.json());
    // The markdown is stored and returned as written; nothing is rendered.
    expect(body).toMatchObject({ project: "routing-engine", ...narrative });
    expect(Object.keys(body).sort()).toEqual(
      ["id", "project", "role", "body", "createdAt", "updatedAt"].sort(),
    );

    const read = await request(ADDRESS);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(body);
  });

  it("accepts a body of the longest allowed length", async () => {
    const response = await create({ ...narrative, body: "x".repeat(50_000) });

    expect(response.status).toBe(201);
  });

  it("accepts the longest narrative written in multi-byte characters", async () => {
    // "€" is three bytes in UTF-8, the most a single UTF-16 character takes, so this is the largest
    // narrative the contract allows that JSON does not escape.
    const response = await create({ role: "€".repeat(500), body: "€".repeat(50_000) });

    expect(response.status).toBe(201);
  });

  it("delivers the case study with its project and the experience that owns it", async () => {
    const caseStudy = CaseStudySchema.parse(await (await create(narrative)).json());

    const project = ProjectSchema.parse(
      await (await request("/v1/projects/routing-engine")).json(),
    );
    expect(project.caseStudy).toEqual(caseStudy);
    const other = ProjectSchema.parse(await (await request("/v1/projects/fleet-dashboard")).json());
    expect(other.caseStudy).toBeNull();
    const listed = (await (await request("/v1/projects")).json()) as { caseStudy: unknown }[];
    expect(listed.map((entry) => entry.caseStudy)).toEqual([caseStudy, null]);
    const experience = ExperienceSchema.parse(
      await (await request("/v1/experiences/northwind-lead")).json(),
    );
    expect(experience.projects.map((entry) => entry.caseStudy)).toEqual([caseStudy, null]);
  });

  it("refuses a second case study of the same project with a conflict", async () => {
    const first = CaseStudySchema.parse(await (await create(narrative)).json());

    const second = await create({ ...narrative, role: "Another role" });

    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: { code: "conflict", message: anyText } });
    expect(await (await request(ADDRESS)).json()).toEqual(first);
  });

  it("keeps exactly one of competing creates", async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        create({ ...narrative, role: `Role ${String(index)}` }),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409, 409, 409]);
  });

  it("answers an unknown project or a missing case study with not found", async () => {
    for (const response of [
      await request(ADDRESS),
      await request("/v1/projects/missing/case-study"),
      await create(narrative, "/v1/projects/missing/case-study"),
      await request(ADDRESS, "PATCH", json({ role: "X" }, auth)),
      await request("/v1/projects/missing/case-study", "PATCH", json({ role: "X" }, auth)),
      await request(ADDRESS, "DELETE", { headers: auth }),
      await request("/v1/projects/missing/case-study", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: anyText } });
    }
  });

  it.each([
    ["a missing role", { body: narrative.body }, "role"],
    ["a missing body", { role: narrative.role }, "body"],
    ["an empty body", { ...narrative, body: "" }, "body"],
    ["an overlong body", { ...narrative, body: "x".repeat(50_001) }, "body"],
    ["an overlong role", { ...narrative, role: "x".repeat(501) }, "role"],
    ["a non-text body", { ...narrative, body: 42 }, "body"],
    ["an unknown field", { ...narrative, html: "<p>x</p>" }, "html"],
    ["a project in the body", { ...narrative, project: "fleet-dashboard" }, "project"],
  ])("refuses %s with the field and stores nothing", async (_, body, field) => {
    const response = await create(body);

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe("validation_failed");
    // A known field is named by its path; an unknown one by the message.
    expect(
      error.fields?.some(({ path, message }) => path === field || message.includes(`"${field}"`)),
    ).toBe(true);
    expect((await request(ADDRESS)).status).toBe(404);
  });

  it("refuses a malformed project slug in the path with the field", async () => {
    for (const response of [
      await request("/v1/projects/Not%20A%20Slug/case-study"),
      await request("/v1/projects/UPPER/case-study", "POST", json(narrative, auth)),
      await request("/v1/projects/routing.engine/case-study", "PATCH", json({ role: "X" }, auth)),
      await request("/v1/projects/UPPER/case-study", "DELETE", { headers: auth }),
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

  it("checks the key before the path and the body, and writes nothing", async () => {
    expect((await request(ADDRESS, "POST", json(narrative))).status).toBe(401);
    expect((await request("/v1/projects/UPPER/case-study", "POST", json({}))).status).toBe(401);
    await create(narrative);
    expect((await request(ADDRESS, "PATCH", json({ role: "X" }))).status).toBe(401);
    expect((await request(ADDRESS, "DELETE")).status).toBe(401);
    await expect(backend.services.profile.getCaseStudy("routing-engine")).resolves.toMatchObject(
      narrative,
    );
  });

  it("updates only the given fields and advances updatedAt", async () => {
    const created = CaseStudySchema.parse(await (await create(narrative)).json());

    const response = await request(ADDRESS, "PATCH", json({ body: "Shorter." }, auth));

    expect(response.status).toBe(200);
    const updated = CaseStudySchema.parse(await response.json());
    expect(updated).toEqual({
      ...created,
      body: "Shorter.",
      updatedAt: expect.any(String) as unknown,
    });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("refuses an empty or unknown update with the field and changes nothing", async () => {
    const created = CaseStudySchema.parse(await (await create(narrative)).json());

    for (const body of [{}, { role: "" }, { project: "fleet-dashboard" }]) {
      const response = await request(ADDRESS, "PATCH", json(body, auth));
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "validation_failed",
      );
    }
    expect(await (await request(ADDRESS)).json()).toEqual(created);
  });

  it("refuses to delete a project with a case study, and keeps both", async () => {
    const caseStudy = CaseStudySchema.parse(await (await create(narrative)).json());

    const response = await request("/v1/projects/routing-engine", "DELETE", { headers: auth });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "conflict", message: anyText } });
    expect(await (await request(ADDRESS)).json()).toEqual(caseStudy);
  });

  it("deletes the case study with the key, keeps the project, and reports each write", async () => {
    const events: WriteEvent[] = [];
    const { app } = backend.api({
      config,
      onWrite: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });
    await app.request(ADDRESS, { method: "POST", ...json(narrative, auth) }, connection());

    const deleted = await app.request(ADDRESS, { method: "DELETE", headers: auth }, connection());

    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(events).toEqual([
      {
        operationId: "createCaseStudy",
        method: "POST",
        path: ADDRESS,
        change: { domain: "case-study", record: "routing-engine", action: "created" },
      },
      {
        operationId: "deleteCaseStudy",
        method: "DELETE",
        path: ADDRESS,
        change: { domain: "case-study", record: "routing-engine", action: "deleted" },
      },
    ]);
    expect((await request(ADDRESS)).status).toBe(404);
    const project = ProjectSchema.parse(
      await (await request("/v1/projects/routing-engine")).json(),
    );
    expect(project.caseStudy).toBeNull();
    expect((await request("/v1/projects/routing-engine", "DELETE", { headers: auth })).status).toBe(
      204,
    );
  });
});
