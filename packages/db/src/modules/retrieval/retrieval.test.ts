import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import {
  createRetrievalPersistence,
  type RetrievalPersistence,
  type RetrievalSourceVersion,
} from "./index.js";

const DIMENSION = 1024;
const MODEL = "fake-model";

/** A unit vector pointing between the given axes. */
function vector(...axes: number[]): number[] {
  const values = new Array<number>(DIMENSION).fill(0);
  for (const axis of axes) values[axis] = 1 / Math.sqrt(axes.length);
  return values;
}

/**
 * A deterministic unit vector near the given direction, the way real embeddings of one topic
 * scatter around it: the direction plus seeded noise of a fixed size (relative norm 0.75).
 */
function scattered(seed: number, direction: Record<number, number>): number[] {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 4294967296) * 2 - 1;
  };
  const values = Array.from({ length: DIMENSION }, () => next() * 0.0406);
  for (const [axis, weight] of Object.entries(direction)) {
    values[Number(axis)] = (values[Number(axis)] ?? 0) + weight;
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function source(
  sourceId: string,
  overrides: Partial<RetrievalSourceVersion> & { texts?: [string, number[]][] } = {},
): RetrievalSourceVersion {
  const { texts = [[`About ${sourceId}`, vector(0)]], ...rest } = overrides;
  return {
    sourceId,
    sourceKind: "portfolio",
    contentKind: "book",
    title: `Title of ${sourceId}`,
    path: `/ai-roadmap/bookshelf/${sourceId}`,
    version: hash(sourceId),
    model: MODEL,
    modelVersion: "1",
    dimension: DIMENSION,
    indexedAt: new Date("2026-11-20T10:00:00.000Z"),
    sections: [{ ordinal: 0, headingPath: [`Title of ${sourceId}`, "Summary"], start: 0, end: 10 }],
    chunks: texts.map(([text, values], ordinal) => ({
      sectionOrdinal: 0,
      ordinal,
      text,
      textHash: hash(text),
      vector: values,
    })),
    ...rest,
  };
}

describe("retrieval persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let retrieval: RetrievalPersistence;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    retrieval = createRetrievalPersistence(connection.db);
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  beforeEach(async () => {
    await connection.db.execute(
      sql`TRUNCATE retrieval.sources, retrieval.provider_usage, retrieval.work_items CASCADE`,
    );
  });

  it("stores a source version and reports it as indexed with its model", async () => {
    await retrieval.replaceSource(source("handbook"));
    expect(await retrieval.indexedSources()).toEqual([
      { sourceId: "handbook", version: hash("handbook"), model: MODEL, modelVersion: "1" },
    ]);
  });

  it("finds the nearest chunks by cosine similarity with their source and section", async () => {
    await retrieval.replaceSource(source("near", { texts: [["Near text", vector(0)]] }));
    await retrieval.replaceSource(source("between", { texts: [["Between text", vector(0, 1)]] }));
    await retrieval.replaceSource(source("far", { texts: [["Far text", vector(2)]] }));

    const found = await retrieval.nearest({
      vector: vector(0),
      model: MODEL,
      modelVersion: "1",
      limit: 2,
    });

    expect(found.map((chunk) => chunk.sourceId)).toEqual(["near", "between"]);
    expect(found[0]).toEqual({
      sourceId: "near",
      sourceKind: "portfolio",
      contentKind: "book",
      title: "Title of near",
      path: "/ai-roadmap/bookshelf/near",
      version: hash("near"),
      text: "Near text",
      headingPath: ["Title of near", "Summary"],
      indexedAt: new Date("2026-11-20T10:00:00.000Z"),
      similarity: expect.closeTo(1, 6) as number,
    });
    expect(found[1]?.similarity).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("filters by content kind and ignores chunks of another model", async () => {
    await retrieval.replaceSource(source("book"));
    await retrieval.replaceSource(
      source("diary", { contentKind: "diary_day", path: "/ai-roadmap/diary/2025-02-11" }),
    );
    await retrieval.replaceSource(source("other-model", { model: "another-model" }));

    const query = { vector: vector(0), model: MODEL, modelVersion: "1", limit: 10 };
    expect((await retrieval.nearest(query)).map((chunk) => chunk.sourceId).sort()).toEqual([
      "book",
      "diary",
    ]);
    expect(
      (await retrieval.nearest({ ...query, kinds: ["diary_day"] })).map((chunk) => chunk.sourceId),
    ).toEqual(["diary"]);
  });

  it("finds a narrow content kind behind more nearer chunks of another kind than one index scan visits", async () => {
    // More off-kind chunks lie nearer the query than the default hnsw.ef_search (40) visits.
    const nearer: [string, number[]][] = Array.from({ length: 200 }, (_, index) => [
      `Book passage ${String(index)}`,
      scattered(index + 1, { 0: 1 }),
    ]);
    await retrieval.replaceSource(source("crowded-book", { texts: nearer }));
    // Most sources are of the wanted kind, so the filter does not look selective to the planner,
    // yet every one of their chunks is farther from the query than all the book passages.
    for (let day = 0; day < 100; day += 1) {
      await retrieval.replaceSource(
        source(`diary-${String(day)}`, {
          contentKind: "diary_day",
          path: `/ai-roadmap/diary/${String(day)}`,
          texts: [[`Diary passage ${String(day)}`, scattered(1000 + day, { 0: 0.6, 1: 0.8 })]],
        }),
      );
    }

    // A table this small is read and sorted directly; a production-sized one is read through
    // the HNSW index in distance order. Sessions opened now take that index path.
    const name = sql.identifier(database.config.name);
    await connection.db.execute(
      sql`ANALYZE retrieval.chunks, retrieval.versions, retrieval.sources`,
    );
    await connection.db.execute(sql`ALTER DATABASE ${name} SET enable_seqscan = off`);
    await connection.db.execute(sql`ALTER DATABASE ${name} SET enable_sort = off`);
    const indexed = openConnection(database.config, { max: 1 });
    try {
      const found = await createRetrievalPersistence(indexed.db).nearest({
        vector: vector(0),
        model: MODEL,
        modelVersion: "1",
        kinds: ["diary_day"],
        limit: 3,
      });
      expect(found).toHaveLength(3);
      expect(found.every((chunk) => chunk.contentKind === "diary_day")).toBe(true);
    } finally {
      await indexed.close();
      await connection.db.execute(sql`ALTER DATABASE ${name} RESET enable_seqscan`);
      await connection.db.execute(sql`ALTER DATABASE ${name} RESET enable_sort`);
    }
  });

  it("replaces a source's chunks and reuses vectors by text hash", async () => {
    await retrieval.replaceSource(
      source("handbook", {
        texts: [
          ["Old text", vector(3)],
          ["Kept text", vector(4)],
        ],
      }),
    );
    await retrieval.replaceSource(
      source("handbook", { version: hash("v2"), texts: [["Kept text", vector(4)]] }),
    );

    const found = await retrieval.nearest({
      vector: vector(3),
      model: MODEL,
      modelVersion: "1",
      limit: 10,
    });
    expect(found.map((chunk) => chunk.text)).toEqual(["Kept text"]);
    expect((await retrieval.indexedSources())[0]?.version).toBe(hash("v2"));

    const vectors = await retrieval.vectorsByHash(
      [hash("Kept text"), hash("Old text")],
      MODEL,
      "1",
    );
    expect([...vectors.keys()]).toEqual([hash("Kept text")]);
    expect(vectors.get(hash("Kept text"))?.[4]).toBeCloseTo(1, 6);
    expect((await retrieval.vectorsByHash([hash("Kept text")], MODEL, "2")).size).toBe(0);
  });

  it("removes the sources of a kind that are not named", async () => {
    await retrieval.replaceSource(source("stays"));
    await retrieval.replaceSource(source("goes"));
    await retrieval.replaceSource(
      source("document", { sourceKind: "supplemental", contentKind: "document", path: null }),
    );

    expect(await retrieval.removeSourcesExcept("portfolio", ["stays"])).toBe(1);
    expect((await retrieval.indexedSources()).map((indexed) => indexed.sourceId).sort()).toEqual([
      "document",
      "stays",
    ]);
    const found = await retrieval.nearest({
      vector: vector(0),
      model: MODEL,
      modelVersion: "1",
      limit: 10,
    });
    expect(found.map((chunk) => chunk.sourceId)).not.toContain("goes");
  });

  it("totals recorded usage since a time, per operation", async () => {
    const usage = (operation: "index" | "search", tokens: number, occurredAt: string) =>
      retrieval.recordUsage({
        operation,
        model: MODEL,
        tokens,
        costUsd: tokens / 1_000_000,
        occurredAt: new Date(occurredAt),
      });
    await usage("index", 1000, "2026-10-31T23:59:59.000Z");
    await usage("index", 2000, "2026-11-01T00:00:00.000Z");
    await usage("search", 10, "2026-11-05T12:00:00.000Z");

    const totals = await retrieval.usageSince(new Date("2026-11-01T00:00:00.000Z"));
    expect(totals.tokens).toBe(2010);
    expect(totals.costUsd).toBeCloseTo(0.00201, 10);
    expect(totals.byOperation.index.tokens).toBe(2000);
    expect(totals.byOperation.index.costUsd).toBeCloseTo(0.002, 10);
    expect(totals.byOperation.search.tokens).toBe(10);
    expect(totals.byOperation.candidates).toEqual({ tokens: 0, costUsd: 0 });
  });
});
