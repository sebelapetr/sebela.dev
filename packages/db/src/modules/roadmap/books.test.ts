import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import { createProfilePersistence, type ProfilePersistence } from "../profile/index.js";
import {
  createRoadmapPersistence,
  type RoadmapBookFields,
  type RoadmapPersistence,
  type RoadmapResourceFields,
  type RoadmapResourceRelations,
} from "./index.js";

type BookInput = RoadmapBookFields & { slug: string };
type ResourceInput = RoadmapResourceFields & RoadmapResourceRelations & { slug: string };

/** A fictional book without optional metadata; the subject is persistence, not the demo seed. */
const book = (slug: string, priority: number): BookInput => ({
  slug,
  title: `Book ${slug}`,
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

/** A fictional resource of type `book` in the one module, linking the given book. */
const reading = (slug: string, bookSlug: string | null): ResourceInput => ({
  slug,
  module: "prompting-basics",
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

const image = (key: string) => ({
  key,
  mediaType: "image/webp" as const,
  byteSize: 1024,
  width: 400,
  height: 600,
  altText: "A fictional cover",
});

describe("bookshelf persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let profile: ProfilePersistence;
  let roadmap: RoadmapPersistence;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    profile = createProfilePersistence(connection.db);
    roadmap = createRoadmapPersistence(connection.db);
    await roadmap.createRoadmapArea({
      slug: "foundations",
      name: "Foundations",
      description: null,
      weight: 50,
      position: 0,
    });
    await roadmap.createRoadmapModule({
      slug: "prompting-basics",
      area: "foundations",
      name: "Prompting basics",
      description: null,
      position: 0,
    });
    for (const [position, slug] of ["agents", "rag", "evals"].entries()) {
      await profile.createTopic({ slug, name: `Topic ${slug}`, position });
    }
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    const table = (name: string) => sql`${sql.identifier("ai_roadmap")}.${sql.identifier(name)}`;
    await connection.db.execute(
      sql`TRUNCATE ${table("time_entries")}, ${table("diary_entries")}, ${table("resource_topics")}, ${table("resources")}, ${table("books")}`,
    );
    for (const media of await profile.listMedia()) await profile.deleteMedia(media.id);
  });

  describe("books", () => {
    it("creates, lists by priority then slug, finds, updates and deletes a book", async () => {
      await roadmap.createRoadmapBook(book("later", 2));
      await roadmap.createRoadmapBook(book("beta", 1));
      const created = await roadmap.createRoadmapBook({
        ...book("alpha", 1),
        author: "Ada Example",
        pages: 320,
        year: 2024,
        isbn: "978-0-00-000000-0",
        startedOn: "2026-01-05",
        summary: "## Notes",
      });
      expect(created).toMatchObject({
        ok: true,
        book: {
          slug: "alpha",
          author: "Ada Example",
          pages: 320,
          startedOn: "2026-01-05",
          endedOn: null,
          cover: null,
          resource: null,
          readingSeconds: 0,
        },
      });

      const listed = await roadmap.listRoadmapBooks();
      expect(listed.map((record) => record.slug)).toEqual(["alpha", "beta", "later"]);

      const updated = await roadmap.updateRoadmapBook("alpha", {
        endedOn: "2026-02-10",
        author: null,
      });
      expect(updated).toMatchObject({
        ok: true,
        book: { endedOn: "2026-02-10", author: null, title: "Book alpha" },
      });
      const found = await roadmap.findRoadmapBook("alpha");
      expect(found?.updatedAt.getTime()).toBeGreaterThan(found?.createdAt.getTime() ?? Infinity);

      await expect(roadmap.deleteRoadmapBook("alpha")).resolves.toEqual({ ok: true });
      await expect(roadmap.findRoadmapBook("alpha")).resolves.toBeNull();
    });

    it("refuses a taken slug, an unknown book and an end before the start", async () => {
      await roadmap.createRoadmapBook(book("alpha", 0));
      await expect(roadmap.createRoadmapBook(book("alpha", 1))).resolves.toEqual({
        ok: false,
        reason: "conflict",
      });
      await expect(roadmap.updateRoadmapBook("missing", { priority: 1 })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      await expect(roadmap.deleteRoadmapBook("missing")).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
      await expect(
        roadmap.createRoadmapBook({
          ...book("beta", 0),
          startedOn: "2026-02-11",
          endedOn: "2026-02-10",
        }),
      ).resolves.toEqual({ ok: false, reason: "invalid_period" });
      await roadmap.updateRoadmapBook("alpha", { startedOn: "2026-03-02" });
      await expect(roadmap.updateRoadmapBook("alpha", { endedOn: "2026-03-01" })).resolves.toEqual({
        ok: false,
        reason: "invalid_period",
      });
    });

    it("reads its cover image, refuses unknown or unsuitable media and keeps it referenced", async () => {
      const cover = await profile.createMedia(image("test/media/cover.webp"));
      const pdf = await profile.createMedia({
        key: "test/media/notes.pdf",
        mediaType: "application/pdf",
        byteSize: 2048,
        width: null,
        height: null,
        altText: null,
      });

      const created = await roadmap.createRoadmapBook({ ...book("alpha", 0), coverId: cover.id });
      expect(created).toMatchObject({ ok: true, book: { coverId: cover.id, cover } });

      await expect(
        roadmap.createRoadmapBook({
          ...book("beta", 0),
          coverId: "00000000-0000-4000-8000-000000000000",
        }),
      ).resolves.toEqual({ ok: false, reason: "unknown_media", field: "coverId" });
      await expect(roadmap.updateRoadmapBook("alpha", { coverId: pdf.id })).resolves.toEqual({
        ok: false,
        reason: "unsuitable_media",
        field: "coverId",
      });
      await expect(roadmap.findRoadmapBook("beta")).resolves.toBeNull();

      await expect(profile.deleteMedia(cover.id)).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await roadmap.updateRoadmapBook("alpha", { coverId: null });
      await expect(roadmap.findRoadmapBook("alpha")).resolves.toMatchObject({
        coverId: null,
        cover: null,
      });
      await expect(profile.deleteMedia(cover.id)).resolves.toMatchObject({ ok: true });
    });
  });

  describe("the resource link", () => {
    it("links a book from one resource of type book and reads it from both sides", async () => {
      await roadmap.createRoadmapBook(book("patterns", 0));
      const created = await roadmap.createRoadmapResource(reading("patterns-reading", "patterns"));
      expect(created).toMatchObject({ ok: true, resource: { book: "patterns" } });

      await expect(roadmap.findRoadmapBook("patterns")).resolves.toMatchObject({
        resource: {
          slug: "patterns-reading",
          name: "Reading patterns-reading",
          module: "prompting-basics",
          area: "foundations",
        },
      });
      const tree = await roadmap.loadRoadmapTree();
      expect(tree[0]?.modules[0]?.resources[0]?.book).toBe("patterns");
    });

    it("refuses an unknown book, a second link and a link from another type", async () => {
      await roadmap.createRoadmapBook(book("patterns", 0));
      await expect(
        roadmap.createRoadmapResource(reading("ghost-reading", "missing")),
      ).resolves.toEqual({ ok: false, reason: "unknown_book" });
      await expect(
        roadmap.createRoadmapResource({ ...reading("text-notes", "patterns"), type: "text" }),
      ).resolves.toEqual({ ok: false, reason: "book_requires_book_type" });

      await roadmap.createRoadmapResource(reading("patterns-reading", "patterns"));
      await expect(
        roadmap.createRoadmapResource(reading("second-reading", "patterns")),
      ).resolves.toEqual({ ok: false, reason: "book_taken" });
      await expect(
        roadmap.updateRoadmapResource("patterns-reading", { type: "text" }),
      ).resolves.toEqual({ ok: false, reason: "book_requires_book_type" });
      await expect(roadmap.findRoadmapResource("second-reading")).resolves.toBeNull();
    });

    it("moves and clears the link, so the former book loses its resource", async () => {
      await roadmap.createRoadmapBook(book("patterns", 0));
      await roadmap.createRoadmapBook(book("basics", 1));
      await roadmap.createRoadmapResource(reading("shelf-reading", "patterns"));

      await expect(
        roadmap.updateRoadmapResource("shelf-reading", { book: "basics" }),
      ).resolves.toMatchObject({ ok: true, resource: { book: "basics" } });
      await expect(roadmap.findRoadmapBook("patterns")).resolves.toMatchObject({ resource: null });
      await expect(roadmap.findRoadmapBook("basics")).resolves.toMatchObject({
        resource: { slug: "shelf-reading" },
      });

      await expect(roadmap.deleteRoadmapBook("basics")).resolves.toEqual({
        ok: false,
        reason: "referenced",
      });
      await roadmap.updateRoadmapResource("shelf-reading", { book: null });
      await expect(roadmap.deleteRoadmapBook("basics")).resolves.toEqual({ ok: true });
    });

    it("reads the linking resource's logged time once, whatever its topics", async () => {
      await roadmap.createRoadmapBook(book("patterns", 0));
      await roadmap.createRoadmapResource({
        ...reading("patterns-reading", "patterns"),
        topics: ["agents", "rag", "evals"],
      });
      await roadmap.createTimeEntries({ resource: "patterns-reading" }, [
        {
          date: "2026-03-02",
          startedAt: new Date("2026-03-02T09:00:00Z"),
          endedAt: new Date("2026-03-02T09:30:00Z"),
        },
      ]);
      await roadmap.createTimeEntries({ resource: "patterns-reading" }, [
        {
          date: "2026-03-03",
          startedAt: new Date("2026-03-03T18:00:00Z"),
          endedAt: new Date("2026-03-03T18:15:00Z"),
        },
      ]);

      await expect(roadmap.findRoadmapBook("patterns")).resolves.toMatchObject({
        readingSeconds: 2700,
      });
      const [listed] = await roadmap.listRoadmapBooks();
      expect(listed?.readingSeconds).toBe(2700);
    });
  });
});
