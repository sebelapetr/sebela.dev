import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  RoadmapFollowedSourceListSchema,
  RoadmapFollowedSourceSchema,
  RoadmapGlossaryTermListSchema,
  RoadmapGlossaryTermSchema,
  RoadmapProjectIdeaListSchema,
  RoadmapProjectIdeaSchema,
} from "@sebela/contracts";

import { bearer, connection, json, openTestBackend, type TestBackend } from "./test-support.js";

/** Two fictional shared topics. */
const topics = [
  { slug: "fictional-agents", name: "Fictional agents", position: 0 },
  { slug: "fictional-evals", name: "Fictional evals", position: 1 },
];

/** A fictional project idea with every field. */
const idea = {
  slug: "fictional-reading-assistant",
  title: "A fictional reading assistant",
  whyItMatters: "It practises **retrieval** on a small corpus.",
  howToStart: "Index three example articles.",
  topics: ["fictional-evals", "fictional-agents"],
  position: 1,
};

/** A fictional followed source with every field. */
const source = {
  slug: "example-weekly",
  title: "Example Weekly",
  description: "A *fictional* newsletter.",
  link: "https://example.com/weekly",
  kind: "newsletter",
  position: 1,
};

/** A fictional glossary term. */
const term = {
  slug: "context-window",
  term: "Context window",
  description: "How much text a model reads at once.",
  position: 1,
};

interface FieldError {
  path: string;
  message: string;
}

