// Consumer contract tests: the generated `@sebela/api-client` calls the real app over a temporary
// database, exactly as a server-side consumer would, and handles every documented outcome through
// the contract's types. A route change regenerates the client and extends these cases.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createApiClient,
  type ApiClient,
  type Cv,
  type Diary,
  type DiaryDay,
  type DiaryEvent,
  type ErrorResponse,
  type MediaUpload,
  type Roadmap,
  type RoadmapAreaDetail,
  type RoadmapBook,
  type RoadmapBookList,
  type RoadmapBookStatus,
  type RoadmapCurrent,
  type RoadmapEvent,
  type RoadmapEventKind,
  type RoadmapEventList,
  type RoadmapModuleDetail,
  type TimeEntryWrite,
} from "@sebela/api-client";
import { samplePdf, samplePng } from "@sebela/services/testing";

import type { AppDependencies } from "./app.js";
import {
  anyText,
  connection,
  MEDIA_PUBLIC_BASE,
  openTestBackend,
  person,
  testConfig,
  type TestBackend,
} from "./test-support.js";

/** A base address from the reserved `.test` domain; requests never leave the process. */
const BASE_URL = "http://api.test";

interface Consumer {
  readonly client: ApiClient;
  /** The `Authorization` header of every request the client sent, in order. */
  readonly authorizations: (string | null)[];
}

