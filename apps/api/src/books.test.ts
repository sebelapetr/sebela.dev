import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DiarySchema,
  MediaSchema,
  RoadmapBookListSchema,
  RoadmapBookSchema,
  RoadmapResourceSchema,
  type RoadmapBook,
} from "@sebela/contracts";
import { samplePdf, samplePng } from "@sebela/services/testing";

import {
  bearer,
  connection,
  json,
  MEDIA_PUBLIC_BASE,
  openTestBackend,
  upload,
  type TestBackend,
} from "./test-support.js";

/** A small fictional roadmap with one module to read books in. */
const area = { slug: "basics", name: "Basics", weight: 100, position: 0 };
const module = { slug: "reading", area: "basics", name: "Reading", position: 0 };

/** Fictional books; only the slug and the title are required. */
const patterns = {
  slug: "fictional-patterns",
  title: "Fictional Patterns",
  author: "Ada Example",
  description: "A **fictional** introduction.",
  pages: 320,
  year: 2024,
  isbn: "978-0-00-000000-2",
  priority: 1,
  startedOn: "2026-01-05",
  summary: "## Notes\n\nKept short.",
};
const backlog = { slug: "fictional-backlog", title: "Fictional Backlog" };

/** A resource of type `book` that reads the given book. */
const readingOf = (slug: string, book: string | null) => ({
  slug,
  module: "reading",
  name: `Reading ${slug}`,
  type: "book",
  position: 0,
  book,
});

interface FieldError {
  path: string;
  message: string;
}

