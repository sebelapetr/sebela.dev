import { describe, expect, it } from "vitest";

import { createApiClient, type Cv, type Media, type Person } from "@sebela/api-client";

import { loadCv } from "./load-cv";

const BASE = "https://api.example.test";
const STAMP = "2026-01-01T00:00:00.000Z";
const PDF_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

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
    careerStartedOn: null,
    servicesIntro: null,
    collaborationSteps: [],
    servicesNote: null,
    photoId: null,
    cvPdfId: PDF_ID,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function pdf(overrides: Partial<Media> = {}): Media {
  return {
    id: PDF_ID,
    key: "test/cv.pdf",
    mediaType: "application/pdf",
    byteSize: 831,
    width: null,
    height: null,
    altText: null,
    url: "https://api.example.test/v1/media/files/test/cv.pdf",
    createdAt: "2026-03-14T09:30:00.000Z",
    updatedAt: "2026-03-14T09:30:00.000Z",
    ...overrides,
  };
}

function cv(overrides: Partial<Cv> = {}): Cv {
  return {
    person: person(),
    experiences: [],
    technologies: { primary: { core: [], aiEngineeringFocus: [] }, secondary: [] },
    education: [],
    explorations: [],
    cvPdf: pdf(),
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

function clientAnswering(route: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const client = createApiClient({
    baseUrl: BASE,
    fetch: async (request) => {
      requests.push(request);
      return route(request);
    },
  });
  return { client, requests };
}

describe("loadCv", () => {
  it("keeps the assembled CV as the API returns it, with the PDF's upload day", async () => {
    const given = cv({
      person: person({
        location: "Fictional City",
        email: "robin.example@example.test",
        links: [
          { label: "Code", url: "https://code.example.test/robin" },
          { label: "Unsafe", url: "javascript:alert(1)" },
        ],
      }),
    });
    const { client } = clientAnswering(() => json(given));

    expect(await loadCv(client)).toEqual({
      status: "ready",
      content: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        location: "Fictional City",
        shortBio: "Robin is **made up** for the tests.",
        contact: {
          email: {
            address: "robin.example@example.test",
            href: "mailto:robin.example@example.test",
          },
          links: [{ label: "Code", url: "https://code.example.test/robin" }],
        },
        experiences: given.experiences,
        technologies: given.technologies,
        education: given.education,
        explorations: given.explorations,
        cvPdf: { updatedOn: "2026-03-14" },
      },
    });
  });

  it("reads only the public CV route, without credentials and without a cache", async () => {
    const { client, requests } = clientAnswering(() => json(cv()));

    await loadCv(client);

    expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      ["GET", "/v1/cv"],
    ]);
    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.cache).toBe("no-store");
    }
  });

  it("has no PDF when the person has none", async () => {
    const { client } = clientAnswering(() =>
      json(cv({ person: person({ cvPdfId: null }), cvPdf: null })),
    );

    const result = await loadCv(client);
    expect(result.status === "ready" && result.content.cvPdf).toBeNull();
  });

  it("has no PDF when its file has no web address", async () => {
    const { client } = clientAnswering(() => json(cv({ cvPdf: pdf({ url: null }) })));

    const result = await loadCv(client);
    expect(result.status === "ready" && result.content.cvPdf).toBeNull();
  });

  it("dates the PDF by its upload, never by an edit of the profile", async () => {
    const { client } = clientAnswering(() =>
      json(cv({ person: person({ updatedAt: "2026-11-16T12:00:00.000Z" }) })),
    );

    const result = await loadCv(client);
    expect(result.status === "ready" && result.content.cvPdf).toEqual({ updatedOn: "2026-03-14" });
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientAnswering(() => apiError("not_found", 404));

    expect(await loadCv(client)).toEqual({ status: "missing" });
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
  ])("reports the content as unavailable when %s", async (_label, route) => {
    const { client } = clientAnswering(route);

    expect(await loadCv(client)).toEqual({ status: "unavailable" });
  });

  it("gives up on an API that does not answer in time", async () => {
    const { client } = clientAnswering(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            reject(request.signal.reason as Error);
          });
        }),
    );

    expect(await loadCv(client, { timeoutMs: 20 })).toEqual({ status: "unavailable" });
  });
});
