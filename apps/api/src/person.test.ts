import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PersonSchema, type Person } from "@sebela/contracts";

import type { WriteEvent } from "./app.js";
import {
  anyText,
  bearer,
  connection,
  json,
  openTestBackend,
  person,
  type TestBackend,
} from "./test-support.js";

describe("the person API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("person routes")).key);
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    await backend.services.profile.deletePerson().catch(() => undefined);
  });

  const request = async (method: string, init: RequestInit = {}) =>
    backend.api().app.request("/v1/person", { method, ...init }, connection());

  it("reads nothing while there is no person, without a key", async () => {
    const response = await request("GET");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: anyText },
    });
  });

  it("creates the person with every non-media field, and reads it publicly", async () => {
    const full = {
      ...person,
      longBio: "A longer story.",
      location: "Example City",
      email: "alex@example.com",
      links: [
        { label: "Code", url: "https://code.example.com/alex" },
        { label: "Blog", url: "https://blog.example.com" },
      ],
      availability: "Open to projects from 2031.",
      careerStartedOn: "2015-09-01",
      servicesIntro: "I help **fictional** teams connect their systems.",
      collaborationSteps: [
        { title: "Understand the problem", description: "A short call." },
        { title: "Handover & support", description: "Documentation and deployment." },
      ],
      servicesNote: "Software is long-standing practice; the AI offering is newer.",
    };

    const created = await request("POST", json(full, auth));
    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe("/v1/person");
    const body = PersonSchema.parse(await created.json());
    expect(body).toMatchObject(full);
    expect(Object.keys(body).sort()).toEqual(
      [...Object.keys(full), "id", "photoId", "cvPdfId", "createdAt", "updatedAt"].sort(),
    );
    expect(body).toMatchObject({ photoId: null, cvPdfId: null });

    const read = await request("GET");
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await read.json()).toEqual(body);
  });

  it("fills unset optional fields as empty", async () => {
    const created = await request("POST", json(person, auth));

    expect(await created.json()).toMatchObject({
      longBio: null,
      location: null,
      email: null,
      links: [],
      availability: null,
      careerStartedOn: null,
      servicesIntro: null,
      collaborationSteps: [],
      servicesNote: null,
    });
  });

  it("refuses a second person with a conflict, also when creates race", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request("POST", json(person, auth))),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409, 409, 409, 409]);
    const conflict = responses.find((response) => response.status === 409);
    expect(await conflict?.json()).toEqual({
      error: { code: "conflict", message: anyText },
    });
  });

  it("updates only the given fields, keeping the id and the creation time", async () => {
    const created = (await (await request("POST", json(person, auth))).json()) as Person;

    const updated = await request("PATCH", json({ headline: "Staff engineer", email: null }, auth));

    expect(updated.status).toBe(200);
    const body = (await updated.json()) as Person;
    expect(body).toMatchObject({
      ...person,
      headline: "Staff engineer",
      email: null,
      id: created.id,
      createdAt: created.createdAt,
    });
    expect(Date.parse(body.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("answers an update or delete without a person with not found", async () => {
    for (const response of [
      await request("PATCH", json({ headline: "Nobody" }, auth)),
      await request("DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
    }
  });

  it("deletes the person with an empty response", async () => {
    await request("POST", json(person, auth));

    const deleted = await request("DELETE", { headers: auth });

    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect((await request("GET")).status).toBe(404);
  });

  it("reports each successful write to the notification point, and nothing else", async () => {
    const events: WriteEvent[] = [];
    const { app } = backend.api({
      onWrite: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });
    const send = (method: string, init: RequestInit = {}) =>
      app.request("/v1/person", { method, ...init }, connection());

    await send("POST", json(person, auth));
    await send("POST", json(person, auth));
    await send("PATCH", json({ headline: "Changed" }));
    await send("PATCH", json({ headline: "Changed" }, auth));
    await send("GET");
    await send("DELETE", { headers: auth });

    expect(events.map((event) => `${event.method} ${event.path}`)).toEqual([
      "POST /v1/person",
      "PATCH /v1/person",
      "DELETE /v1/person",
    ]);
  });
});
