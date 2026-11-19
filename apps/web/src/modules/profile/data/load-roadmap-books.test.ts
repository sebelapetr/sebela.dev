import { describe, expect, it } from "vitest";

import { createApiClient, type Media, type Person, type RoadmapBook } from "@sebela/api-client";

import { loadRoadmapBook, loadRoadmapBookshelf } from "./load-roadmap-books";

const BASE = "https://api.example.test";
const STAMP = "2026-01-01T00:00:00.000Z";
const OPTIONS = { mediaBaseUrl: "https://media.example.test/files/test" };

function person(): Person {
  return {
    id: "0b6f4f43-61a4-4c1e-8f0e-6f1c1c5d2a10",
    name: "Robin Example",
    headline: "Fictional engineer for tests",
    shortBio: "Robin is **made up** for the tests.",
    longBio: null,
    location: null,
    email: null,
    links: [],
    availability: null,
    careerStartedOn: null,
    servicesIntro: null,
    collaborationSteps: [],
    servicesNote: null,
    photoId: null,
    cvPdfId: null,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function media(overrides: Partial<Media> = {}): Media {
  return {
    id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
    key: "test/cover.png",
    mediaType: "image/png",
    byteSize: 1234,
    width: 400,
    height: 600,
    altText: "A fictional cover.",
    url: "https://media.example.test/files/test/cover.png",
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function book(slug: string, overrides: Partial<RoadmapBook> = {}): RoadmapBook {
  return {
    id: "6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e",
    slug,
    title: `The ${slug}`,
    author: "Ada Example",
    description: "A **fictional** book.",
    pages: 200,
    year: 2024,
    isbn: null,
    priority: 0,
    startedOn: null,
    endedOn: null,
    summary: null,
    coverId: null,
    cover: null,
    status: "to-read",
    resource: null,
    readingSeconds: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

const covered = book("covered-book", { coverId: media().id, cover: media() });
const bare = book("bare-book", { author: null, description: null, pages: null, year: null });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function apiError(code: string, status: number): Response {
  return json({ error: { code, message: "A fictional failure." } }, status);
}

type Route = (request: Request) => Response | Promise<Response>;

const BOOKS_PATH = "/v1/roadmap/books";
const BOOK_PATH = "/v1/roadmap/books/covered-book";

function clientWith(routes: Record<string, Route>) {
  const requests: Request[] = [];
  const client = createApiClient({
    baseUrl: BASE,
    fetch: async (request) => {
      requests.push(request);
      const path = new URL(request.url).pathname;
      const route = routes[path];
      if (!route) throw new Error(`unexpected request to ${path}`);
      return route(request);
    },
  });
  return { client, requests };
}

const failures: [string, Route][] = [
  ["fails", () => apiError("internal_error", 500)],
  ["is rate limited", () => apiError("rate_limited", 429)],
  ["answers through a failing proxy", () => new Response("Bad gateway", { status: 502 })],
  [
    "cannot be reached",
    () => {
      throw new TypeError("fetch failed");
    },
  ],
];

/**
 * Requests the API never answers, held here: otherwise nothing but their own abort listeners
 * reaches them, and garbage collection may drop them before their deadline aborts them.
 */
const hanging = new Set<Request>();

const hang: Route = (request) =>
  new Promise<Response>((_resolve, reject) => {
    hanging.add(request);
    request.signal.addEventListener("abort", () => {
      hanging.delete(request);
      reject(request.signal.reason as Error);
    });
  });

function publicReads(requests: readonly Request[]) {
  for (const request of requests) {
    expect(request.headers.get("Authorization")).toBeNull();
    expect(request.cache).toBe("no-store");
  }
  return requests.map((request) => `${request.method} ${new URL(request.url).pathname}`).sort();
}

const COVER = {
  url: "/media/cover.png",
  altText: "A fictional cover.",
  width: 400,
  height: 600,
};

describe("loadRoadmapBookshelf", () => {
  it("returns the API's books in its order, each with its cover as the site's image", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [BOOKS_PATH]: () => json([covered, bare]),
    });

    expect(await loadRoadmapBookshelf(client, OPTIONS)).toEqual({
      status: "ready",
      content: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        books: [
          { book: covered, cover: COVER },
          { book: bare, cover: null },
        ],
      },
    });
  });

  it("returns an empty bookshelf as ready, never as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [BOOKS_PATH]: () => json([]),
    });

    expect(await loadRoadmapBookshelf(client, OPTIONS)).toMatchObject({
      status: "ready",
      content: { books: [] },
    });
  });

  it.each([
    [
      "is not an image",
      media({ mediaType: "application/pdf", url: `${OPTIONS.mediaBaseUrl}/c.pdf` }),
    ],
    ["lies outside the media base", media({ url: "https://covers.example.test/cover.png" })],
    ["has no address", media({ url: null })],
    ["has no dimensions", media({ width: null, height: null })],
  ])("shows no cover, never a broken one, when the cover %s", async (_label, cover) => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [BOOKS_PATH]: () => json([book("odd-cover", { coverId: cover.id, cover })]),
    });

    const result = await loadRoadmapBookshelf(client, OPTIONS);

    expect(result.status === "ready" && result.content.books[0]?.cover).toBeNull();
  });

  it("gives a cover without alternative text an empty one", async () => {
    const cover = media({ altText: null });
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [BOOKS_PATH]: () => json([book("plain-cover", { coverId: cover.id, cover })]),
    });

    const result = await loadRoadmapBookshelf(client, OPTIONS);

    expect(result.status === "ready" && result.content.books[0]?.cover).toEqual({
      ...COVER,
      altText: "",
    });
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      [BOOKS_PATH]: () => json([covered]),
    });

    await loadRoadmapBookshelf(client, OPTIONS);

    expect(publicReads(requests)).toEqual([`GET ${BOOKS_PATH}`, "GET /v1/person"].sort());
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => apiError("not_found", 404),
      [BOOKS_PATH]: () => json([covered]),
    });

    expect(await loadRoadmapBookshelf(client, OPTIONS)).toEqual({ status: "missing" });
  });

  it.each(failures)("is unavailable, never empty, when the books route %s", async (_l, route) => {
    const { client } = clientWith({ "/v1/person": () => json(person()), [BOOKS_PATH]: route });

    expect(await loadRoadmapBookshelf(client, OPTIONS)).toEqual({ status: "unavailable" });
  });

  it.each(failures)("is unavailable when the person route %s", async (_label, route) => {
    const { client } = clientWith({ "/v1/person": route, [BOOKS_PATH]: () => json([covered]) });

    expect(await loadRoadmapBookshelf(client, OPTIONS)).toEqual({ status: "unavailable" });
  });

  it("gives up on an API that does not answer in time", async () => {
    const { client } = clientWith({ "/v1/person": hang, [BOOKS_PATH]: hang });

    expect(await loadRoadmapBookshelf(client, { ...OPTIONS, timeoutMs: 20 })).toEqual({
      status: "unavailable",
    });
  });
});

