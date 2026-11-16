// Consumer contract tests: the generated `@sebela/api-client` calls the real app over a temporary
// database, exactly as a server-side consumer would, and handles every documented outcome through
// the contract's types. A route change regenerates the client and extends these cases.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiClient, type ApiClient, type ErrorResponse } from "@sebela/api-client";

import type { AppDependencies } from "./app.js";
import {
  anyText,
  connection,
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
});
