import { describe, expect, it } from "vitest";

import { createApiClient, type Media, type Person } from "@sebela/api-client";

import { loadHomepage } from "./load-homepage";

const BASE = "https://api.example.test";
const PHOTO_ID = "5f0c6a52-4f7e-4c4a-9d1e-0c2b7d3e8a11";

/** A fictional person as the public route returns it. */
function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "0b6f4f43-61a4-4c1e-8f0e-6f1c1c5d2a10",
    name: "Robin Example",
    headline: "Fictional engineer for tests",
    shortBio: "Robin is **made up** for the tests.",
    longBio: null,
    location: null,
    email: "robin@example.test",
    links: [
      { label: "Code", url: "https://code.example.test/robin" },
      { label: "Notes", url: "https://notes.example.test/" },
    ],
    availability: null,
    careerStartedOn: null,
    photoId: PHOTO_ID,
    cvPdfId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function media(overrides: Partial<Media> = {}): Media {
  return {
    id: PHOTO_ID,
    key: "test/portrait.png",
    mediaType: "image/png",
    byteSize: 1234,
    width: 640,
    height: 800,
    altText: "A fictional portrait.",
    url: "https://media.example.test/files/test/portrait.png",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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

/** A client whose requests go to `routes` by path; an unknown path fails the test. */
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

describe("loadHomepage", () => {
  it("maps the person and the photo to the homepage's content", async () => {
    const { client } = clientWith({
      "/v1/person": () => json(person()),
      [`/v1/media/${PHOTO_ID}`]: () => json(media()),
    });

    expect(await loadHomepage(client)).toEqual({
      status: "ready",
      profile: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        shortBio: "Robin is **made up** for the tests.",
        photo: {
          url: "https://media.example.test/files/test/portrait.png",
          altText: "A fictional portrait.",
          width: 640,
          height: 800,
        },
        contact: {
          email: { address: "robin@example.test", href: "mailto:robin@example.test" },
          links: [
            { label: "Code", url: "https://code.example.test/robin" },
            { label: "Notes", url: "https://notes.example.test/" },
          ],
        },
      },
    });
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      [`/v1/media/${PHOTO_ID}`]: () => json(media()),
    });

    await loadHomepage(client);

    expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      ["GET", "/v1/person"],
      ["GET", `/v1/media/${PHOTO_ID}`],
    ]);
    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.cache).toBe("no-store");
    }
  });

  describe("the photo", () => {
    it("is absent without a photo, and the media route is not asked", async () => {
      const { client, requests } = clientWith({
        "/v1/person": () => json(person({ photoId: null })),
      });

      const result = await loadHomepage(client);

      expect(result.status === "ready" && result.profile.photo).toBeNull();
      expect(requests).toHaveLength(1);
    });

    it.each([
      ["the media is gone", () => apiError("not_found", 404)],
      ["the media read fails", () => apiError("internal_error", 500)],
      ["the storage cannot address the file", () => json(media({ url: null }))],
      ["the media is not an image", () => json(media({ mediaType: "application/pdf" }))],
      ["the media has no dimensions", () => json(media({ width: null, height: null }))],
      [
        "the media request fails on the network",
        () => {
          throw new TypeError("fetch failed");
        },
      ],
    ])("falls back to no photo when %s", async (_label, mediaRoute) => {
      const { client } = clientWith({
        "/v1/person": () => json(person()),
        [`/v1/media/${PHOTO_ID}`]: mediaRoute,
      });

      const result = await loadHomepage(client);

      expect(result.status).toBe("ready");
      expect(result.status === "ready" && result.profile.photo).toBeNull();
    });

    it("keeps a missing alternative text empty instead of inventing one", async () => {
      const { client } = clientWith({
        "/v1/person": () => json(person()),
        [`/v1/media/${PHOTO_ID}`]: () => json(media({ altText: null })),
      });

      const result = await loadHomepage(client);

      expect(result.status === "ready" && result.profile.photo?.altText).toBe("");
    });
  });

  describe("the contact", () => {
    it("has no email without one", async () => {
      const { client } = clientWith({
        "/v1/person": () => json(person({ email: null, photoId: null })),
      });

      const result = await loadHomepage(client);

      expect(result.status === "ready" && result.profile.contact.email).toBeNull();
    });

    it("encodes the email address in the mailto link", async () => {
      const { client } = clientWith({
        "/v1/person": () => json(person({ email: "robin+web@example.test", photoId: null })),
      });

      const result = await loadHomepage(client);

      expect(result.status === "ready" && result.profile.contact.email).toEqual({
        address: "robin+web@example.test",
        href: "mailto:robin%2Bweb@example.test",
      });
    });

    it("keeps only web links, in their order", async () => {
      const { client } = clientWith({
        "/v1/person": () =>
          json(
            person({
              photoId: null,
              links: [
                { label: "Script", url: "javascript:alert(1)" },
                { label: "Plain", url: "http://plain.example.test/" },
                { label: "Data", url: "data:text/html,hi" },
                { label: "Secure", url: "https://secure.example.test/" },
              ],
            }),
          ),
      });

      const result = await loadHomepage(client);

      expect(result.status === "ready" && result.profile.contact.links).toEqual([
        { label: "Plain", url: "http://plain.example.test/" },
        { label: "Secure", url: "https://secure.example.test/" },
      ]);
    });
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({ "/v1/person": () => apiError("not_found", 404) });

    expect(await loadHomepage(client)).toEqual({ status: "missing" });
  });

  it.each([
    ["the API fails", () => apiError("internal_error", 500)],
    ["the API is rate limited", () => apiError("rate_limited", 429)],
    ["a proxy answers without the API", () => new Response("Bad gateway", { status: 502 })],
    [
      "the API cannot be reached",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
    [
      "the API does not answer in time",
      () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
    ],
  ])("reports the content as unavailable when %s", async (_label, personRoute) => {
    const { client } = clientWith({ "/v1/person": personRoute });

    expect(await loadHomepage(client)).toEqual({ status: "unavailable" });
  });

  it("gives up on an API that does not answer in time", async () => {
    const { client } = clientWith({
      "/v1/person": (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            reject(request.signal.reason as Error);
          });
        }),
    });

    expect(await loadHomepage(client, { timeoutMs: 20 })).toEqual({ status: "unavailable" });
  });
});