describe("loadRoadmapBook", () => {
  it("returns the API's book as it is, with its cover and the person's name", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [BOOK_PATH]: () => json(covered),
    });

    expect(await loadRoadmapBook(client, "covered-book", OPTIONS)).toEqual({
      status: "ready",
      content: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        book: covered,
        cover: COVER,
      },
    });
  });

  it("returns a book without a cover with none", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      "/v1/roadmap/books/bare-book": () => json(bare),
    });

    expect(await loadRoadmapBook(client, "bare-book", OPTIONS)).toMatchObject({
      status: "ready",
      content: { book: bare, cover: null },
    });
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      [BOOK_PATH]: () => json(covered),
    });

    await loadRoadmapBook(client, "covered-book", OPTIONS);

    expect(publicReads(requests)).toEqual([`GET ${BOOK_PATH}`, "GET /v1/person"].sort());
  });

  it.each([
    ["the book does not exist", () => apiError("not_found", 404)],
    ["the address is not a slug", () => apiError("validation_failed", 400)],
  ])("reports the page as missing when %s", async (_label, route) => {
    const { client } = clientWith({ "/v1/person": () => json(person()), [BOOK_PATH]: route });

    expect(await loadRoadmapBook(client, "covered-book", OPTIONS)).toEqual({ status: "missing" });
  });

  it("keeps the slug inside the book's path segment", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      "/v1/roadmap/books/..%2F..%2Fperson": () => apiError("validation_failed", 400),
    });

    expect(await loadRoadmapBook(client, "../../person", OPTIONS)).toEqual({ status: "missing" });
    expect(requests.map((request) => new URL(request.url).pathname)).toContain(
      "/v1/roadmap/books/..%2F..%2Fperson",
    );
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => apiError("not_found", 404),
      [BOOK_PATH]: () => json(covered),
    });

    expect(await loadRoadmapBook(client, "covered-book", OPTIONS)).toEqual({ status: "missing" });
  });

  it.each(failures)("is unavailable, never missing, when the book route %s", async (_l, route) => {
    const { client } = clientWith({ "/v1/person": () => json(person()), [BOOK_PATH]: route });

    expect(await loadRoadmapBook(client, "covered-book", OPTIONS)).toEqual({
      status: "unavailable",
    });
  });

  it.each(failures)("is unavailable when the person route %s", async (_label, route) => {
    const { client } = clientWith({ "/v1/person": route, [BOOK_PATH]: () => json(covered) });

    expect(await loadRoadmapBook(client, "covered-book", OPTIONS)).toEqual({
      status: "unavailable",
    });
  });

  it("gives up on an API that does not answer in time", async () => {
    const { client } = clientWith({ "/v1/person": hang, [BOOK_PATH]: hang });

    expect(await loadRoadmapBook(client, "covered-book", { ...OPTIONS, timeoutMs: 20 })).toEqual({
      status: "unavailable",
    });
  });
});