describe("the bookshelf API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("bookshelf routes")).key);
    expect((await post("/v1/roadmap/areas", area)).status).toBe(201);
    expect((await post("/v1/roadmap/modules", module)).status).toBe(201);
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { roadmap, media } = backend.services;
    for (const day of (await roadmap.getDiary()).days) {
      for (const entry of day.entries) await roadmap.deleteTimeEntry(entry.id);
    }
    const tree = await roadmap.getRoadmap();
    for (const { slug } of tree.areas.flatMap((a) => a.modules).flatMap((m) => m.resources)) {
      await roadmap.deleteResource(slug);
    }
    for (const { slug } of await roadmap.listBooks()) await roadmap.deleteBook(slug);
    for (const { id } of await media.listMedia()) await media.deleteMedia(id);
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());
  const post = (path: string, body: object) => request(path, "POST", json(body, auth));
  const patch = (path: string, body: object) => request(path, "PATCH", json(body, auth));
  const remove = (path: string) => request(path, "DELETE", { headers: auth });
  const errorOf = async (response: Response) =>
    ((await response.json()) as { error: { code: string; fields?: FieldError[] } }).error;
  const shelf = async (): Promise<RoadmapBook[]> => {
    const response = await request("/v1/roadmap/books");
    expect(response.status).toBe(200);
    return RoadmapBookListSchema.parse(await response.json());
  };
  const book = async (slug: string): Promise<RoadmapBook> => {
    const response = await request(`/v1/roadmap/books/${slug}`);
    expect(response.status).toBe(200);
    return RoadmapBookSchema.parse(await response.json());
  };
  const uploadCover = async () => {
    const response = await request(
      "/v1/media",
      "POST",
      upload(
        { bytes: samplePng({ width: 40, height: 60 }), name: "cover.png" },
        { altText: "A fictional cover" },
        auth,
      ),
    );
    expect(response.status).toBe(201);
    return MediaSchema.parse(await response.json());
  };

  it("reads an empty shelf as an empty list and a missing book as not found", async () => {
    expect(await shelf()).toEqual([]);
    const missing = await request("/v1/roadmap/books/no-such-book");
    expect(missing.status).toBe(404);
    expect((await errorOf(missing)).code).toBe("not_found");
  });

  it("creates books with defaults, reads them publicly in shelf order with derived status", async () => {
    const created = await post("/v1/roadmap/books", patterns);
    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe("/v1/roadmap/books/fictional-patterns");
    expect(RoadmapBookSchema.parse(await created.json())).toMatchObject({
      ...patterns,
      endedOn: null,
      coverId: null,
      cover: null,
      status: "reading",
      resource: null,
      readingSeconds: 0,
    });

    const minimal = await post("/v1/roadmap/books", backlog);
    expect(minimal.status).toBe(201);
    expect(RoadmapBookSchema.parse(await minimal.json())).toMatchObject({
      author: null,
      description: null,
      pages: null,
      year: null,
      isbn: null,
      priority: 0,
      startedOn: null,
      endedOn: null,
      summary: null,
      status: "to-read",
    });
    expect(
      (await post("/v1/roadmap/books", { slug: "fictional-done", title: "Done", priority: 1 }))
        .status,
    ).toBe(201);
    expect(
      (await patch("/v1/roadmap/books/fictional-done", { endedOn: "2026-02-01" })).status,
    ).toBe(200);

    expect((await shelf()).map(({ slug, status }) => [slug, status])).toEqual([
      ["fictional-backlog", "to-read"],
      ["fictional-done", "completed"],
      ["fictional-patterns", "reading"],
    ]);
    expect(await book("fictional-patterns")).toMatchObject({ title: "Fictional Patterns" });
  });

  it("updates only the fields sent, clears with null and deletes a book", async () => {
    await post("/v1/roadmap/books", patterns);

    const updated = await patch("/v1/roadmap/books/fictional-patterns", {
      endedOn: "2026-02-10",
      author: null,
    });
    expect(updated.status).toBe(200);
    expect(RoadmapBookSchema.parse(await updated.json())).toMatchObject({
      title: "Fictional Patterns",
      startedOn: "2026-01-05",
      endedOn: "2026-02-10",
      author: null,
      status: "completed",
    });

    expect((await remove("/v1/roadmap/books/fictional-patterns")).status).toBe(204);
    expect((await request("/v1/roadmap/books/fictional-patterns")).status).toBe(404);
    expect((await remove("/v1/roadmap/books/fictional-patterns")).status).toBe(404);
    expect((await patch("/v1/roadmap/books/fictional-patterns", { priority: 2 })).status).toBe(404);
  });

  it("addresses an uploaded cover, refuses deleting the media while used and keeps it after the book", async () => {
    const cover = await uploadCover();
    expect((await post("/v1/roadmap/books", { ...backlog, coverId: cover.id })).status).toBe(201);

    const read = await book("fictional-backlog");
    expect(read.coverId).toBe(cover.id);
    expect(read.cover).toMatchObject({ id: cover.id, altText: "A fictional cover" });
    expect(read.cover?.url?.startsWith(MEDIA_PUBLIC_BASE)).toBe(true);

    const refused = await remove(`/v1/media/${cover.id}`);
    expect(refused.status).toBe(409);
    expect((await errorOf(refused)).code).toBe("conflict");

    expect((await remove("/v1/roadmap/books/fictional-backlog")).status).toBe(204);
    expect((await request(`/v1/media/${cover.id}`)).status).toBe(200);
  });

  it("links a book from a resource of type book and reads its time once, as the diary does", async () => {
    await post("/v1/roadmap/books", patterns);
    const resource = await post("/v1/roadmap/resources", {
      ...readingOf("patterns-reading", "fictional-patterns"),
      topics: [],
    });
    expect(resource.status).toBe(201);
    expect(RoadmapResourceSchema.parse(await resource.json()).book).toBe("fictional-patterns");
    for (const [startedAt, endedAt] of [
      ["2026-03-02T09:00:00+01:00", "2026-03-02T09:40:00+01:00"],
      ["2026-03-03T23:50:00+01:00", "2026-03-04T00:10:00+01:00"],
    ]) {
      const session = { resource: "patterns-reading", startedAt, endedAt };
      expect((await post("/v1/roadmap/time-entries", session)).status).toBe(201);
    }

    const read = await book("fictional-patterns");
    expect(read).toMatchObject({
      resource: { slug: "patterns-reading", module: "reading", area: "basics" },
      readingSeconds: 3600,
    });
    const diary = DiarySchema.parse(await (await request("/v1/roadmap/diary")).json());
    expect(diary.days.reduce((sum, day) => sum + day.totalSeconds, 0)).toBe(read.readingSeconds);

    const linked = await remove("/v1/roadmap/books/fictional-patterns");
    expect(linked.status).toBe(409);
    expect((await errorOf(linked)).code).toBe("conflict");
    expect((await patch("/v1/roadmap/resources/patterns-reading", { book: null })).status).toBe(
      200,
    );
    expect((await book("fictional-patterns")).resource).toBeNull();
    expect((await book("fictional-patterns")).readingSeconds).toBe(0);
    expect((await remove("/v1/roadmap/books/fictional-patterns")).status).toBe(204);
  });

  it("refuses a resource link to an unknown book, a taken book or from another type, naming the field", async () => {
    await post("/v1/roadmap/books", backlog);
    expect(
      (await post("/v1/roadmap/resources", readingOf("first", "fictional-backlog"))).status,
    ).toBe(201);
    const refusals = [
      await post("/v1/roadmap/resources", readingOf("ghost", "no-such-book")),
      await post("/v1/roadmap/resources", readingOf("second", "fictional-backlog")),
      await post("/v1/roadmap/resources", {
        ...readingOf("linked-link", "fictional-backlog"),
        type: "link",
      }),
      await patch("/v1/roadmap/resources/first", { type: "text" }),
    ];
    for (const response of refusals) {
      expect(response.status).toBe(400);
      const error = await errorOf(response);
      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path)).toContain("book");
    }
    expect((await request("/v1/roadmap/resources/second")).status).toBe(404);
  });

  it("refuses a taken slug, an unknown or non-image cover and an end before the start", async () => {
    await post("/v1/roadmap/books", patterns);
    const taken = await post("/v1/roadmap/books", patterns);
    expect(taken.status).toBe(409);
    expect((await errorOf(taken)).code).toBe("conflict");

    const pdf = await request(
      "/v1/media",
      "POST",
      upload({ bytes: samplePdf(), name: "notes.pdf", type: "application/pdf" }, {}, auth),
    );
    expect(pdf.status).toBe(201);
    const pdfId = MediaSchema.parse(await pdf.json()).id;

    for (const [response, field] of [
      [
        await post("/v1/roadmap/books", {
          ...backlog,
          coverId: "00000000-0000-4000-8000-000000000000",
        }),
        "coverId",
      ],
      [await post("/v1/roadmap/books", { ...backlog, coverId: pdfId }), "coverId"],
      [
        await post("/v1/roadmap/books", {
          ...backlog,
          startedOn: "2026-02-02",
          endedOn: "2026-02-01",
        }),
        "endedOn",
      ],
      [await patch("/v1/roadmap/books/fictional-patterns", { endedOn: "2026-01-04" }), "endedOn"],
    ] as const) {
      expect(response.status, field).toBe(400);
      const error = await errorOf(response);
      expect(error.code).toBe("validation_failed");
      expect(error.fields?.map(({ path }) => path)).toContain(field);
    }
    expect((await shelf()).map(({ slug }) => slug)).toEqual(["fictional-patterns"]);
  });

  it("refuses malformed input before the service", async () => {
    const statuses = [
      (await post("/v1/roadmap/books", { slug: "Not A Slug", title: "Bad" })).status,
      (await post("/v1/roadmap/books", { slug: "no-title" })).status,
      (await post("/v1/roadmap/books", { ...backlog, extra: true })).status,
      (await post("/v1/roadmap/books", { ...backlog, startedOn: "2026-02-30" })).status,
      (await post("/v1/roadmap/books", { ...backlog, status: "completed" })).status,
      (await patch("/v1/roadmap/books/fictional-backlog", {})).status,
      (await patch("/v1/roadmap/books/fictional-backlog", { slug: "renamed" })).status,
    ];
    expect(statuses).toEqual(Array<number>(statuses.length).fill(400));
    expect(await shelf()).toEqual([]);
  });

  it("refuses every bookshelf write without a valid key and writes nothing", async () => {
    await post("/v1/roadmap/books", backlog);
    const statuses = [
      (await request("/v1/roadmap/books", "POST", json(patterns))).status,
      (await request("/v1/roadmap/books", "POST", json(patterns, bearer("sk_not_a_real_key"))))
        .status,
      (await request("/v1/roadmap/books/fictional-backlog", "PATCH", json({ priority: 3 }))).status,
      (await request("/v1/roadmap/books/fictional-backlog", "DELETE")).status,
    ];
    expect(statuses).toEqual(Array<number>(statuses.length).fill(401));
    expect((await shelf()).map(({ slug, priority }) => [slug, priority])).toEqual([
      ["fictional-backlog", 0],
    ]);
  });
});
