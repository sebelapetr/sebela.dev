import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  RoadmapBookListSchema,
  RoadmapBookSchema,
  type RoadmapBookCreate,
  type RoadmapResourceCreate,
} from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { createRoadmapService, type RoadmapService } from "./index.js";

/** A fictional book without optional metadata; the subject is the service, not the demo seed. */
const book = (slug: string, priority = 0): RoadmapBookCreate => ({
  slug,
  title: `Fictional ${slug}`,
  author: null,
  description: null,
  pages: null,
  year: null,
  isbn: null,
  priority,
  startedOn: null,
  endedOn: null,
  summary: null,
  coverId: null,
});

/** A fictional resource of type `book` linking the given book. */
const reading = (slug: string, bookSlug: string | null): RoadmapResourceCreate => ({
  slug,
  module: "prompting",
  name: `Reading ${slug}`,
  description: null,
  type: "book",
  status: "in-progress",
  estimatedMinutes: null,
  startedAt: null,
  finishedAt: null,
  link: null,
  position: 0,
  book: bookSlug,
  topics: [],
});

const coverImage = {
  key: "test/media/fictional-cover.webp",
  mediaType: "image/webp" as const,
  byteSize: 1024,
  width: 400,
  height: 600,
  altText: "A fictional cover",
};