describe("the generated API client", () => {
  let backend: TestBackend;
  let key: string;

  /** A client over a fresh app, so each case has its own rate-limit counters. */
  const consumer = (
    apiKey?: string,
    overrides: Partial<Omit<AppDependencies, "services">> = {},
  ): Consumer => {
    const { app } = backend.api(overrides);
    const authorizations: (string | null)[] = [];
    const client = createApiClient({
      baseUrl: BASE_URL,
      ...(apiKey === undefined ? {} : { apiKey }),
      fetch: async (request) => {
        authorizations.push(request.headers.get("authorization"));
        return app.fetch(request, connection());
      },
    });
    return { client, authorizations };
  };

  beforeAll(async () => {
    backend = await openTestBackend();
    ({ key } = await backend.services.apiKeys.createKey("consumer contract"));
  });

  afterAll(async () => {
    await backend.close();
  });

  it("reads the public person: not found before it exists, then the person", async () => {
    const { client, authorizations } = consumer(key);

    const missing = await client.GET("/v1/person");
    expect(missing.response.status).toBe(404);
    expect(missing.data).toBeUndefined();
    expect(missing.error).toEqual({ error: { code: "not_found", message: anyText } });

    const created = await client.POST("/v1/person", { body: person });
    expect(created.response.status).toBe(201);

    const found = await client.GET("/v1/person");
    expect(found.error).toBeUndefined();
    expect(found.data).toMatchObject(person);

    // The key goes only to the operation whose contract requires it.
    expect(authorizations).toEqual([null, `Bearer ${key}`, null]);
  });

  it("creates and updates through authenticated writes", async () => {
    const { client } = consumer(key);

    const updated = await client.PATCH("/v1/person", { body: { headline: "Platform engineer" } });
    expect(updated.response.status).toBe(200);
    expect(updated.data?.headline).toBe("Platform engineer");

    const conflict = await client.POST("/v1/person", { body: person });
    expect(conflict.response.status).toBe(409);
    expect(conflict.error?.error.code).toBe("conflict");
  });

  it("reports validation failures with their fields", async () => {
    const { client } = consumer(key);

    const invalid = await client.PATCH("/v1/person", { body: { name: "" } });
    expect(invalid.response.status).toBe(400);
    const error: ErrorResponse | undefined = invalid.error;
    expect(error?.error.code).toBe("validation_failed");
    expect(error?.error.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "name" })]),
    );
  });

  it("is refused without a key and with a wrong key", async () => {
    for (const apiKey of [undefined, "sebela_not-a-real-key"]) {
      const { client, authorizations } = consumer(apiKey);
      const refused = await client.DELETE("/v1/person");
      expect(refused.response.status).toBe(401);
      expect(refused.response.headers.get("www-authenticate")).toBe("Bearer");
      expect(refused.error?.error.code).toBe("unauthorized");
      expect(authorizations).toEqual([apiKey === undefined ? null : `Bearer ${apiKey}`]);
    }
  });

  it("reports an exhausted budget with Retry-After", async () => {
    const once = { max: 1, windowMs: 30_000 };
    const { client } = consumer(undefined, {
      config: testConfig({ rateLimits: { public: once } }),
    });

    expect((await client.GET("/v1/person")).response.status).toBe(200);
    const limited = await client.GET("/v1/person");
    expect(limited.response.status).toBe(429);
    expect(limited.response.headers.get("retry-after")).toBe("30");
    expect(limited.error?.error.code).toBe("rate_limited");
  });

  it("deletes the person with the key", async () => {
    const { client } = consumer(key);

    const deleted = await client.DELETE("/v1/person");
    expect(deleted.response.status).toBe(204);
    expect(deleted.error).toBeUndefined();
    expect((await client.GET("/v1/person")).response.status).toBe(404);
  });

  it("reads the public assembled CV: not found without a person, then its typed sections", async () => {
    const { client, authorizations } = consumer(key);

    const missing = await client.GET("/v1/cv");
    expect(missing.response.status).toBe(404);
    expect(missing.data).toBeUndefined();
    expect(missing.error).toEqual({ error: { code: "not_found", message: anyText } });

    expect((await client.POST("/v1/person", { body: person })).response.status).toBe(201);
    const found = await client.GET("/v1/cv");
    expect(found.error).toBeUndefined();
    const cv: Cv | undefined = found.data;
    expect(cv?.person).toMatchObject(person);
    expect(cv).toMatchObject({
      experiences: [],
      technologies: { primary: { core: [], aiEngineeringFocus: [] }, secondary: [] },
      education: [],
      explorations: [],
      cvPdf: null,
    });
    expect((await client.DELETE("/v1/person")).response.status).toBe(204);

    // The CV is public, so the key never goes with it.
    expect(authorizations).toEqual([null, `Bearer ${key}`, null, `Bearer ${key}`]);
  });

  it("manages the catalogs: public reads, keyed writes, path parameters and errors", async () => {
    const { client, authorizations } = consumer(key);

    const empty = await client.GET("/v1/technologies");
    expect(empty.data).toEqual([]);

    const created = await client.POST("/v1/technologies", {
      body: { slug: "fictional-tool", name: "Fictional Tool", tier: "secondary", position: 0 },
    });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("location")).toBe("/v1/technologies/fictional-tool");
    expect(created.data).toMatchObject({ group: null, logoKey: null });

    const read = await client.GET("/v1/technologies/{slug}", {
      params: { path: { slug: "fictional-tool" } },
    });
    expect(read.data?.name).toBe("Fictional Tool");

    const inconsistent = await client.PATCH("/v1/technologies/{slug}", {
      params: { path: { slug: "fictional-tool" } },
      body: { tier: "primary" },
    });
    expect(inconsistent.response.status).toBe(400);
    expect(inconsistent.error?.error.code).toBe("validation_failed");

    const deleted = await client.DELETE("/v1/technologies/{slug}", {
      params: { path: { slug: "fictional-tool" } },
    });
    expect(deleted.response.status).toBe(204);

    const missing = await client.DELETE("/v1/technologies/{slug}", {
      params: { path: { slug: "fictional-tool" } },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.error?.error.code).toBe("not_found");

    expect(authorizations).toEqual([
      null,
      `Bearer ${key}`,
      null,
      `Bearer ${key}`,
      `Bearer ${key}`,
      `Bearer ${key}`,
    ]);
  });

  it("creates, lists and refuses duplicate topics", async () => {
    const { client } = consumer(key);
    const topic = { slug: "fictional-topic", name: "Fictional Topic", position: 0 };

    expect((await client.POST("/v1/topics", { body: topic })).response.status).toBe(201);
    const duplicate = await client.POST("/v1/topics", { body: topic });
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.error?.error.code).toBe("conflict");

    const listed = await client.GET("/v1/topics");
    expect(listed.data).toEqual([expect.objectContaining({ slug: "fictional-topic" })]);

    const updated = await client.PATCH("/v1/topics/{slug}", {
      params: { path: { slug: "fictional-topic" } },
      body: { position: 2 },
    });
    expect(updated.data?.position).toBe(2);
  });

  it("manages organizations: create, duplicate, public list, update and delete", async () => {
    const { client, authorizations } = consumer(key);
    const organization = { slug: "fictional-org", name: "Fictional Org" };

    const created = await client.POST("/v1/organizations", { body: organization });
    expect(created.response.status).toBe(201);
    expect(created.data).toMatchObject({ ...organization, website: null, description: null });
    const duplicate = await client.POST("/v1/organizations", { body: organization });
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.error?.error.code).toBe("conflict");

    const listed = await client.GET("/v1/organizations");
    expect(listed.data).toEqual([expect.objectContaining({ slug: "fictional-org" })]);

    const updated = await client.PATCH("/v1/organizations/{slug}", {
      params: { path: { slug: "fictional-org" } },
      body: { website: "https://fictional-org.example.com/" },
    });
    expect(updated.data?.website).toBe("https://fictional-org.example.com/");

    const deleted = await client.DELETE("/v1/organizations/{slug}", {
      params: { path: { slug: "fictional-org" } },
    });
    expect(deleted.response.status).toBe(204);
    const missing = await client.GET("/v1/organizations/{slug}", {
      params: { path: { slug: "fictional-org" } },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.error?.error.code).toBe("not_found");

    expect(authorizations).toEqual([
      `Bearer ${key}`,
      `Bearer ${key}`,
      null,
      `Bearer ${key}`,
      `Bearer ${key}`,
      null,
    ]);
  });

  it("manages experiences: relations, current roles first, replaced links, conflicts and delete", async () => {
    const { client, authorizations } = consumer(key);
    const at = (slug: string) => ({ params: { path: { slug } } });
    await client.POST("/v1/organizations", {
      body: { slug: "fictional-employer", name: "Employer" },
    });
    for (const [position, slug] of ["fictional-lang", "fictional-db"].entries()) {
      await client.POST("/v1/technologies", {
        body: { slug, name: slug, tier: "secondary", position: position + 10 },
      });
    }
    const past = {
      slug: "fictional-past",
      title: "Engineer",
      kind: "main_job" as const,
      organization: "fictional-employer",
      startedOn: "2019-01-01",
      endedOn: "2022-12-31",
      summary: "A fictional role.",
      inCv: true,
      technologies: ["fictional-lang", "fictional-db"],
    };

    const created = await client.POST("/v1/experiences", { body: past });
    expect(created.response.status).toBe(201);
    expect(created.data?.organization.slug).toBe("fictional-employer");
    expect(created.data?.technologies.map(({ slug }) => slug)).toEqual(past.technologies);
    const duplicate = await client.POST("/v1/experiences", { body: past });
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.error?.error.code).toBe("conflict");
    const unknown = await client.POST("/v1/experiences", {
      body: { ...past, slug: "fictional-unknown", technologies: ["fictional-missing"] },
    });
    expect(unknown.response.status).toBe(400);
    expect(unknown.error?.error.fields).toEqual([
      { path: "technologies", message: expect.stringContaining("fictional-missing") as unknown },
    ]);
    await client.POST("/v1/experiences", {
      body: { ...past, slug: "fictional-current", startedOn: "2023-01-01", endedOn: null },
    });

    const listed = await client.GET("/v1/experiences");
    expect(listed.data?.map(({ slug }) => slug)).toEqual(["fictional-current", "fictional-past"]);

    const replaced = await client.PATCH("/v1/experiences/{slug}", {
      ...at("fictional-past"),
      body: { technologies: ["fictional-db"] },
    });
    expect(replaced.data?.technologies.map(({ slug }) => slug)).toEqual(["fictional-db"]);
    const linked = await client.DELETE("/v1/technologies/{slug}", at("fictional-db"));
    expect(linked.response.status).toBe(409);
    expect(linked.error?.error.code).toBe("conflict");

    for (const slug of ["fictional-past", "fictional-current"]) {
      expect((await client.DELETE("/v1/experiences/{slug}", at(slug))).response.status).toBe(204);
    }
    const missing = await client.GET("/v1/experiences/{slug}", at("fictional-past"));
    expect(missing.response.status).toBe(404);
    expect(missing.error?.error.code).toBe("not_found");

    const bearer = `Bearer ${key}`;
    expect(authorizations).toEqual([
      ...Array<string>(7).fill(bearer),
      null,
      bearer,
      bearer,
      bearer,
      bearer,
      null,
    ]);
  });

  it("manages projects: read-after-write, ordered in their experience, moved, protected and deleted", async () => {
    const { client, authorizations } = consumer(key);
    const at = (slug: string) => ({ params: { path: { slug } } });
    await client.POST("/v1/organizations", {
      body: { slug: "fictional-client", name: "Client" },
    });
    await client.POST("/v1/technologies", {
      body: { slug: "fictional-queue", name: "Queue", tier: "secondary", position: 20 },
    });
    const role = {
      title: "Engineer",
      kind: "main_job" as const,
      organization: "fictional-client",
      summary: "A fictional role.",
      inCv: true,
    };
    await client.POST("/v1/experiences", {
      body: { ...role, slug: "fictional-role", startedOn: "2020-01-01", endedOn: "2021-12-31" },
    });
    await client.POST("/v1/experiences", {
      body: { ...role, slug: "fictional-next", startedOn: "2022-01-01" },
    });
    const selected = {
      slug: "fictional-selected",
      experience: "fictional-role",
      name: "Selected project",
      summary: "A fictional project.",
      problem: "A fictional problem.",
      workDone: "Fictional work.",
      result: "A fictional result.",
      startedOn: "2020-02-01",
      endedOn: "2020-11-30",
      links: [{ label: "Repository", url: "https://example.com/selected" }],
      selectedForHomepage: true,
      position: 1,
      technologies: ["fictional-queue"],
    };

    const unselected = await client.POST("/v1/projects", {
      body: { ...selected, slug: "fictional-unselected", selectedForHomepage: false, position: 2 },
    });
    const created = await client.POST("/v1/projects", { body: selected });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("location")).toBe("/v1/projects/fictional-selected");
    expect(created.data?.technologies.map(({ slug }) => slug)).toEqual(["fictional-queue"]);
    const read = await client.GET("/v1/projects/{slug}", at("fictional-selected"));
    expect(read.data).toEqual(created.data);

    const owner = await client.GET("/v1/experiences/{slug}", at("fictional-role"));
    expect(owner.data?.projects).toEqual([created.data, unselected.data]);
    expect(owner.data?.projects.map((project) => project.selectedForHomepage)).toEqual([
      true,
      false,
    ]);

    const duplicate = await client.POST("/v1/projects", { body: selected });
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.error?.error.code).toBe("conflict");
    const orphan = await client.POST("/v1/projects", {
      body: { ...selected, slug: "fictional-orphan", experience: "fictional-missing" },
    });
    expect(orphan.response.status).toBe(400);
    expect(orphan.error?.error.fields).toEqual([
      { path: "experience", message: expect.stringContaining("fictional-missing") as unknown },
    ]);

    const moved = await client.PATCH("/v1/projects/{slug}", {
      ...at("fictional-unselected"),
      body: { experience: "fictional-next" },
    });
    expect(moved.data?.experience).toBe("fictional-next");
    const listed = await client.GET("/v1/projects");
    expect(listed.data?.map(({ slug }) => slug)).toEqual([
      "fictional-unselected",
      "fictional-selected",
    ]);
    const owning = await client.DELETE("/v1/experiences/{slug}", at("fictional-role"));
    expect(owning.response.status).toBe(409);
    expect(owning.error?.error.code).toBe("conflict");

    for (const slug of ["fictional-selected", "fictional-unselected"]) {
      expect((await client.DELETE("/v1/projects/{slug}", at(slug))).response.status).toBe(204);
    }
    const missing = await client.GET("/v1/projects/{slug}", at("fictional-selected"));
    expect(missing.response.status).toBe(404);
    expect(missing.error?.error.code).toBe("not_found");

    const bearer = `Bearer ${key}`;
    expect(authorizations).toEqual([
      ...Array<string>(6).fill(bearer),
      null,
      null,
      bearer,
      bearer,
      bearer,
      null,
      bearer,
      bearer,
      bearer,
      null,
    ]);
  });

  it("manages the case study of a project: one per project, read with the project, protected and removed", async () => {
    const { client, authorizations } = consumer(key);
    const at = (slug: string) => ({ params: { path: { slug } } });
    await client.POST("/v1/organizations", {
      body: { slug: "fictional-studio", name: "Studio" },
    });
    await client.POST("/v1/experiences", {
      body: {
        slug: "fictional-studio-lead",
        organization: "fictional-studio",
        title: "Engineer",
        kind: "main_job",
        startedOn: "2019-01-01",
        summary: "A fictional role.",
        inCv: true,
      },
    });
    await client.POST("/v1/projects", {
      body: {
        slug: "fictional-studied",
        experience: "fictional-studio-lead",
        name: "Studied project",
        summary: "A fictional project.",
        problem: "A fictional problem.",
        workDone: "Fictional work.",
        result: "A fictional result.",
        startedOn: "2019-02-01",
        position: 1,
      },
    });
    const narrative = { role: "Lead engineer", body: "## Context\n\nA **fictional** story." };

    const absent = await client.GET("/v1/projects/{slug}/case-study", at("fictional-studied"));
    expect(absent.response.status).toBe(404);
    expect(absent.error?.error.code).toBe("not_found");

    const created = await client.POST("/v1/projects/{slug}/case-study", {
      ...at("fictional-studied"),
      body: narrative,
    });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("location")).toBe(
      "/v1/projects/fictional-studied/case-study",
    );
    expect(created.data).toMatchObject({ project: "fictional-studied", ...narrative });
    const project = await client.GET("/v1/projects/{slug}", at("fictional-studied"));
    expect(project.data?.caseStudy).toEqual(created.data);

    const second = await client.POST("/v1/projects/{slug}/case-study", {
      ...at("fictional-studied"),
      body: narrative,
    });
    expect(second.response.status).toBe(409);
    expect(second.error?.error.code).toBe("conflict");
    const unknown = await client.POST("/v1/projects/{slug}/case-study", {
      ...at("fictional-unknown"),
      body: narrative,
    });
    expect(unknown.response.status).toBe(404);

    const updated = await client.PATCH("/v1/projects/{slug}/case-study", {
      ...at("fictional-studied"),
      body: { role: "Architect" },
    });
    expect(updated.data).toMatchObject({ role: "Architect", body: narrative.body });
    const protectedProject = await client.DELETE("/v1/projects/{slug}", at("fictional-studied"));
    expect(protectedProject.response.status).toBe(409);
    expect(protectedProject.error?.error.code).toBe("conflict");

    const removed = await client.DELETE("/v1/projects/{slug}/case-study", at("fictional-studied"));
    expect(removed.response.status).toBe(204);
    const kept = await client.GET("/v1/projects/{slug}", at("fictional-studied"));
    expect(kept.data?.caseStudy).toBeNull();
    expect(
      (await client.DELETE("/v1/projects/{slug}", at("fictional-studied"))).response.status,
    ).toBe(204);

    const bearer = `Bearer ${key}`;
    expect(authorizations).toEqual([
      bearer,
      bearer,
      bearer,
      null,
      bearer,
      null,
      bearer,
      bearer,
      bearer,
      bearer,
      bearer,
      null,
      bearer,
    ]);
  });

  it("manages explorations: every status kept, ordered, relations replaced, invalid refused and deleted", async () => {
    const { client, authorizations } = consumer(key);
    const at = (slug: string) => ({ params: { path: { slug } } });
    await client.POST("/v1/technologies", {
      body: { slug: "fictional-runtime", name: "Runtime", tier: "secondary", position: 20 },
    });
    for (const [position, slug] of ["fictional-agents", "fictional-retrieval"].entries()) {
      await client.POST("/v1/topics", { body: { slug, name: slug, position: position + 20 } });
    }
    const lab = {
      slug: "fictional-lab",
      name: "Lab",
      summary: "A fictional exploration.",
      status: "designed" as const,
      concepts: ["Planning", "Memory"],
      startedOn: "2025-01-01",
      position: 1,
      technologies: ["fictional-runtime"],
      topics: ["fictional-agents", "fictional-retrieval"],
    };

    const created = await client.POST("/v1/explorations", { body: lab });
    expect(created.response.status).toBe(201);
    expect(created.data?.status).toBe("designed");
    expect(created.data?.concepts).toEqual(lab.concepts);
    expect(created.data?.topics.map(({ slug }) => slug)).toEqual(lab.topics);
    const duplicate = await client.POST("/v1/explorations", { body: lab });
    expect(duplicate.error?.error.code).toBe("conflict");
    const unknown = await client.POST("/v1/explorations", {
      body: { ...lab, slug: "fictional-unknown", topics: ["fictional-missing"] },
    });
    expect(unknown.response.status).toBe(400);
    expect(unknown.error?.error.fields).toEqual([
      { path: "topics", message: expect.stringContaining("fictional-missing") as unknown },
    ]);
    await client.POST("/v1/explorations", {
      body: { ...lab, slug: "fictional-built", status: "built", position: 0, topics: [] },
    });

    const listed = await client.GET("/v1/explorations");
    expect(listed.data?.map(({ slug, status }) => [slug, status])).toEqual([
      ["fictional-built", "built"],
      ["fictional-lab", "designed"],
    ]);

    const replaced = await client.PATCH("/v1/explorations/{slug}", {
      ...at("fictional-lab"),
      body: { status: "tested", topics: ["fictional-retrieval"] },
    });
    expect(replaced.data?.status).toBe("tested");
    expect(replaced.data?.topics.map(({ slug }) => slug)).toEqual(["fictional-retrieval"]);
    expect(replaced.data?.technologies.map(({ slug }) => slug)).toEqual(lab.technologies);
    const period = await client.PATCH("/v1/explorations/{slug}", {
      ...at("fictional-lab"),
      body: { endedOn: "2024-12-31" },
    });
    expect(period.error?.error.fields).toEqual([expect.objectContaining({ path: "endedOn" })]);
    const linked = await client.DELETE("/v1/topics/{slug}", at("fictional-retrieval"));
    expect(linked.response.status).toBe(409);
    expect(linked.error?.error.code).toBe("conflict");

    for (const slug of ["fictional-lab", "fictional-built"]) {
      expect((await client.DELETE("/v1/explorations/{slug}", at(slug))).response.status).toBe(204);
    }
    const missing = await client.GET("/v1/explorations/{slug}", at("fictional-lab"));
    expect(missing.error?.error.code).toBe("not_found");

    const bearer = `Bearer ${key}`;
    expect(authorizations).toEqual([
      ...Array<string>(7).fill(bearer),
      null,
      bearer,
      bearer,
      bearer,
      bearer,
      bearer,
      null,
    ]);
  });

  it("manages services: typed evidence in order, replaced, invalid refused, targets protected and deleted", async () => {
    const { client, authorizations } = consumer(key);
    const at = (slug: string) => ({ params: { path: { slug } } });
    const { profile } = backend.services;
    await profile.createOrganization({
      logoId: null,
      slug: "fictional-harbor",
      name: "Harbor",
      website: null,
      description: null,
    });
    await profile.createExperience({
      slug: "fictional-harbor-engineer",
      organization: "fictional-harbor",
      title: "Engineer",
      kind: "main_job",
      summary: "A fictional role.",
      responsibilities: [],
      startedOn: "2020-01-01",
      endedOn: null,
      inCv: true,
      technologies: [],
    });
    await profile.createProject({
      coverId: null,
      slug: "fictional-dock-planner",
      experience: "fictional-harbor-engineer",
      name: "Dock planner",
      summary: "A fictional project.",
      problem: "A fictional problem.",
      workDone: "Fictional work.",
      result: "A fictional result.",
      startedOn: "2020-02-01",
      endedOn: null,
      links: [],
      selectedForHomepage: false,
      position: 30,
      technologies: [],
    });
    await profile.createExploration({
      slug: "fictional-sketch",
      name: "Sketch",
      summary: "A fictional exploration.",
      status: "tested",
      concepts: [],
      startedOn: "2025-01-01",
      endedOn: null,
      position: 30,
      technologies: [],
      topics: [],
    });
    const offer = {
      slug: "fictional-offer",
      name: "Offer",
      summary: "A fictional service.",
      audience: "Fictional teams.",
      deliverable: "A fictional deliverable.",
      position: 1,
      evidence: [
        { kind: "exploration" as const, exploration: "fictional-sketch" },
        { kind: "link" as const, label: "Contact", path: "/contact" },
        { kind: "project" as const, project: "fictional-dock-planner" },
      ],
    };

    const created = await client.POST("/v1/services", { body: offer });
    expect(created.response.status).toBe(201);
    expect(created.data?.evidence).toEqual([
      {
        kind: "exploration",
        exploration: {
          slug: "fictional-sketch",
          name: "Sketch",
          summary: "A fictional exploration.",
          status: "tested",
        },
      },
      { kind: "link", label: "Contact", path: "/contact" },
      {
        kind: "project",
        project: {
          slug: "fictional-dock-planner",
          name: "Dock planner",
          summary: "A fictional project.",
          experience: "fictional-harbor-engineer",
        },
      },
    ]);
    const duplicate = await client.POST("/v1/services", { body: offer });
    expect(duplicate.error?.error.code).toBe("conflict");
    const unknown = await client.POST("/v1/services", {
      body: { ...offer, slug: "fictional-unknown", evidence: [{ kind: "project", project: "x" }] },
    });
    expect(unknown.response.status).toBe(400);
    expect(unknown.error?.error.fields).toEqual([
      { path: "evidence", message: expect.stringContaining("x") as unknown },
    ]);
    await client.POST("/v1/services", {
      body: { ...offer, slug: "fictional-first", position: 0, evidence: [] },
    });

    const listed = await client.GET("/v1/services");
    expect(listed.data?.map(({ slug, evidence }) => [slug, evidence.length])).toEqual([
      ["fictional-first", 0],
      ["fictional-offer", 3],
    ]);

    const named = await client.DELETE("/v1/explorations/{slug}", at("fictional-sketch"));
    expect(named.response.status).toBe(409);
    expect(named.error?.error.code).toBe("conflict");

    const replaced = await client.PATCH("/v1/services/{slug}", {
      ...at("fictional-offer"),
      body: { evidence: [{ kind: "link", label: "Roadmap", path: "/roadmap" }] },
    });
    expect(replaced.data?.evidence).toEqual([{ kind: "link", label: "Roadmap", path: "/roadmap" }]);
    const unsafe = await client.PATCH("/v1/services/{slug}", {
      ...at("fictional-offer"),
      body: { evidence: [{ kind: "link", label: "x", path: "javascript:alert(1)" }] },
    });
    expect(unsafe.response.status).toBe(400);

    for (const slug of ["fictional-offer", "fictional-first"]) {
      expect((await client.DELETE("/v1/services/{slug}", at(slug))).response.status).toBe(204);
    }
    const missing = await client.GET("/v1/services/{slug}", at("fictional-offer"));
    expect(missing.error?.error.code).toBe("not_found");

    const bearer = `Bearer ${key}`;
    expect(authorizations).toEqual([
      ...Array<string>(4).fill(bearer),
      null,
      ...Array<string>(5).fill(bearer),
      null,
    ]);
  });

  it("manages education: flexible periods, kinds as stored, ordered, refused and deleted", async () => {
    const { client, authorizations } = consumer(key);
    const at = (slug: string) => ({ params: { path: { slug } } });
    const course = {
      slug: "fictional-course",
      kind: "course" as const,
      title: "Fictional course",
      institution: "Fictional Academy",
      startedOn: "2021-02-01",
      endedOn: null,
      description: null,
      position: 1,
    };

    const created = await client.POST("/v1/education", { body: course });
    expect(created.response.status).toBe(201);
    expect(created.data).toMatchObject(course);
    const duplicate = await client.POST("/v1/education", { body: course });
    expect(duplicate.error?.error.code).toBe("conflict");
    const undated = await client.POST("/v1/education", {
      body: { ...course, slug: "fictional-undated", startedOn: null },
    });
    expect(undated.response.status).toBe(400);
    expect(undated.error?.error.fields?.map(({ path }) => path)).toEqual(["startedOn", "endedOn"]);
    await client.POST("/v1/education", {
      body: {
        slug: "fictional-certificate",
        kind: "certification",
        title: "Fictional certificate",
        endedOn: "2022-05-14",
        position: 1,
      },
    });

    const listed = await client.GET("/v1/education");
    expect(listed.data?.map(({ slug, kind }) => [slug, kind])).toEqual([
      ["fictional-certificate", "certification"],
      ["fictional-course", "course"],
    ]);
    const read = await client.GET("/v1/education/{slug}", at("fictional-certificate"));
    expect(read.data).toMatchObject({ startedOn: null, endedOn: "2022-05-14", institution: null });

    const reversed = await client.PATCH("/v1/education/{slug}", {
      ...at("fictional-course"),
      body: { endedOn: "2020-01-01" },
    });
    expect(reversed.error?.error.fields).toEqual([expect.objectContaining({ path: "endedOn" })]);
    const finished = await client.PATCH("/v1/education/{slug}", {
      ...at("fictional-course"),
      body: { endedOn: "2021-06-30", kind: "milestone" },
    });
    expect(finished.data).toMatchObject({ kind: "milestone", endedOn: "2021-06-30" });

    for (const slug of ["fictional-course", "fictional-certificate"]) {
      expect((await client.DELETE("/v1/education/{slug}", at(slug))).response.status).toBe(204);
    }
    const missing = await client.GET("/v1/education/{slug}", at("fictional-course"));
    expect(missing.error?.error.code).toBe("not_found");

    const bearer = `Bearer ${key}`;
    expect(authorizations).toEqual([
      ...Array<string>(4).fill(bearer),
      null,
      null,
      ...Array<string>(4).fill(bearer),
      null,
    ]);
  });

  it("manages testimonials: tied to an experience, ordered, moved, refused and protecting it", async () => {
    const { client, authorizations } = consumer(key);
    const at = (slug: string) => ({ params: { path: { slug } } });
    const { profile } = backend.services;
    await profile.createOrganization({
      logoId: null,
      slug: "quarry-works",
      name: "Quarry Works",
      website: null,
      description: null,
    });
    for (const slug of ["quarry-lead", "quarry-intern"]) {
      await profile.createExperience({
        slug,
        organization: "quarry-works",
        title: "Engineer",
        kind: "main_job",
        summary: "A fictional role.",
        responsibilities: [],
        startedOn: slug === "quarry-lead" ? "2019-01-01" : "2018-01-01",
        endedOn: "2019-12-31",
        inCv: true,
        technologies: [],
      });
    }
    const quote = {
      slug: "quinn-on-quarry",
      experience: "quarry-lead",
      quote: "A fictional colleague liked the fictional work.",
      authorName: "Quinn Placeholder",
      authorRole: "Site Manager",
      position: 2,
    };

    const created = await client.POST("/v1/testimonials", { body: quote });
    expect(created.response.status).toBe(201);
    expect(created.data).toMatchObject({ ...quote, authorPhotoId: null });
    const duplicate = await client.POST("/v1/testimonials", { body: quote });
    expect(duplicate.error?.error.code).toBe("conflict");
    const orphan = await client.POST("/v1/testimonials", {
      body: { ...quote, slug: "quinn-orphan", experience: "quarry-missing" },
    });
    expect(orphan.response.status).toBe(400);
    expect(orphan.error?.error.fields?.map(({ path }) => path)).toEqual(["experience"]);
    await client.POST("/v1/testimonials", {
      body: { ...quote, slug: "quill-on-quarry", authorName: "Quill Example", position: 1 },
    });

    const lead = await client.GET("/v1/experiences/{slug}", at("quarry-lead"));
    expect(lead.data?.testimonials.map(({ slug }) => slug)).toEqual([
      "quill-on-quarry",
      "quinn-on-quarry",
    ]);
    const moved = await client.PATCH("/v1/testimonials/{slug}", {
      ...at("quinn-on-quarry"),
      body: { experience: "quarry-intern", authorRole: "Mentor" },
    });
    expect(moved.data).toMatchObject({ experience: "quarry-intern", authorRole: "Mentor" });
    const read = await client.GET("/v1/testimonials/{slug}", at("quinn-on-quarry"));
    expect(read.data).toEqual(moved.data);

    const protectedExperience = await client.DELETE("/v1/experiences/{slug}", at("quarry-intern"));
    expect(protectedExperience.error?.error.code).toBe("conflict");
    for (const slug of ["quinn-on-quarry", "quill-on-quarry"]) {
      expect((await client.DELETE("/v1/testimonials/{slug}", at(slug))).response.status).toBe(204);
    }
    const missing = await client.GET("/v1/testimonials/{slug}", at("quinn-on-quarry"));
    expect(missing.error?.error.code).toBe("not_found");
    for (const slug of ["quarry-lead", "quarry-intern"]) {
      expect((await client.DELETE("/v1/experiences/{slug}", at(slug))).response.status).toBe(204);
    }

    const bearer = `Bearer ${key}`;
    expect(authorizations).toEqual([
      ...Array<string>(4).fill(bearer),
      null,
      bearer,
      null,
      ...Array<string>(3).fill(bearer),
      null,
      ...Array<string>(2).fill(bearer),
    ]);
  });
  it("manages the current focus: optional project, ordered topics, cleared, refused and protecting them", async () => {
    const { client, authorizations } = consumer(key);
    const at = (slug: string) => ({ params: { path: { slug } } });
    const { profile } = backend.services;
    await profile.createOrganization({
      logoId: null,
      slug: "lumen-labs",
      name: "Lumen Labs",
      website: null,
      description: null,
    });
    await profile.createExperience({
      slug: "lumen-builder",
      organization: "lumen-labs",
      title: "Engineer",
      kind: "main_job",
      summary: "A fictional role.",
      responsibilities: [],
      startedOn: "2024-01-01",
      endedOn: null,
      inCv: true,
      technologies: [],
    });
    await profile.createProject({
      coverId: null,
      slug: "lumen-console",
      experience: "lumen-builder",
      name: "Lumen console",
      summary: "A fictional project.",
      problem: "A fictional problem.",
      workDone: "Fictional work.",
      result: "A fictional result.",
      startedOn: "2024-02-01",
      endedOn: null,
      links: [],
      selectedForHomepage: false,
      position: 0,
      technologies: [],
    });
    for (const [position, slug] of ["lumen-evals", "lumen-agents"].entries()) {
      await profile.createTopic({ slug, name: slug, position });
    }
    const focus = {
      slug: "lumen-harness",
      title: "A fictional harness",
      description: "Scoring **fictional** agents.",
      link: "https://example.com/lumen",
      position: 1,
      project: "lumen-console",
      topics: ["lumen-agents", "lumen-evals"],
    };

    const created = await client.POST("/v1/current-focus", { body: focus });
    expect(created.response.status).toBe(201);
    expect(created.data?.project).toEqual({
      slug: "lumen-console",
      name: "Lumen console",
      experience: "lumen-builder",
    });
    expect(created.data?.topics.map(({ slug }) => slug)).toEqual(["lumen-agents", "lumen-evals"]);
    const duplicate = await client.POST("/v1/current-focus", { body: focus });
    expect(duplicate.error?.error.code).toBe("conflict");
    const unknown = await client.POST("/v1/current-focus", {
      body: { ...focus, slug: "lumen-unknown", topics: ["lumen-missing"] },
    });
    expect(unknown.error?.error.fields?.map(({ path }) => path)).toEqual(["topics"]);
    await client.POST("/v1/current-focus", {
      body: { slug: "lumen-reading", title: "Reading", description: "A book.", position: 0 },
    });

    const listed = await client.GET("/v1/current-focus");
    expect(listed.data?.map(({ slug, project }) => [slug, project?.slug ?? null])).toEqual([
      ["lumen-reading", null],
      ["lumen-harness", "lumen-console"],
    ]);
    const cleared = await client.PATCH("/v1/current-focus/{slug}", {
      ...at("lumen-harness"),
      body: { project: null, link: null, topics: ["lumen-evals"] },
    });
    expect(cleared.data).toMatchObject({ project: null, link: null });
    expect(cleared.data?.topics.map(({ slug }) => slug)).toEqual(["lumen-evals"]);
    const read = await client.GET("/v1/current-focus/{slug}", at("lumen-harness"));
    expect(read.data).toEqual(cleared.data);

    const protectedTopic = await client.DELETE("/v1/topics/{slug}", at("lumen-evals"));
    expect(protectedTopic.error?.error.code).toBe("conflict");
    for (const slug of ["lumen-harness", "lumen-reading"]) {
      expect((await client.DELETE("/v1/current-focus/{slug}", at(slug))).response.status).toBe(204);
    }
    const missing = await client.GET("/v1/current-focus/{slug}", at("lumen-harness"));
    expect(missing.error?.error.code).toBe("not_found");

    const bearer = `Bearer ${key}`;
    expect(authorizations).toEqual([
      ...Array<string>(4).fill(bearer),
      null,
      bearer,
      null,
      ...Array<string>(3).fill(bearer),
      null,
    ]);
  });
  it("uploads, describes, attaches and deletes media through multipart and JSON operations", async () => {
    const { client, authorizations } = consumer(key);
    /** A multipart upload: the form carries the file; the typed body names it. */
    const upload = (bytes: Uint8Array, name: string, type: string, altText?: string) => {
      const body: MediaUpload = { file: name, ...(altText === undefined ? {} : { altText }) };
      return {
        body,
        bodySerializer: () => {
          const form = new FormData();
          form.set("file", new Blob([new Uint8Array(bytes)], { type }), name);
          if (altText !== undefined) form.set("altText", altText);
          return form;
        },
      };
    };
    const at = (id: string) => ({ params: { path: { id } } });

    const photo = await client.POST(
      "/v1/media",
      upload(
        samplePng({ width: 4, height: 3 }),
        "portrait.png",
        "image/png",
        "A fictional portrait",
      ),
    );
    expect(photo.response.status).toBe(201);
    expect(photo.data).toMatchObject({
      mediaType: "image/png",
      width: 4,
      height: 3,
      altText: "A fictional portrait",
    });
    const photoId = photo.data?.id ?? "";
    expect(photo.data?.url).toBe(`${MEDIA_PUBLIC_BASE}/${photo.data?.key ?? ""}`);
    const cv = await client.POST("/v1/media", upload(samplePdf(), "cv.pdf", "application/pdf"));
    expect(cv.data).toMatchObject({ mediaType: "application/pdf", width: null, height: null });
    const misleading = await client.POST("/v1/media", upload(samplePdf(), "cv.png", "image/png"));
    expect(misleading.response.status).toBe(415);
    expect(misleading.error?.error.code).toBe("unsupported_media_type");

    const listed = await client.GET("/v1/media");
    expect(listed.data?.map(({ id }) => id)).toEqual([cv.data?.id, photoId]);
    const described = await client.PATCH("/v1/media/{id}", {
      ...at(photoId),
      body: { altText: "A fictional portrait, smiling" },
    });
    expect(described.data?.altText).toBe("A fictional portrait, smiling");
    expect((await client.GET("/v1/media/{id}", at(photoId))).data).toEqual(described.data);

    const created = await client.POST("/v1/person", {
      body: { ...person, photoId, cvPdfId: cv.data?.id ?? "" },
    });
    expect(created.data).toMatchObject({ photoId, cvPdfId: cv.data?.id });
    const swapped = await client.PATCH("/v1/person", { body: { photoId: cv.data?.id ?? "" } });
    expect(swapped.error?.error.fields?.map(({ path }) => path)).toEqual(["photoId"]);
    const attached = await client.DELETE("/v1/media/{id}", at(photoId));
    expect(attached.response.status).toBe(409);
    expect(attached.error?.error.code).toBe("conflict");

    const cleared = await client.PATCH("/v1/person", { body: { photoId: null } });
    expect(cleared.data?.photoId).toBeNull();

    await backend.services.profile.createOrganization({
      logoId: null,
      slug: "avatar-works",
      name: "Avatar Works",
      website: null,
      description: null,
    });
    await backend.services.profile.createExperience({
      slug: "avatar-lead",
      organization: "avatar-works",
      title: "Engineer",
      kind: "main_job",
      summary: "A fictional role.",
      responsibilities: [],
      startedOn: "2019-01-01",
      endedOn: null,
      inCv: true,
      technologies: [],
    });
    const praised = await client.POST("/v1/testimonials", {
      body: {
        slug: "ava-on-avatars",
        experience: "avatar-lead",
        quote: "A fictional compliment.",
        authorName: "Ava Placeholder",
        authorRole: "Site Manager",
        position: 0,
        authorPhotoId: photoId,
      },
    });
    expect(praised.data?.authorPhotoId).toBe(photoId);
    const unsuitable = await client.PATCH("/v1/testimonials/{slug}", {
      params: { path: { slug: "ava-on-avatars" } },
      body: { authorPhotoId: cv.data?.id ?? "" },
    });
    expect(unsuitable.error?.error.fields?.map(({ path }) => path)).toEqual(["authorPhotoId"]);
    const unattached = await client.PATCH("/v1/testimonials/{slug}", {
      params: { path: { slug: "ava-on-avatars" } },
      body: { authorPhotoId: null },
    });
    expect(unattached.data?.authorPhotoId).toBeNull();
    await backend.services.profile.deleteTestimonial("ava-on-avatars");
    await backend.services.profile.deleteExperience("avatar-lead");
    await backend.services.profile.deleteOrganization("avatar-works");
    expect((await client.DELETE("/v1/media/{id}", at(photoId))).response.status).toBe(204);
    const missing = await client.GET("/v1/media/{id}", at(photoId));
    expect(missing.error?.error.code).toBe("not_found");
    expect((await client.DELETE("/v1/person")).response.status).toBe(204);
    expect((await client.DELETE("/v1/media/{id}", at(cv.data?.id ?? ""))).response.status).toBe(
      204,
    );

    const bearer = `Bearer ${key}`;
    expect(authorizations).toEqual([
      ...Array<string>(3).fill(bearer),
      null,
      bearer,
      null,
      ...Array<string>(8).fill(bearer),
      null,
      ...Array<string>(2).fill(bearer),
    ]);
  });

  it("manages the roadmap: one-call tree with progress, keyed writes, refusals and protected parents", async () => {
    const { client, authorizations } = consumer(key);
    const at = (slug: string) => ({ params: { path: { slug } } });
    await backend.services.profile.createTopic({
      slug: "orbit-agents",
      name: "Agents",
      position: 0,
    });

    const area = await client.POST("/v1/roadmap/areas", {
      body: { slug: "orbit-basics", name: "Orbit basics", weight: 50, position: 0 },
    });
    expect(area.response.status).toBe(201);
    expect(area.response.headers.get("location")).toBe("/v1/roadmap/areas/orbit-basics");
    const reserved = await client.POST("/v1/roadmap/areas", {
      body: { slug: "diary", name: "Diary", weight: 1, position: 1 },
    });
    expect(reserved.error?.error.fields?.map(({ path }) => path)).toEqual(["slug"]);
    const module = await client.POST("/v1/roadmap/modules", {
      body: { slug: "orbit-prompts", area: "orbit-basics", name: "Prompts", position: 0 },
    });
    expect(module.data?.area).toBe("orbit-basics");
    const orphan = await client.POST("/v1/roadmap/modules", {
      body: { slug: "orbit-orphan", area: "orbit-missing", name: "Orphan", position: 1 },
    });
    expect(orphan.error?.error.fields?.map(({ path }) => path)).toEqual(["area"]);
    const resource = await client.POST("/v1/roadmap/resources", {
      body: {
        slug: "orbit-guide",
        module: "orbit-prompts",
        name: "A fictional guide",
        type: "link",
        status: "completed",
        estimatedMinutes: 90,
        startedAt: "2025-03-01T10:00:00.000Z",
        finishedAt: "2025-03-02T10:00:00.000Z",
        link: "https://learn.example.test/orbit-guide",
        position: 0,
        topics: ["orbit-agents"],
      },
    });
    expect(resource.data?.topics.map(({ slug }) => slug)).toEqual(["orbit-agents"]);
    const skipped = await client.POST("/v1/roadmap/resources", {
      body: {
        slug: "orbit-drills",
        module: "orbit-prompts",
        name: "Drills",
        type: "project",
        status: "skipped",
        position: 1,
      },
    });
    expect(skipped.data).toMatchObject({ estimatedMinutes: null, link: null, topics: [] });
    const duplicate = await client.POST("/v1/roadmap/resources", {
      body: {
        slug: "orbit-drills",
        module: "orbit-prompts",
        name: "Drills",
        type: "project",
        position: 2,
      },
    });
    expect(duplicate.error?.error.code).toBe("conflict");

    const tree = await client.GET("/v1/roadmap");
    const roadmap: Roadmap | undefined = tree.data;
    expect(roadmap?.summary).toMatchObject({
      areaCount: 1,
      moduleCount: 1,
      resourceCount: 2,
      completed: 1,
      total: 2,
      estimatedHours: 2,
    });
    expect(roadmap?.areas[0]?.modules[0]?.progress).toMatchObject({
      status: "completed",
      completedAt: "2025-03-02T10:00:00.000Z",
    });
    expect(roadmap?.areas[0]?.modules[0]?.resources.map(({ slug }) => slug)).toEqual([
      "orbit-guide",
      "orbit-drills",
    ]);

    const areaDetail = await client.GET("/v1/roadmap/tree/{area}", {
      params: { path: { area: "orbit-basics" } },
    });
    const areaNode: RoadmapAreaDetail | undefined = areaDetail.data;
    expect(areaNode).toEqual({ area: roadmap?.areas[0] });
    const moduleDetail = await client.GET("/v1/roadmap/tree/{area}/{module}", {
      params: { path: { area: "orbit-basics", module: "orbit-prompts" } },
    });
    const moduleNode: RoadmapModuleDetail | undefined = moduleDetail.data;
    expect(moduleNode?.module).toEqual(roadmap?.areas[0]?.modules[0]);
    expect(moduleNode?.area.slug).toBe("orbit-basics");
    const unrelated = await client.GET("/v1/roadmap/tree/{area}/{module}", {
      params: { path: { area: "orbit-elsewhere", module: "orbit-prompts" } },
    });
    expect(unrelated.error?.error.code).toBe("not_found");
    const nothingCurrent = await client.GET("/v1/roadmap/current");
    const current: RoadmapCurrent | undefined = nothingCurrent.data;
    expect(current).toEqual({ areas: [] });

    const replanned = await client.PATCH("/v1/roadmap/resources/{slug}", {
      ...at("orbit-drills"),
      body: { status: "planned", estimatedMinutes: 30 },
    });
    expect(replanned.data).toMatchObject({ status: "planned", estimatedMinutes: 30 });
    const protectedArea = await client.DELETE("/v1/roadmap/areas/{slug}", at("orbit-basics"));
    expect(protectedArea.error?.error.code).toBe("conflict");
    for (const slug of ["orbit-guide", "orbit-drills"]) {
      const removed = await client.DELETE("/v1/roadmap/resources/{slug}", at(slug));
      expect(removed.response.status).toBe(204);
    }
    expect(
      (await client.DELETE("/v1/roadmap/modules/{slug}", at("orbit-prompts"))).response.status,
    ).toBe(204);
    expect(
      (await client.DELETE("/v1/roadmap/areas/{slug}", at("orbit-basics"))).response.status,
    ).toBe(204);
    const missing = await client.GET("/v1/roadmap/areas/{slug}", at("orbit-basics"));
    expect(missing.error?.error.code).toBe("not_found");
    await backend.services.profile.deleteTopic("orbit-agents");

    const bearer = `Bearer ${key}`;
    expect(authorizations).toEqual([
      ...Array<string>(7).fill(bearer),
      ...Array<null>(5).fill(null),
      ...Array<string>(6).fill(bearer),
      null,
    ]);
  });

  it("keeps the learning diary: public day reads, keyed notes and time entries, overlap refused", async () => {
    const { client, authorizations } = consumer(key);
    const { client: visitor } = consumer();
    const day = (date: string) => ({ params: { path: { date } } });
    await backend.services.roadmap.createArea({
      slug: "diary-basics",
      name: "Diary basics",
      description: null,
      weight: 10,
      position: 9,
    });
    await backend.services.roadmap.createModule({
      slug: "diary-module",
      area: "diary-basics",
      name: "Diary module",
      description: null,
      position: 0,
    });
    const resource = await client.POST("/v1/roadmap/resources", {
      body: {
        slug: "diary-guide",
        module: "diary-module",
        name: "Diary guide",
        type: "link",
        position: 0,
      },
    });
    expect(resource.response.status).toBe(201);

    const empty = await visitor.GET("/v1/roadmap/diary/{date}", day("2026-03-02"));
    expect(empty.error?.error.code).toBe("not_found");
    const notes = await client.PATCH("/v1/roadmap/diary/{date}", {
      ...day("2026-03-02"),
      body: { notes: "A *fictional* evening." },
    });
    const notesDay: DiaryDay | undefined = notes.data;
    expect(notesDay).toEqual({
      date: "2026-03-02",
      notes: "A *fictional* evening.",
      entries: [],
      totalSeconds: 0,
      events: [],
    });

    const session = {
      resource: "diary-guide",
      startedAt: "2026-03-02T23:30:00+01:00",
      endedAt: "2026-03-03T00:30:00+01:00",
    };
    const created = await client.POST("/v1/roadmap/time-entries", { body: session });
    const write: TimeEntryWrite | undefined = created.data;
    expect(created.response.status).toBe(201);
    expect(write?.dates).toEqual(["2026-03-02", "2026-03-03"]);
    const overlap = await client.POST("/v1/roadmap/time-entries", { body: session });
    expect(overlap.error?.error.code).toBe("conflict");
    const unknown = await client.POST("/v1/roadmap/time-entries", {
      body: { ...session, resource: "no-such-guide" },
    });
    expect(unknown.error?.error.fields?.map(({ path }) => path)).toEqual(["resource"]);

    const read = await visitor.GET("/v1/roadmap/diary");
    const diary: Diary | undefined = read.data;
    expect(diary?.days.map(({ date, totalSeconds }) => [date, totalSeconds])).toEqual([
      ["2026-03-03", 1800],
      ["2026-03-02", 1800],
    ]);

    const [first, second] = write?.entries ?? [];
    const moved = await client.PATCH("/v1/roadmap/time-entries/{id}", {
      params: { path: { id: first?.id ?? "" } },
      body: { startedAt: "2026-03-02T22:30:00+01:00" },
    });
    expect(moved.data?.entries.map(({ durationSeconds }) => durationSeconds)).toEqual([5400]);
    for (const entry of [first, second]) {
      const removed = await client.DELETE("/v1/roadmap/time-entries/{id}", {
        params: { path: { id: entry?.id ?? "" } },
      });
      expect(removed.response.status).toBe(204);
    }
    expect(
      (await client.DELETE("/v1/roadmap/diary/{date}", day("2026-03-02"))).response.status,
    ).toBe(204);
    expect((await visitor.GET("/v1/roadmap/diary")).data).toEqual({ days: [] });
    expect(
      (
        await client.DELETE("/v1/roadmap/resources/{slug}", {
          params: { path: { slug: "diary-guide" } },
        })
      ).response.status,
    ).toBe(204);
    await backend.services.roadmap.deleteModule("diary-module");
    await backend.services.roadmap.deleteArea("diary-basics");

    expect(authorizations.every((authorization) => authorization === `Bearer ${key}`)).toBe(true);
  });
  it("keeps the bookshelf: public reads, keyed writes, the resource link and its refusals", async () => {
    const { client, authorizations } = consumer(key);
    const { client: visitor } = consumer();
    const at = (slug: string) => ({ params: { path: { slug } } });
    await backend.services.roadmap.createArea({
      slug: "shelf-basics",
      name: "Shelf basics",
      description: null,
      weight: 10,
      position: 8,
    });
    await backend.services.roadmap.createModule({
      slug: "shelf-module",
      area: "shelf-basics",
      name: "Shelf module",
      description: null,
      position: 0,
    });

    const created = await client.POST("/v1/roadmap/books", {
      body: { slug: "shelf-patterns", title: "Fictional shelf patterns", startedOn: "2026-03-01" },
    });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("location")).toBe("/v1/roadmap/books/shelf-patterns");
    const status: RoadmapBookStatus | undefined = created.data?.status;
    expect(status).toBe("reading");
    const taken = await client.POST("/v1/roadmap/books", {
      body: { slug: "shelf-patterns", title: "Again" },
    });
    expect(taken.error?.error.code).toBe("conflict");

    const resource = await client.POST("/v1/roadmap/resources", {
      body: {
        slug: "shelf-reading",
        module: "shelf-module",
        name: "Reading shelf patterns",
        type: "book",
        position: 0,
        book: "shelf-patterns",
      },
    });
    expect(resource.data?.book).toBe("shelf-patterns");
    const wrongType = await client.POST("/v1/roadmap/resources", {
      body: {
        slug: "shelf-link",
        module: "shelf-module",
        name: "Not a book",
        type: "link",
        position: 1,
        book: "shelf-patterns",
      },
    });
    expect(wrongType.error?.error.fields?.map(({ path }) => path)).toContain("book");

    const list = await visitor.GET("/v1/roadmap/books");
    const shelf: RoadmapBookList | undefined = list.data;
    expect(shelf?.map(({ slug, resource: link }) => [slug, link?.slug])).toEqual([
      ["shelf-patterns", "shelf-reading"],
    ]);
    const finished = await client.PATCH("/v1/roadmap/books/{slug}", {
      ...at("shelf-patterns"),
      body: { endedOn: "2026-03-09" },
    });
    expect(finished.data?.status).toBe("completed");
    const read = await visitor.GET("/v1/roadmap/books/{slug}", at("shelf-patterns"));
    const book: RoadmapBook | undefined = read.data;
    expect(book).toMatchObject({ status: "completed", readingSeconds: 0, cover: null });

    const linked = await client.DELETE("/v1/roadmap/books/{slug}", at("shelf-patterns"));
    expect(linked.error?.error.code).toBe("conflict");
    expect(
      (await client.DELETE("/v1/roadmap/resources/{slug}", at("shelf-reading"))).response.status,
    ).toBe(204);
    expect(
      (await client.DELETE("/v1/roadmap/books/{slug}", at("shelf-patterns"))).response.status,
    ).toBe(204);
    const missing = await visitor.GET("/v1/roadmap/books/{slug}", at("shelf-patterns"));
    expect(missing.error?.error.code).toBe("not_found");
    await backend.services.roadmap.deleteModule("shelf-module");
    await backend.services.roadmap.deleteArea("shelf-basics");

    expect(authorizations.every((authorization) => authorization === `Bearer ${key}`)).toBe(true);
  });
  it("keeps the events: public reads, keyed writes, attendance and its refusals", async () => {
    const { client, authorizations } = consumer(key);
    const { client: visitor } = consumer();
    const at = (slug: string) => ({ params: { path: { slug } } });

    const created = await client.POST("/v1/roadmap/events", {
      body: {
        slug: "calendar-summit",
        name: "Fictional calendar summit",
        kind: "conference",
        startsOn: "2026-12-31",
        endsOn: "2027-01-01",
      },
    });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("location")).toBe("/v1/roadmap/events/calendar-summit");
    const kind: RoadmapEventKind | undefined = created.data?.kind;
    expect(kind).toBe("conference");
    const reversed = await client.POST("/v1/roadmap/events", {
      body: {
        slug: "calendar-reversed",
        name: "Reversed",
        kind: "meetup",
        startsOn: "2026-05-02",
        endsOn: "2026-05-01",
      },
    });
    expect(reversed.error?.error.fields?.map(({ path }) => path)).toContain("endsOn");
    const anonymous = await visitor.DELETE("/v1/roadmap/events/{slug}", at("calendar-summit"));
    expect(anonymous.response.status).toBe(401);

    const day = await visitor.GET("/v1/roadmap/diary/{date}", {
      params: { path: { date: "2027-01-01" } },
    });
    const shown: DiaryEvent[] | undefined = day.data?.events;
    expect(shown?.map(({ slug }) => slug)).toEqual(["calendar-summit"]);
    expect(day.data?.totalSeconds).toBe(0);

    const attended = await client.POST("/v1/roadmap/time-entries", {
      body: {
        event: "calendar-summit",
        startedAt: "2026-12-31T10:00:00+01:00",
        endedAt: "2026-12-31T11:00:00+01:00",
      },
    });
    expect(attended.data?.entries[0]?.event?.slug).toBe("calendar-summit");
    const stranding = await client.PATCH("/v1/roadmap/events/{slug}", {
      ...at("calendar-summit"),
      body: { startsOn: "2027-01-01" },
    });
    expect(stranding.error?.error.code).toBe("conflict");
    const list = await visitor.GET("/v1/roadmap/events");
    const events: RoadmapEventList | undefined = list.data;
    expect(events?.map(({ slug, attendanceSeconds }) => [slug, attendanceSeconds])).toEqual([
      ["calendar-summit", 3600],
    ]);

    for (const entry of attended.data?.entries ?? []) {
      const removed = await client.DELETE("/v1/roadmap/time-entries/{id}", {
        params: { path: { id: entry.id } },
      });
      expect(removed.response.status).toBe(204);
    }
    const renamed = await client.PATCH("/v1/roadmap/events/{slug}", {
      ...at("calendar-summit"),
      body: { name: "Renamed summit", online: true },
    });
    const event: RoadmapEvent | undefined = renamed.data;
    expect(event).toMatchObject({ name: "Renamed summit", online: true, attendanceSeconds: 0 });
    expect(
      (await client.DELETE("/v1/roadmap/events/{slug}", at("calendar-summit"))).response.status,
    ).toBe(204);
    const missing = await visitor.GET("/v1/roadmap/events/{slug}", at("calendar-summit"));
    expect(missing.error?.error.code).toBe("not_found");

    expect(authorizations.every((authorization) => authorization === `Bearer ${key}`)).toBe(true);
  });
});