describe("the roadmap supporting content API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("supporting routes")).key);
    for (const topic of topics) expect((await post("/v1/topics", topic)).status).toBe(201);
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { roadmap } = backend.services;
    for (const { slug } of await roadmap.listProjectIdeas()) await roadmap.deleteProjectIdea(slug);
    for (const { slug } of await roadmap.listFollowedSources()) {
      await roadmap.deleteFollowedSource(slug);
    }
    for (const { slug } of await roadmap.listGlossaryTerms())
      await roadmap.deleteGlossaryTerm(slug);
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const post = (path: string, body: object, headers = auth) =>
    request(path, "POST", json(body, headers));
  const patch = (path: string, body: object, headers = auth) =>
    request(path, "PATCH", json(body, headers));
  const remove = (path: string, headers = auth) => request(path, "DELETE", { headers });
  const read = async (path: string): Promise<unknown> => {
    const response = await request(path);
    expect(response.status, path).toBe(200);
    return response.json();
  };
  const expectRefusal = async (response: Response, status: number, code: string, path?: string) => {
    expect(response.status).toBe(status);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe(code);
    if (path !== undefined) expect(error.fields?.map((field) => field.path)).toContain(path);
  };

  describe("project ideas", () => {
    const IDEAS = "/v1/roadmap/project-ideas";

    it("reads no ideas as an empty list and a missing idea as not found", async () => {
      expect(await read(IDEAS)).toEqual([]);
      await expectRefusal(await request(`${IDEAS}/no-such-idea`), 404, "not_found");
    });

    it("creates ideas and reads them publicly in position order with their topics", async () => {
      const created = await post(IDEAS, idea);
      expect(created.status).toBe(201);
      expect(created.headers.get("location")).toBe(`${IDEAS}/${idea.slug}`);
      const body = RoadmapProjectIdeaSchema.parse(await created.json());
      expect(body.topics.map((topic) => topic.slug)).toEqual(idea.topics);
      const bare = { slug: "fictional-first", title: "First", whyItMatters: "Why.", position: 0 };
      const first = RoadmapProjectIdeaSchema.parse(await (await post(IDEAS, bare)).json());
      expect(first).toMatchObject({ howToStart: null, topics: [] });

      const listed = RoadmapProjectIdeaListSchema.parse(await read(IDEAS));
      expect(listed.map((each) => each.slug)).toEqual(["fictional-first", idea.slug]);
      expect(RoadmapProjectIdeaSchema.parse(await read(`${IDEAS}/${idea.slug}`))).toEqual(body);
    });

    it("updates only the sent fields and deletes an idea", async () => {
      await post(IDEAS, idea);
      const updated = await patch(`${IDEAS}/${idea.slug}`, {
        howToStart: null,
        topics: ["fictional-agents"],
      });
      expect(updated.status).toBe(200);
      expect(RoadmapProjectIdeaSchema.parse(await updated.json())).toMatchObject({
        title: idea.title,
        howToStart: null,
        topics: [{ slug: "fictional-agents" }],
      });
      expect((await remove(`${IDEAS}/${idea.slug}`)).status).toBe(204);
      await expectRefusal(await request(`${IDEAS}/${idea.slug}`), 404, "not_found");
    });

    it("refuses a taken slug, an unknown or repeated topic, an invalid body and a missing idea", async () => {
      await post(IDEAS, idea);
      await expectRefusal(await post(IDEAS, idea), 409, "conflict");
      await expectRefusal(
        await post(IDEAS, { ...idea, slug: "other", topics: ["nope"] }),
        400,
        "validation_failed",
        "topics",
      );
      await expectRefusal(
        await post(IDEAS, { ...idea, slug: "other", topics: ["nope", "nope"] }),
        400,
        "validation_failed",
        "topics",
      );
      await expectRefusal(
        await patch(`${IDEAS}/${idea.slug}`, { slug: "renamed" }),
        400,
        "validation_failed",
      );
      await expectRefusal(await patch(`${IDEAS}/missing`, { position: 2 }), 404, "not_found");
      await expectRefusal(await remove(`${IDEAS}/missing`), 404, "not_found");
      expect(RoadmapProjectIdeaListSchema.parse(await read(IDEAS))).toHaveLength(1);
    });
  });

  describe("followed sources", () => {
    const SOURCES = "/v1/roadmap/followed-sources";

    it("creates, reads in order, updates and deletes a source", async () => {
      expect(await read(SOURCES)).toEqual([]);
      const created = await post(SOURCES, source);
      expect(created.status).toBe(201);
      expect(created.headers.get("location")).toBe(`${SOURCES}/${source.slug}`);
      const podcast = { slug: "a-podcast", title: "A Podcast", kind: "podcast", position: 1 };
      const bare = RoadmapFollowedSourceSchema.parse(await (await post(SOURCES, podcast)).json());
      expect(bare).toMatchObject({ description: null, link: null });

      const listed = RoadmapFollowedSourceListSchema.parse(await read(SOURCES));
      expect(listed.map((each) => each.slug)).toEqual(["a-podcast", source.slug]);
      const updated = await patch(`${SOURCES}/${source.slug}`, { link: null, kind: "blog" });
      expect(RoadmapFollowedSourceSchema.parse(await updated.json())).toMatchObject({
        title: source.title,
        link: null,
        kind: "blog",
      });
      expect(RoadmapFollowedSourceSchema.parse(await read(`${SOURCES}/${source.slug}`))).toEqual(
        expect.objectContaining({ link: null }),
      );
      expect((await remove(`${SOURCES}/${source.slug}`)).status).toBe(204);
      await expectRefusal(await request(`${SOURCES}/${source.slug}`), 404, "not_found");
    });

    it("refuses a taken slug, an unsafe link and a missing source", async () => {
      await post(SOURCES, source);
      await expectRefusal(await post(SOURCES, source), 409, "conflict");
      await expectRefusal(
        await post(SOURCES, { ...source, slug: "unsafe", link: "javascript:alert(1)" }),
        400,
        "validation_failed",
        "link",
      );
      await expectRefusal(await patch(`${SOURCES}/missing`, { kind: "blog" }), 404, "not_found");
      await expectRefusal(await remove(`${SOURCES}/missing`), 404, "not_found");
    });
  });

  describe("glossary terms", () => {
    const TERMS = "/v1/roadmap/glossary-terms";

    it("creates, reads in order, updates and deletes a term", async () => {
      expect(await read(TERMS)).toEqual([]);
      const created = await post(TERMS, term);
      expect(created.status).toBe(201);
      expect(created.headers.get("location")).toBe(`${TERMS}/${term.slug}`);
      await post(TERMS, { ...term, slug: "agent", term: "Agent" });

      const listed = RoadmapGlossaryTermListSchema.parse(await read(TERMS));
      expect(listed.map((each) => each.slug)).toEqual(["agent", term.slug]);
      const updated = await patch(`${TERMS}/${term.slug}`, { term: "Context length" });
      expect(RoadmapGlossaryTermSchema.parse(await updated.json())).toMatchObject({
        term: "Context length",
        description: term.description,
      });
      expect((await remove(`${TERMS}/${term.slug}`)).status).toBe(204);
      await expectRefusal(await request(`${TERMS}/${term.slug}`), 404, "not_found");
    });

    it("refuses a taken slug, an empty update and a missing term", async () => {
      await post(TERMS, term);
      await expectRefusal(await post(TERMS, term), 409, "conflict");
      await expectRefusal(await patch(`${TERMS}/${term.slug}`, {}), 400, "validation_failed");
      await expectRefusal(await patch(`${TERMS}/missing`, { position: 2 }), 404, "not_found");
      await expectRefusal(await remove(`${TERMS}/missing`), 404, "not_found");
    });
  });

  it("refuses every write without a valid API key and changes nothing", async () => {
    const wrong = bearer("not-a-key");
    for (const [path, body] of [
      ["/v1/roadmap/project-ideas", idea],
      ["/v1/roadmap/followed-sources", source],
      ["/v1/roadmap/glossary-terms", term],
    ] as const) {
      expect((await post(path, body, {})).status, `POST ${path}`).toBe(401);
      expect((await post(path, body, wrong)).status, `POST ${path}`).toBe(401);
      expect((await post(path, body)).status, `POST ${path}`).toBe(201);
      const item = `${path}/${body.slug}`;
      expect((await patch(item, { position: 5 }, {})).status, `PATCH ${item}`).toBe(401);
      expect((await remove(item, {})).status, `DELETE ${item}`).toBe(401);
      expect((await remove(item, wrong)).status, `DELETE ${item}`).toBe(401);
      expect(await read(item)).toMatchObject({ slug: body.slug, position: 1 });
    }
  });
});
