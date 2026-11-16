import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  TechnologyListSchema,
  TechnologySchema,
  TopicListSchema,
  TopicSchema,
  type Technology,
  type Topic,
} from "@sebela/contracts";

import type { WriteEvent } from "./app.js";
import {
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  type TestBackend,
} from "./test-support.js";

/** Fictional catalog entries. */
const typescript = {
  slug: "typescript",
  name: "TypeScript",
  tier: "primary",
  group: "core",
  logoKey: "typescript",
  position: 1,
};
const rag = {
  slug: "rag",
  name: "RAG",
  tier: "primary",
  group: "ai_engineering_focus",
  position: 0,
};
const bash = { slug: "bash", name: "Bash", tier: "secondary", position: 0 };
const hono = { slug: "hono", name: "Hono", tier: "primary", group: "core", position: 1 };

describe("the technology and topic catalog API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("catalog routes")).key);
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { profile } = backend.services;
    for (const { slug } of await profile.listTechnologies()) await profile.deleteTechnology(slug);
    for (const { slug } of await profile.listTopics()) await profile.deleteTopic(slug);
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());

  describe("technologies", () => {
    it("lists an empty catalog publicly", async () => {
      const response = await request("/v1/technologies");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    });

    it("creates a technology with its address, and reads it publicly", async () => {
      const created = await request("/v1/technologies", "POST", json(typescript, auth));

      expect(created.status).toBe(201);
      expect(created.headers.get("location")).toBe("/v1/technologies/typescript");
      const body = TechnologySchema.parse(await created.json());
      expect(body).toMatchObject(typescript);
      expect(Object.keys(body).sort()).toEqual(
        [...Object.keys(typescript), "id", "createdAt", "updatedAt"].sort(),
      );

      const read = await request("/v1/technologies/typescript");
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual(body);
    });

    it("lists by tier, group, position and slug", async () => {
      for (const technology of [bash, typescript, rag, hono]) {
        expect((await request("/v1/technologies", "POST", json(technology, auth))).status).toBe(
          201,
        );
      }

      const listed = TechnologyListSchema.parse(await (await request("/v1/technologies")).json());

      expect(listed.map((technology) => technology.slug)).toEqual([
        "hono",
        "typescript",
        "rag",
        "bash",
      ]);
      expect(listed[3]).toMatchObject({ group: null, logoKey: null });
    });

    it("refuses a duplicate slug with a conflict", async () => {
      await request("/v1/technologies", "POST", json(typescript, auth));

      const again = await request("/v1/technologies", "POST", json(typescript, auth));

      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ error: { code: "conflict", message: anyText } });
    });

    it.each([
      ["a primary technology without a group", { ...typescript, group: null }, "group"],
      ["a secondary technology with a group", { ...bash, group: "core" }, "group"],
      ["an unknown tier", { ...typescript, tier: "tertiary" }, "tier"],
      ["an unknown group", { ...typescript, group: "frontend" }, "group"],
      ["a negative position", { ...typescript, position: -1 }, "position"],
      ["a fractional position", { ...typescript, position: 0.5 }, "position"],
      ["an invalid slug", { ...typescript, slug: "Type Script" }, "slug"],
      [
        "a logo URL instead of a key",
        { ...typescript, logoKey: "https://example.test/ts.svg" },
        "logoKey",
      ],
    ])("refuses %s with the field", async (_, body, field) => {
      const response = await request("/v1/technologies", "POST", json(body, auth));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "validation_failed",
          message: anyText,
          fields: expect.arrayContaining([expect.objectContaining({ path: field })]) as unknown,
        },
      });
    });

    it("updates only the given fields, keeping the slug, id and creation time", async () => {
      const created = (await (
        await request("/v1/technologies", "POST", json(typescript, auth))
      ).json()) as Technology;

      const updated = await request(
        "/v1/technologies/typescript",
        "PATCH",
        json({ name: "TS", position: 5 }, auth),
      );

      expect(updated.status).toBe(200);
      const body = (await updated.json()) as Technology;
      expect(body).toMatchObject({
        ...typescript,
        name: "TS",
        position: 5,
        id: created.id,
        createdAt: created.createdAt,
      });
      expect(Date.parse(body.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    });

    it("refuses an update that leaves the group disagreeing with the stored tier", async () => {
      await request("/v1/technologies", "POST", json(typescript, auth));

      const response = await request(
        "/v1/technologies/typescript",
        "PATCH",
        json({ tier: "secondary" }, auth),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
      expect(await (await request("/v1/technologies/typescript")).json()).toMatchObject({
        tier: "primary",
        group: "core",
      });
    });

    it("refuses a change of the slug", async () => {
      await request("/v1/technologies", "POST", json(typescript, auth));

      const response = await request(
        "/v1/technologies/typescript",
        "PATCH",
        json({ slug: "ts" }, auth),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
    });

    it("answers a missing technology with not found", async () => {
      for (const response of [
        await request("/v1/technologies/missing"),
        await request("/v1/technologies/missing", "PATCH", json({ position: 1 }, auth)),
        await request("/v1/technologies/missing", "DELETE", { headers: auth }),
      ]) {
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: { code: "not_found", message: anyText } });
      }
    });

    it("refuses a malformed slug in the path with the field", async () => {
      for (const response of [
        await request("/v1/technologies/Not%20A%20Slug"),
        await request("/v1/technologies/next.js", "PATCH", json({ position: 1 }, auth)),
        await request("/v1/technologies/UPPER", "DELETE", { headers: auth }),
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

    it("checks the key before the path", async () => {
      const response = await request("/v1/technologies/Not%20A%20Slug", "DELETE");

      expect(response.status).toBe(401);
    });

    it("deletes a technology with the key, and reports each write", async () => {
      const events: WriteEvent[] = [];
      const { app } = backend.api({
        onWrite: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      });
      await app.request(
        "/v1/technologies",
        { method: "POST", ...json(typescript, auth) },
        connection(),
      );

      const deleted = await app.request(
        "/v1/technologies/typescript",
        { method: "DELETE", headers: auth },
        connection(),
      );

      expect(deleted.status).toBe(204);
      expect(await deleted.text()).toBe("");
      expect(events).toEqual([
        { operationId: "createTechnology", method: "POST", path: "/v1/technologies" },
        { operationId: "deleteTechnology", method: "DELETE", path: "/v1/technologies/typescript" },
      ]);
      expect((await request("/v1/technologies/typescript")).status).toBe(404);
    });
  });

  describe("topics", () => {
    it("lists an empty catalog publicly", async () => {
      const response = await request("/v1/topics");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    });

    it("creates topics and lists them by position and slug", async () => {
      for (const topic of [
        { slug: "rag", name: "RAG", position: 1 },
        { slug: "agents", name: "Agents", position: 1 },
        { slug: "mcp", name: "MCP", position: 0 },
      ]) {
        const created = await request("/v1/topics", "POST", json(topic, auth));
        expect(created.status).toBe(201);
        expect(created.headers.get("location")).toBe(`/v1/topics/${topic.slug}`);
      }

      const listed = TopicListSchema.parse(await (await request("/v1/topics")).json());

      expect(listed.map((topic) => topic.slug)).toEqual(["mcp", "agents", "rag"]);
      const read = await request("/v1/topics/rag");
      expect(TopicSchema.parse(await read.json())).toMatchObject({ name: "RAG", position: 1 });
    });

    it("refuses a duplicate slug with a conflict", async () => {
      await request("/v1/topics", "POST", json({ slug: "rag", name: "RAG", position: 0 }, auth));

      const again = await request(
        "/v1/topics",
        "POST",
        json({ slug: "rag", name: "Again", position: 1 }, auth),
      );

      expect(again.status).toBe(409);
    });

    it.each([
      ["a missing position", { slug: "rag", name: "RAG" }, "position"],
      ["a negative position", { slug: "rag", name: "RAG", position: -1 }, "position"],
      ["an empty name", { slug: "rag", name: " ", position: 0 }, "name"],
    ])("refuses %s with the field", async (_, body, field) => {
      const response = await request("/v1/topics", "POST", json(body, auth));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: {
          code: "validation_failed",
          fields: expect.arrayContaining([expect.objectContaining({ path: field })]) as unknown,
        },
      });
    });

    it("updates and deletes a topic, and answers a missing one with not found", async () => {
      const created = (await (
        await request("/v1/topics", "POST", json({ slug: "rag", name: "RAG", position: 0 }, auth))
      ).json()) as Topic;

      const updated = await request("/v1/topics/rag", "PATCH", json({ position: 3 }, auth));
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ id: created.id, slug: "rag", position: 3 });

      expect((await request("/v1/topics/rag", "DELETE", { headers: auth })).status).toBe(204);
      expect((await request("/v1/topics/rag")).status).toBe(404);
      expect((await request("/v1/topics/rag", "PATCH", json({ name: "X" }, auth))).status).toBe(
        404,
      );
    });
  });
});
