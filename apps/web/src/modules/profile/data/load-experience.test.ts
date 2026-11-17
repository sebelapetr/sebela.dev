import { describe, expect, it } from "vitest";

import {
  createApiClient,
  type Experience,
  type Media,
  type Person,
  type Testimonial,
} from "@sebela/api-client";

import { loadExperience } from "./load-experience";

const BASE = "https://api.example.test";
const STAMP = "2026-01-01T00:00:00.000Z";

function person(overrides: Partial<Person> = {}): Person {
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
    careerStartedOn: "2015-09-01",
    photoId: null,
    cvPdfId: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function experience(
  slug: string,
  endedOn: string | null,
  logoId: string | null = null,
): Experience {
  return {
    id: "6a1f3c2e-0b4d-4e7a-9c11-2f8d5b6e7a01",
    slug,
    title: "Engineer",
    kind: "main_job",
    startedOn: "2020-01-01",
    endedOn,
    summary: "Fictional.",
    responsibilities: [],
    inCv: true,
    organization: {
      id: "3c9e1b7a-5d2f-4a6b-8e0c-1f2a3b4c5d60",
      slug: "fictional-org",
      name: "Fictional Org",
      website: null,
      description: null,
      logoId,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    technologies: [],
    projects: [],
    testimonials: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

const LOGO_ID = "7d2c4e6f-8a1b-4c3d-9e5f-0a1b2c3d4e5f";
const OTHER_LOGO_ID = "1e2d3c4b-5a69-4788-8a9b-0c1d2e3f4a5b";

function media(overrides: Partial<Media> = {}): Media {
  return {
    id: LOGO_ID,
    key: "test/logo.png",
    mediaType: "image/png",
    byteSize: 321,
    width: 96,
    height: 48,
    altText: "The fictional logo of Fictional Org.",
    url: "https://media.example.test/files/test/logo.png",
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

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

const twoExperiences = [experience("current", null), experience("older", "2019-12-31")];

describe("loadExperience", () => {
  it("returns the person's header facts and the experiences in the API's order", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      "/v1/experiences": () => json(twoExperiences),
    });

    expect(await loadExperience(client)).toEqual({
      status: "ready",
      content: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        careerStartedOn: "2015-09-01",
        experiences: twoExperiences,
        logos: new Map(),
        authorPhotos: new Map(),
      },
    });
  });

  it("is ready without experiences", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person({ careerStartedOn: null })),
      "/v1/experiences": () => json([]),
    });

    const result = await loadExperience(client);

    expect(result.status === "ready" && result.content.experiences).toEqual([]);
    expect(result.status === "ready" && result.content.careerStartedOn).toBeNull();
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      "/v1/experiences": () => json([]),
    });

    await loadExperience(client);

    expect(
      requests.map((request) => [request.method, new URL(request.url).pathname]).sort(),
    ).toEqual([
      ["GET", "/v1/experiences"],
      ["GET", "/v1/person"],
    ]);
    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.cache).toBe("no-store");
    }
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({
      "/v1/person": () => apiError("not_found", 404),
      "/v1/experiences": () => json([]),
    });

    expect(await loadExperience(client)).toEqual({ status: "missing" });
  });

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

  it.each(failures)("is unavailable when the person route %s", async (_label, route) => {
    const { client } = clientWith({
      "/v1/person": route,
      "/v1/experiences": () => json(twoExperiences),
    });

    expect(await loadExperience(client)).toEqual({ status: "unavailable" });
  });

  it.each(failures)(
    "is unavailable, never an empty timeline, when the experiences route %s",
    async (_label, route) => {
      const { client } = clientWith({
        "/v1/person": () => json(person()),
        "/v1/experiences": route,
      });

      expect(await loadExperience(client)).toEqual({ status: "unavailable" });
    },
  );

  it("gives up on an API that does not answer in time", async () => {
    const hang: Route = (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          reject(request.signal.reason as Error);
        });
      });
    const { client } = clientWith({ "/v1/person": hang, "/v1/experiences": hang });

    expect(await loadExperience(client, { timeoutMs: 20 })).toEqual({ status: "unavailable" });
  });
  describe("organization logos", () => {
    const logoUrl = (id: string) => `/v1/media/${id}`;

    it("reads each organization's logo once and keeps it by its media id", async () => {
      const { client, requests } = clientWith({
        "/v1/person": () => json(person()),
        "/v1/experiences": () =>
          json([
            experience("current", null, LOGO_ID),
            experience("older", "2019-12-31", LOGO_ID),
            experience("side", null, OTHER_LOGO_ID),
          ]),
        [logoUrl(LOGO_ID)]: () => json(media()),
        [logoUrl(OTHER_LOGO_ID)]: () =>
          json(
            media({
              id: OTHER_LOGO_ID,
              altText: null,
              url: "https://media.example.test/b.webp",
              mediaType: "image/webp",
              width: 64,
              height: 64,
            }),
          ),
      });

      const result = await loadExperience(client);

      expect(result.status === "ready" && result.content.logos).toEqual(
        new Map([
          [
            LOGO_ID,
            {
              url: "https://media.example.test/files/test/logo.png",
              altText: "The fictional logo of Fictional Org.",
              width: 96,
              height: 48,
            },
          ],
          [
            OTHER_LOGO_ID,
            { url: "https://media.example.test/b.webp", altText: "", width: 64, height: 64 },
          ],
        ]),
      );
      const mediaReads = requests.filter((request) =>
        new URL(request.url).pathname.startsWith("/v1/media/"),
      );
      expect(mediaReads).toHaveLength(2);
      for (const request of mediaReads) {
        expect(request.headers.get("Authorization")).toBeNull();
        expect(request.cache).toBe("no-store");
      }
    });

    it("reads no media for organizations without a logo", async () => {
      const { client, requests } = clientWith({
        "/v1/person": () => json(person()),
        "/v1/experiences": () => json(twoExperiences),
      });

      const result = await loadExperience(client);

      expect(result.status === "ready" && result.content.logos).toEqual(new Map());
      expect(requests).toHaveLength(2);
    });

    it.each<[string, Partial<Media>]>([
      ["is not an image", { mediaType: "application/pdf" }],
      ["has no address", { url: null }],
      ["has an address that is not a web address", { url: "javascript:alert(1)" }],
      ["has no width", { width: null }],
      ["has no height", { height: null }],
    ])("leaves out a logo that %s", async (_label, overrides) => {
      const { client } = clientWith({
        "/v1/person": () => json(person()),
        "/v1/experiences": () => json([experience("current", null, LOGO_ID)]),
        [logoUrl(LOGO_ID)]: () => json(media(overrides)),
      });

      const result = await loadExperience(client);

      expect(result).toMatchObject({ status: "ready" });
      expect(result.status === "ready" && result.content.logos).toEqual(new Map());
    });

    it.each(failures)(
      "leaves out a logo, and keeps the page, when its read %s",
      async (_label, route) => {
        const { client } = clientWith({
          "/v1/person": () => json(person()),
          "/v1/experiences": () => json([experience("current", null, LOGO_ID)]),
          [logoUrl(LOGO_ID)]: route,
        });

        const result = await loadExperience(client);

        expect(result.status === "ready" && result.content.experiences).toHaveLength(1);
        expect(result.status === "ready" && result.content.logos).toEqual(new Map());
      },
    );

    it("leaves out a logo that does not exist", async () => {
      const { client } = clientWith({
        "/v1/person": () => json(person()),
        "/v1/experiences": () => json([experience("current", null, LOGO_ID)]),
        [logoUrl(LOGO_ID)]: () => apiError("not_found", 404),
      });

      const result = await loadExperience(client);

      expect(result.status === "ready" && result.content.logos).toEqual(new Map());
    });
  });

  describe("testimonial author photos", () => {
    const PHOTO_ID = "5c4b3a29-1807-4f6e-9d5c-4b3a29180716";
    const OTHER_PHOTO_ID = "2f3e4d5c-6b7a-4891-a0b1-c2d3e4f5a6b7";
    const photoUrl = (id: string) => `/v1/media/${id}`;

    function quote(slug: string, authorPhotoId: string | null): Testimonial {
      return {
        id: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c50",
        slug,
        experience: "current",
        quote: "A fictional quote.",
        authorName: "Mira Example",
        authorRole: "Editor (fictional)",
        position: 0,
        authorPhotoId,
        createdAt: STAMP,
        updatedAt: STAMP,
      };
    }

    function withQuotes(...testimonials: Testimonial[]): Experience {
      return { ...experience("current", null), testimonials };
    }

    const photo = (overrides: Partial<Media> = {}) =>
      media({
        id: PHOTO_ID,
        key: "test/mira.png",
        width: 160,
        height: 160,
        altText: "An illustrated portrait of Mira Example.",
        url: "https://media.example.test/files/test/mira.png",
        ...overrides,
      });

    it("reads each author photo once and keeps it by its media id, apart from the logos", async () => {
      const { client, requests } = clientWith({
        "/v1/person": () => json(person()),
        "/v1/experiences": () =>
          json([
            withQuotes(quote("first", PHOTO_ID), quote("second", OTHER_PHOTO_ID)),
            { ...experience("older", "2019-12-31"), testimonials: [quote("third", PHOTO_ID)] },
          ]),
        [photoUrl(PHOTO_ID)]: () => json(photo()),
        [photoUrl(OTHER_PHOTO_ID)]: () =>
          json(
            photo({ id: OTHER_PHOTO_ID, altText: null, url: "https://media.example.test/b.webp" }),
          ),
      });

      const result = await loadExperience(client);

      expect(result.status === "ready" && result.content.authorPhotos).toEqual(
        new Map([
          [
            PHOTO_ID,
            {
              url: "https://media.example.test/files/test/mira.png",
              altText: "An illustrated portrait of Mira Example.",
              width: 160,
              height: 160,
            },
          ],
          [
            OTHER_PHOTO_ID,
            { url: "https://media.example.test/b.webp", altText: "", width: 160, height: 160 },
          ],
        ]),
      );
      expect(result.status === "ready" && result.content.logos).toEqual(new Map());
      const mediaReads = requests.filter((request) =>
        new URL(request.url).pathname.startsWith("/v1/media/"),
      );
      expect(mediaReads).toHaveLength(2);
      for (const request of mediaReads) {
        expect(request.headers.get("Authorization")).toBeNull();
        expect(request.cache).toBe("no-store");
      }
    });

    it("reads no media for testimonials without a photo", async () => {
      const { client, requests } = clientWith({
        "/v1/person": () => json(person()),
        "/v1/experiences": () => json([withQuotes(quote("first", null))]),
      });

      const result = await loadExperience(client);

      expect(result.status === "ready" && result.content.authorPhotos).toEqual(new Map());
      expect(requests).toHaveLength(2);
    });

    it.each<[string, Partial<Media>]>([
      ["is not an image", { mediaType: "application/pdf" }],
      ["has no address", { url: null }],
      ["has an address that is not a web address", { url: "javascript:alert(1)" }],
      ["has no width", { width: null }],
      ["has no height", { height: null }],
    ])("leaves out an author photo that %s", async (_label, overrides) => {
      const { client } = clientWith({
        "/v1/person": () => json(person()),
        "/v1/experiences": () => json([withQuotes(quote("first", PHOTO_ID))]),
        [photoUrl(PHOTO_ID)]: () => json(photo(overrides)),
      });

      const result = await loadExperience(client);

      expect(result).toMatchObject({ status: "ready" });
      expect(result.status === "ready" && result.content.authorPhotos).toEqual(new Map());
    });

    it.each([...failures, ["does not exist", () => apiError("not_found", 404)] as [string, Route]])(
      "leaves out an author photo, and keeps the page, when its read %s",
      async (_label, route) => {
        const { client } = clientWith({
          "/v1/person": () => json(person()),
          "/v1/experiences": () => json([withQuotes(quote("first", PHOTO_ID))]),
          [photoUrl(PHOTO_ID)]: route,
        });

        const result = await loadExperience(client);

        expect(result.status === "ready" && result.content.experiences).toHaveLength(1);
        expect(result.status === "ready" && result.content.authorPhotos).toEqual(new Map());
      },
    );
  });
});