describe("roadmap bookshelf", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let roadmap: RoadmapService;
  let addressed: RoadmapService;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    roadmap = createRoadmapService(persistence.roadmap);
    addressed = createRoadmapService(persistence.roadmap, {
      mediaAddress: (key) => `https://media.example.com/${key}`,
    });
    for (const [position, slug] of ["agents", "rag", "mcp"].entries()) {
      await persistence.profile.createTopic({ slug, name: slug, position });
    }
    await roadmap.createArea({
      slug: "foundations",
      name: "Foundations",
      description: null,
      weight: 40,
      position: 0,
    });
    await roadmap.createModule({
      slug: "prompting",
      area: "foundations",
      name: "Prompting",
      description: null,
      position: 0,
    });
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    for (const day of (await roadmap.getDiary()).days) {
      for (const entry of day.entries) await roadmap.deleteTimeEntry(entry.id);
    }
    for (const area of await persistence.roadmap.loadRoadmapTree()) {
      for (const module of area.modules) {
        for (const resource of module.resources) {
          await persistence.roadmap.deleteRoadmapResource(resource.slug);
        }
      }
    }
    for (const shelved of await persistence.roadmap.listRoadmapBooks()) {
      await persistence.roadmap.deleteRoadmapBook(shelved.slug);
    }
    for (const media of await persistence.profile.listMedia()) {
      await persistence.profile.deleteMedia(media.id);
    }
  });

  describe("reads", () => {
    it("lists books in shelf order with the status derived from their dates", async () => {
      await roadmap.createBook({ ...book("waiting", 1) });
      await roadmap.createBook({ ...book("underway", 0), startedOn: "2026-01-05" });
      await roadmap.createBook({
        ...book("finished", 1),
        startedOn: "2026-01-05",
        endedOn: "2026-02-10",
      });
      // An end alone still completes the book: the end decides before the start.
      await roadmap.createBook({ ...book("ended-only", 2), endedOn: "2026-02-10" });

      const list = await roadmap.listBooks();
      expect(RoadmapBookListSchema.parse(list)).toEqual(list);
      expect(list.map(({ slug, status }) => [slug, status])).toEqual([
        ["underway", "reading"],
        ["finished", "completed"],
        ["waiting", "to-read"],
        ["ended-only", "completed"],
      ]);
    });

    it("returns one book in the contract shape and refuses a missing one", async () => {
      const created = await roadmap.createBook({
        ...book("patterns"),
        author: "Ada Example",
        pages: 320,
        summary: "## Notes",
      });
      const found = await roadmap.getBook("patterns");
      expect(RoadmapBookSchema.parse(found)).toEqual(found);
      expect(found).toEqual(created);
      expect(found).toMatchObject({
        slug: "patterns",
        author: "Ada Example",
        status: "to-read",
        cover: null,
        resource: null,
        readingSeconds: 0,
      });
      await expect(roadmap.getBook("missing")).rejects.toMatchObject({ code: "not_found" });
    });

    it("addresses the cover through the media address and leaves it null without one", async () => {
      const cover = await persistence.profile.createMedia(coverImage);
      await roadmap.createBook({ ...book("patterns"), coverId: cover.id });

      await expect(addressed.getBook("patterns")).resolves.toMatchObject({
        coverId: cover.id,
        cover: {
          id: cover.id,
          key: coverImage.key,
          altText: "A fictional cover",
          url: `https://media.example.com/${coverImage.key}`,
          createdAt: cover.createdAt.toISOString(),
        },
      });
      await expect(roadmap.getBook("patterns")).resolves.toMatchObject({ cover: { url: null } });
    });

    it("reads the linking resource and its logged time once, whatever its topics", async () => {
      await roadmap.createBook(book("patterns"));
      await roadmap.createResource({
        ...reading("patterns-reading", "patterns"),
        topics: ["agents", "rag", "mcp"],
      });
      await roadmap.createTimeEntry({
        resource: "patterns-reading",
        startedAt: "2026-03-02T09:00:00.000Z",
        endedAt: "2026-03-02T09:30:00.000Z",
      });
      await roadmap.createTimeEntry({
        resource: "patterns-reading",
        startedAt: "2026-03-03T18:00:00.000Z",
        endedAt: "2026-03-03T18:15:00.000Z",
      });

      const found = await roadmap.getBook("patterns");
      expect(found).toMatchObject({
        resource: {
          slug: "patterns-reading",
          name: "Reading patterns-reading",
          module: "prompting",
          area: "foundations",
        },
        readingSeconds: 2700,
      });
      const diaryTotal = (await roadmap.getDiary()).days.reduce(
        (sum, day) => sum + day.totalSeconds,
        0,
      );
      expect(found.readingSeconds).toBe(diaryTotal);
    });
  });

  describe("writes", () => {
    it("creates, updates only the given fields and deletes a book", async () => {
      await roadmap.createBook({ ...book("patterns"), startedOn: "2026-01-05" });
      const updated = await roadmap.updateBook("patterns", {
        endedOn: "2026-02-10",
        author: "Ada Example",
      });
      expect(updated).toMatchObject({
        title: "Fictional patterns",
        startedOn: "2026-01-05",
        endedOn: "2026-02-10",
        author: "Ada Example",
        status: "completed",
      });
      const cleared = await roadmap.updateBook("patterns", { endedOn: null });
      expect(cleared.status).toBe("reading");

      await roadmap.deleteBook("patterns");
      await expect(roadmap.getBook("patterns")).rejects.toMatchObject({ code: "not_found" });
    });

    it("refuses a taken slug, a missing book and an end before the start", async () => {
      await roadmap.createBook({ ...book("patterns"), startedOn: "2026-03-02" });
      await expect(roadmap.createBook(book("patterns"))).rejects.toMatchObject({
        code: "conflict",
      });
      await expect(roadmap.updateBook("missing", { priority: 1 })).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(roadmap.deleteBook("missing")).rejects.toMatchObject({ code: "not_found" });
      await expect(roadmap.updateBook("patterns", { endedOn: "2026-03-01" })).rejects.toMatchObject(
        { code: "validation_failed", fields: [{ path: "endedOn" }] },
      );
    });

    it("refuses an unknown or non-image cover by its field", async () => {
      const pdf = await persistence.profile.createMedia({
        key: "test/media/fictional-notes.pdf",
        mediaType: "application/pdf",
        byteSize: 2048,
        width: null,
        height: null,
        altText: null,
      });
      await expect(
        roadmap.createBook({
          ...book("patterns"),
          coverId: "00000000-0000-4000-8000-000000000000",
        }),
      ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path: "coverId" }] });
      await expect(
        roadmap.createBook({ ...book("patterns"), coverId: pdf.id }),
      ).rejects.toMatchObject({ code: "validation_failed", fields: [{ path: "coverId" }] });
      await expect(roadmap.listBooks()).resolves.toEqual([]);
    });

    it("refuses to delete a book while a resource links it", async () => {
      await roadmap.createBook(book("patterns"));
      await roadmap.createResource(reading("patterns-reading", "patterns"));
      await expect(roadmap.deleteBook("patterns")).rejects.toMatchObject({ code: "conflict" });

      await roadmap.updateResource("patterns-reading", { book: null });
      await roadmap.deleteBook("patterns");
      await expect(roadmap.listBooks()).resolves.toEqual([]);
    });
  });

  describe("the resource link", () => {
    it("reads the linked book's slug on the resource and in the tree", async () => {
      await roadmap.createBook(book("patterns"));
      const created = await roadmap.createResource(reading("patterns-reading", "patterns"));
      expect(created.book).toBe("patterns");
      await expect(roadmap.getResource("patterns-reading")).resolves.toMatchObject({
        book: "patterns",
      });
      const tree = await roadmap.getRoadmap();
      expect(tree.areas[0]?.modules[0]?.resources[0]?.book).toBe("patterns");
    });

    it("refuses an unknown book, a second link and a link from another type on book", async () => {
      await roadmap.createBook(book("patterns"));
      const onBook = { code: "validation_failed", fields: [{ path: "book" }] };
      await expect(
        roadmap.createResource(reading("ghost-reading", "missing")),
      ).rejects.toMatchObject(onBook);

      await roadmap.createResource(reading("patterns-reading", "patterns"));
      await expect(
        roadmap.createResource(reading("second-reading", "patterns")),
      ).rejects.toMatchObject(onBook);
      await expect(
        roadmap.updateResource("patterns-reading", { type: "text" }),
      ).rejects.toMatchObject(onBook);
      await expect(roadmap.getResource("second-reading")).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });
});
