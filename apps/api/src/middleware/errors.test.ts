import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { openServices } from "@sebela/services";

import { createApp } from "../app.js";
import {
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  person,
  testConfig,
  type TestBackend,
} from "../test-support.js";

describe("validation and error handling", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("validation")).key);
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    await backend.services.profile.deletePerson().catch(() => undefined);
  });

  const create = (init: RequestInit, config = testConfig()) =>
    backend.api({ config }).app.request(
      "/v1/person",
      {
        method: "POST",
        ...init,
        headers: { ...(init.headers as Record<string, string>), ...auth },
      },
      connection(),
    );

  async function expectNoPerson() {
    await expect(backend.services.profile.getPerson()).rejects.toMatchObject({ code: "not_found" });
  }

  it("rejects malformed JSON", async () => {
    const response = await create({
      headers: { "content-type": "application/json" },
      body: '{"name": "Alex"',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "malformed_json", message: anyText },
    });
    await expectNoPerson();
  });

  it("rejects a body that is not JSON, or has no content type", async () => {
    for (const headers of [{ "content-type": "text/plain" }, {}]) {
      const response = await create({ headers, body: JSON.stringify(person) });

      expect(response.status).toBe(415);
      expect(await response.json()).toMatchObject({ error: { code: "unsupported_media_type" } });
    }
    await expectNoPerson();
  });

  it("accepts JSON with a charset", async () => {
    const response = await create({
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(person),
    });

    expect(response.status).toBe(201);
  });

  it("names every invalid field and rejects unexpected writable fields", async () => {
    const response = await create(
      json({ ...person, headline: "", email: "not-an-email", id: "chosen-by-caller" }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; fields: { path: string }[] } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.fields.map((field) => field.path).sort()).toEqual(["", "email", "headline"]);
    await expectNoPerson();
  });

  it("rejects an update that changes nothing", async () => {
    await backend.services.profile.createPerson({ ...person, ...emptyOptional });
    const response = await backend
      .api()
      .app.request("/v1/person", { method: "PATCH", ...json({}, auth) }, connection());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
  });

  it("rejects an oversized body, declared or streamed", async () => {
    const config = testConfig({ bodyLimitBytes: 256 });
    const large = JSON.stringify({ ...person, shortBio: "x".repeat(1024) });
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(large));
        controller.close();
      },
    });

    const declared = await create(json(JSON.parse(large) as unknown), config);
    const chunked = await create(
      {
        headers: { "content-type": "application/json" },
        body: streamed,
        duplex: "half",
      },
      config,
    );

    for (const response of [declared, chunked]) {
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } });
    }
    await expectNoPerson();
  });

  it("answers an unknown route with the common 404", async () => {
    const response = await backend.api().app.request("/v1/nothing-here", {}, connection());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: anyText },
    });
  });

  it("hides the details of an unexpected failure", async () => {
    const missing = `missing_${randomBytes(6).toString("hex")}`;
    const broken = openServices({ ...backend.database.config, name: missing });
    const lines: string[] = [];
    const { app } = createApp({
      services: broken,
      config: testConfig(),
      log: (line) => lines.push(line),
    });

    const response = await app.request("/v1/person", {}, connection());
    await broken.close();

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: "internal_error", message: anyText },
    });
    expect(text).not.toContain(missing);
    expect(text).not.toMatch(/at .+\.(?:js|ts):\d+/);
    expect(lines.some((line) => line.includes("error"))).toBe(true);
    for (const line of lines) expect(line).not.toContain(backend.database.config.password);
  });

  it("declares content types, sets nosniff and sends no CORS headers", async () => {
    const { app } = backend.api();
    const origin = { origin: "https://elsewhere.example" };
    const responses = [
      await app.request("/v1/person", { headers: origin }, connection()),
      await app.request("/health", { headers: origin }, connection()),
      await app.request("/openapi.json", {}, connection()),
      await app.request("/reference", {}, connection()),
      await app.request(
        "/v1/person",
        { method: "OPTIONS", headers: { ...origin, "access-control-request-method": "POST" } },
        connection(),
      ),
    ];

    for (const response of responses) {
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(responses[0]?.headers.get("content-type")).toMatch(/^application\/json/);
    expect(responses[1]?.headers.get("content-type")).toMatch(/^application\/json/);
    expect(responses[2]?.headers.get("content-type")).toMatch(/^application\/json/);
    expect(responses[3]?.headers.get("content-type")).toMatch(/^text\/html/);
  });
});

const emptyOptional = {
  longBio: null,
  location: null,
  email: null,
  links: [],
  availability: null,
  careerStartedOn: null,
};
