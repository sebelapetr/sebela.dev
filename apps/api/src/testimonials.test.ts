import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ExperienceSchema,
  TestimonialListSchema,
  TestimonialSchema,
  type Testimonial,
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

/** Fictional quotes by fictional colleagues. */
const kindWords = {
  slug: "dana-on-routing",
  experience: "northwind-lead",
  quote: "Planning our fictional delivery routes went from a day to a coffee break.",
  authorName: "Dana Placeholder",
  authorRole: "Head of Operations",
  position: 1,
};
const praise = {
  ...kindWords,
  slug: "lee-on-fleet",
  quote: "The fictional fleet dashboard finally told us where the vans were.",
  authorName: "Lee Example",
  authorRole: "Dispatcher",
  position: 2,
};

interface FieldError {
  path: string;
  message: string;
}

describe("the testimonial API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("testimonial routes")).key);
    const { profile } = backend.services;
    for (const slug of ["northwind", "acme"]) {
      await profile.createOrganization({ slug, name: slug, website: null, description: null });
    }
    const experience = {
      title: "Engineer",
      kind: "main_job" as const,
      summary: "A fictional role.",
      responsibilities: [],
      inCv: true,
      technologies: [],
    };
    await profile.createExperience({
      ...experience,
      slug: "northwind-lead",
      organization: "northwind",
      startedOn: "2021-03-01",
      endedOn: "2024-06-30",
    });
    // A current role, so it comes first in the experience order.
    await profile.createExperience({
      ...experience,
      slug: "acme-founder",
      organization: "acme",
      startedOn: "2023-01-01",
      endedOn: null,
    });
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { profile } = backend.services;
    for (const { slug } of await profile.listTestimonials()) {
      await profile.deleteTestimonial(slug);
    }
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const create = (body: object) => request("/v1/testimonials", "POST", json(body, auth));

  it("lists no testimonials publicly", async () => {
    const response = await request("/v1/testimonials");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("creates a testimonial with its address and reads it publicly", async () => {
    const created = await create(kindWords);

    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe("/v1/testimonials/dana-on-routing");
    const body = TestimonialSchema.parse(await created.json());
    expect(body).toMatchObject(kindWords);
    // No photo or visibility flag: a testimonial is public content and has no media yet.
    expect(Object.keys(body).sort()).toEqual(
      [...Object.keys(kindWords), "id", "createdAt", "updatedAt"].sort(),
    );

    const read = await request("/v1/testimonials/dana-on-routing");
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(body);
  });

  it("lists testimonials by experience order, then by position and slug", async () => {
    for (const testimonial of [
      praise,
      kindWords,
      { ...praise, slug: "ana-same", position: 2 },
      { ...praise, slug: "kim-on-shop", experience: "acme-founder", position: 9 },
    ]) {
      expect((await create(testimonial)).status).toBe(201);
    }

    const listed = TestimonialListSchema.parse(await (await request("/v1/testimonials")).json());

    expect(listed.map((testimonial) => testimonial.slug)).toEqual([
      "kim-on-shop",
      "dana-on-routing",
      "ana-same",
      "lee-on-fleet",
    ]);
  });

  it("answers an experience with its testimonials in order, beside its organization and projects", async () => {
    const later = await (await create(praise)).json();
    const first = await (await create(kindWords)).json();

    const response = await request("/v1/experiences/northwind-lead");

    expect(response.status).toBe(200);
    const experience = ExperienceSchema.parse(await response.json());
    expect(experience.testimonials).toEqual([first, later]);
    expect(experience.organization.slug).toBe("northwind");
    expect(experience.projects).toEqual([]);
    const listed = await (await request("/v1/experiences")).json();
    expect(listed).toMatchObject([
      { slug: "acme-founder", testimonials: [] },
      { slug: "northwind-lead", testimonials: [first, later] },
    ]);
  });

  it("refuses a duplicate slug with a conflict, also in another experience", async () => {
    await create(kindWords);

    const again = await create({ ...kindWords, experience: "acme-founder" });

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { code: "conflict", message: anyText } });
  });

  it.each([
    ["a missing experience", { ...kindWords, experience: undefined }, "experience"],
    ["an unknown experience", { ...kindWords, experience: "missing" }, "experience"],
    ["an empty quote", { ...kindWords, quote: "  " }, "quote"],
    ["a quote that is too long", { ...kindWords, quote: "x".repeat(2001) }, "quote"],
    ["a missing author name", { ...kindWords, authorName: undefined }, "authorName"],
    [
      "an author role that is too long",
      { ...kindWords, authorRole: "x".repeat(201) },
      "authorRole",
    ],
    ["a negative position", { ...kindWords, position: -1 }, "position"],
    ["an author photo", { ...kindWords, authorPhoto: "dana" }, "authorPhoto"],
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
    await expect(backend.services.profile.listTestimonials()).resolves.toEqual([]);
  });

  it("updates only the given fields", async () => {
    const created = (await (await create(kindWords)).json()) as Testimonial;

    const response = await request(
      "/v1/testimonials/dana-on-routing",
      "PATCH",
      json({ authorRole: "Chief Operating Officer" }, auth),
    );

    expect(response.status).toBe(200);
    const updated = TestimonialSchema.parse(await response.json());
    expect(updated).toMatchObject({
      authorRole: "Chief Operating Officer",
      quote: kindWords.quote,
      authorName: kindWords.authorName,
      experience: kindWords.experience,
      id: created.id,
      createdAt: created.createdAt,
    });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it("moves a testimonial to another experience, which then has it alone", async () => {
    await create(kindWords);

    const response = await request(
      "/v1/testimonials/dana-on-routing",
      "PATCH",
      json({ experience: "acme-founder" }, auth),
    );

    expect(response.status).toBe(200);
    const moved = TestimonialSchema.parse(await response.json());
    expect(moved.experience).toBe("acme-founder");
    const owner = ExperienceSchema.parse(
      await (await request("/v1/experiences/acme-founder")).json(),
    );
    const former = ExperienceSchema.parse(
      await (await request("/v1/experiences/northwind-lead")).json(),
    );
    expect(owner.testimonials).toEqual([moved]);
    expect(former.testimonials).toEqual([]);
  });

  it("reorders the testimonials of an experience by a changed position", async () => {
    await create(kindWords);
    await create(praise);

    await request("/v1/testimonials/dana-on-routing", "PATCH", json({ position: 5 }, auth));

    const experience = ExperienceSchema.parse(
      await (await request("/v1/experiences/northwind-lead")).json(),
    );
    expect(experience.testimonials.map(({ slug }) => slug)).toEqual([
      "lee-on-fleet",
      "dana-on-routing",
    ]);
  });

  it.each([
    ["a change of the slug", { slug: "renamed" }, undefined],
    ["an empty change", {}, undefined],
    ["a removed owner", { experience: null }, "experience"],
    ["an empty quote", { quote: " " }, "quote"],
    ["an unknown experience", { quote: "Changed.", experience: "missing" }, "experience"],
  ])("refuses an update with %s and changes nothing", async (_, body, field) => {
    const created = await (await create(kindWords)).json();

    const response = await request("/v1/testimonials/dana-on-routing", "PATCH", json(body, auth));

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as {
      error: { code: string; fields?: FieldError[] };
    };
    expect(error.code).toBe("validation_failed");
    if (field) expect(error.fields).toEqual([expect.objectContaining({ path: field })]);
    expect(await (await request("/v1/testimonials/dana-on-routing")).json()).toEqual(created);
  });

  it("answers a missing testimonial with not found", async () => {
    for (const response of [
      await request("/v1/testimonials/missing"),
      await request("/v1/testimonials/missing", "PATCH", json({ quote: "X" }, auth)),
      await request("/v1/testimonials/missing", "DELETE", { headers: auth }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "not_found", message: anyText } });
    }
  });

  it("refuses a malformed slug in the path with the field", async () => {
    for (const response of [
      await request("/v1/testimonials/Not%20A%20Slug"),
      await request("/v1/testimonials/dana.on", "PATCH", json({ quote: "X" }, auth)),
      await request("/v1/testimonials/UPPER", "DELETE", { headers: auth }),
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
    expect((await request("/v1/testimonials/Not%20A%20Slug", "DELETE")).status).toBe(401);
    expect((await request("/v1/testimonials/dana-on-routing", "PATCH", json({}))).status).toBe(401);
    expect((await request("/v1/testimonials", "POST", json(kindWords))).status).toBe(401);
    await expect(backend.services.profile.listTestimonials()).resolves.toEqual([]);
  });

  it("refuses to delete an experience that has a testimonial", async () => {
    await create(kindWords);

    const response = await request("/v1/experiences/northwind-lead", "DELETE", { headers: auth });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "conflict", message: anyText } });
    expect((await request("/v1/experiences/northwind-lead")).status).toBe(200);
    expect((await request("/v1/testimonials/dana-on-routing")).status).toBe(200);
  });

  it("deletes a testimonial with the key, keeps its experience, and reports each write", async () => {
    const events: WriteEvent[] = [];
    const { app } = backend.api({
      onWrite: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });
    await app.request(
      "/v1/testimonials",
      { method: "POST", ...json(kindWords, auth) },
      connection(),
    );

    const deleted = await app.request(
      "/v1/testimonials/dana-on-routing",
      { method: "DELETE", headers: auth },
      connection(),
    );

    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(events).toEqual([
      { operationId: "createTestimonial", method: "POST", path: "/v1/testimonials" },
      {
        operationId: "deleteTestimonial",
        method: "DELETE",
        path: "/v1/testimonials/dana-on-routing",
      },
    ]);
    expect((await request("/v1/testimonials/dana-on-routing")).status).toBe(404);
    expect((await request("/v1/experiences/northwind-lead")).status).toBe(200);
  });
});
