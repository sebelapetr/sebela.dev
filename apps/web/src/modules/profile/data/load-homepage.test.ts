import { describe, expect, it } from "vitest";

import {
  createApiClient,
  type CurrentFocus,
  type Experience,
  type Exploration,
  type Media,
  type Person,
  type Project,
  type Service,
  type Technology,
} from "@sebela/api-client";

import { loadHomepage } from "./load-homepage";

const BASE = "https://api.example.test";
const STAMP = "2026-01-01T00:00:00.000Z";
/** The configured media folder the fixtures' addresses are in. */
const OPTIONS = { mediaBaseUrl: "https://media.example.test/files/test" };
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
    servicesIntro: null,
    collaborationSteps: [],
    servicesNote: null,
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

/** A fictional project as the public route returns it. */
function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "2e4f6a8c-0b1d-4e3f-8a5c-7e9b1d3f5a70",
    slug: "fictional-route-planner",
    experience: "fictional-staff-engineer",
    name: "Route planner",
    summary: "Plans fictional delivery routes.",
    problem: "Drivers planned routes by hand.",
    workDone: "Built a planner.",
    result: "The team plans a day in minutes.",
    startedOn: "2022-05-02",
    endedOn: null,
    links: [],
    selectedForHomepage: true,
    position: 0,
    coverId: null,
    technologies: [],
    caseStudy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A fictional experience as the public list returns it, with its projects. */
function experience(overrides: Partial<Experience> = {}): Experience {
  return {
    id: "6c1d3e5f-7a9b-4c2d-8e0f-1a3b5c7d9e21",
    slug: "fictional-staff-engineer",
    title: "Staff engineer",
    kind: "main_job",
    startedOn: "2022-01-03",
    endedOn: null,
    summary: "Fictional work for tests.",
    responsibilities: [],
    inCv: true,
    organization: {
      id: "7d2e4f6a-8b0c-4d3e-9f1a-2b4c6d8e0f32",
      slug: "fictional-company",
      name: "Fictional Company",
      website: null,
      description: null,
      logoId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    technologies: [],
    projects: [],
    testimonials: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function technology(overrides: Partial<Technology> = {}): Technology {
  return {
    id: "8e3f5a7b-9c1d-4e4f-8a2b-3c5d7e9f1a43",
    slug: "fictional-language",
    name: "Fictional Language",
    tier: "primary",
    group: "core",
    logoKey: null,
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function focus(overrides: Partial<CurrentFocus> = {}): CurrentFocus {
  return {
    id: "9f4a6b8c-0d2e-4f5a-9b3c-4d6e8f0a2b54",
    slug: "fictional-focus",
    title: "A fictional focus",
    description: "Something **made up** for tests.",
    link: null,
    position: 0,
    project: null,
    topics: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function exploration(overrides: Partial<Exploration> = {}): Exploration {
  return {
    id: "0a5b7c9d-1e3f-4a6b-8c4d-5e7f9a1b3c65",
    slug: "fictional-exploration",
    name: "Fictional exploration",
    summary: "A made-up experiment.",
    status: "tested",
    concepts: [],
    startedOn: "2026-02-01",
    endedOn: null,
    position: 0,
    technologies: [],
    topics: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: "1b6c8d0e-2f4a-4b7c-9d5e-6f8a0b2c4d76",
    slug: "fictional-service",
    name: "Fictional service",
    summary: "A made-up service.",
    audience: "Fictional teams.",
    deliverable: "A fictional tool.",
    position: 0,
    evidence: [],
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

/** Requests a test leaves unanswered on purpose, held for as long as the file runs. */
const hanging: Request[] = [];

/** The public list routes the homepage reads besides the person, each empty by default. */
const LISTS = [
  "/v1/experiences",
  "/v1/technologies",
  "/v1/current-focus",
  "/v1/explorations",
  "/v1/services",
  "/v1/roadmap/current",
] as const;

/** What a list route answers when a test does not say: nothing published. */
function emptyAnswer(path: (typeof LISTS)[number]): unknown {
  return path === "/v1/roadmap/current" ? { areas: [] } : [];
}

/**
 * A client whose requests go to `routes` by path; an unknown path fails the test. The list routes
 * answer with empty lists unless `routes` says otherwise.
 */
function clientWith(given: Record<string, Route>) {
  const routes: Record<string, Route> = {
    ...Object.fromEntries(LISTS.map((path) => [path, () => json(emptyAnswer(path))])),
    ...given,
  };
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

    expect(await loadHomepage(client, OPTIONS)).toEqual({
      status: "ready",
      profile: {
        name: "Robin Example",
        headline: "Fictional engineer for tests",
        shortBio: "Robin is **made up** for the tests.",
        photo: {
          url: "/media/portrait.png",
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
        careerStartedOn: null,
        experiences: [],
        projects: [],
        technologies: [],
        currentFocus: [],
        explorations: [],
        services: [],
        currentLearning: [],
        cvPdf: null,
      },
    });
  });

  it("reads only public routes, without credentials and without a cache", async () => {
    const { client, requests } = clientWith({
      "/v1/person": () => json(person()),
      [`/v1/media/${PHOTO_ID}`]: () => json(media()),
    });

    await loadHomepage(client, OPTIONS);

    expect(
      requests.map((request) => `${request.method} ${new URL(request.url).pathname}`).sort(),
    ).toEqual(
      ["/v1/person", ...LISTS, `/v1/media/${PHOTO_ID}`].map((path) => `GET ${path}`).sort(),
    );
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

      const result = await loadHomepage(client, OPTIONS);

      expect(result.status === "ready" && result.profile.photo).toBeNull();
      expect(requests.map((request) => new URL(request.url).pathname)).not.toContain(
        `/v1/media/${PHOTO_ID}`,
      );
    });

    it.each([
      ["the media is gone", () => apiError("not_found", 404)],
      ["the media read fails", () => apiError("internal_error", 500)],
      ["the storage cannot address the file", () => json(media({ url: null }))],
      ["the media is not an image", () => json(media({ mediaType: "application/pdf" }))],
      ["the media has no dimensions", () => json(media({ width: null, height: null }))],
      [
        "the file is outside the configured media folder",
        () => json(media({ url: "https://media.example.test/files/other/portrait.png" })),
      ],
      [
        "the file is on another host",
        () => json(media({ url: "https://elsewhere.example.test/files/test/portrait.png" })),
      ],
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

      const result = await loadHomepage(client, OPTIONS);

      expect(result.status).toBe("ready");
      expect(result.status === "ready" && result.profile.photo).toBeNull();
    });

    it("keeps a missing alternative text empty instead of inventing one", async () => {
      const { client } = clientWith({
        "/v1/person": () => json(person()),
        [`/v1/media/${PHOTO_ID}`]: () => json(media({ altText: null })),
      });

      const result = await loadHomepage(client, OPTIONS);

      expect(result.status === "ready" && result.profile.photo?.altText).toBe("");
    });
  });

  describe("the contact", () => {
    it("has no email without one", async () => {
      const { client } = clientWith({
        "/v1/person": () => json(person({ email: null, photoId: null })),
      });

      const result = await loadHomepage(client, OPTIONS);

      expect(result.status === "ready" && result.profile.contact.email).toBeNull();
    });

    it("encodes the email address in the mailto link", async () => {
      const { client } = clientWith({
        "/v1/person": () => json(person({ email: "robin+web@example.test", photoId: null })),
      });

      const result = await loadHomepage(client, OPTIONS);

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

      const result = await loadHomepage(client, OPTIONS);

      expect(result.status === "ready" && result.profile.contact.links).toEqual([
        { label: "Plain", url: "http://plain.example.test/" },
        { label: "Secure", url: "https://secure.example.test/" },
      ]);
    });
  });

  describe("the CV PDF", () => {
    const PDF_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    const pdf = () =>
      media({
        id: PDF_ID,
        key: "test/cv.pdf",
        mediaType: "application/pdf",
        width: null,
        height: null,
        altText: null,
        url: "https://media.example.test/files/test/cv.pdf",
        createdAt: "2026-03-14T09:30:00.000Z",
        updatedAt: "2026-10-01T09:30:00.000Z",
      });

    it("is dated by the day the current file was uploaded", async () => {
      const { client } = clientWith({
        "/v1/person": () => json(person({ photoId: null, cvPdfId: PDF_ID })),
        [`/v1/media/${PDF_ID}`]: () => json(pdf()),
      });

      const result = await loadHomepage(client, OPTIONS);
      expect(result.status === "ready" && result.profile.cvPdf).toEqual({
        updatedOn: "2026-03-14",
      });
    });

    it("is absent without one, and the media route is not asked", async () => {
      const { client, requests } = clientWith({
        "/v1/person": () => json(person({ photoId: null, cvPdfId: null })),
      });

      const result = await loadHomepage(client, OPTIONS);
      expect(result.status === "ready" && result.profile.cvPdf).toBeNull();
      expect(
        requests.some((request) => new URL(request.url).pathname.startsWith("/v1/media/")),
      ).toBe(false);
    });

    it("is absent, and the homepage still ready, when its media cannot be read", async () => {
      const { client } = clientWith({
        "/v1/person": () => json(person({ photoId: null, cvPdfId: PDF_ID })),
        [`/v1/media/${PDF_ID}`]: () => apiError("internal_error", 500),
      });

      const result = await loadHomepage(client, OPTIONS);
      expect(result.status).toBe("ready");
      expect(result.status === "ready" && result.profile.cvPdf).toBeNull();
    });
  });

  describe("the profile's records", () => {
    it("keeps every published record in the API's order", async () => {
      const technologies = [
        technology({ slug: "core-one" }),
        technology({ slug: "ai-one", group: "ai_engineering_focus" }),
      ];
      const currentFocus = [focus({ slug: "first" }), focus({ slug: "second", position: 1 })];
      const explorations = [
        exploration({ slug: "ongoing" }),
        exploration({ slug: "ended", endedOn: "2026-03-01" }),
      ];
      const services = [service({ slug: "one" }), service({ slug: "two", position: 1 })];
      const { client } = clientWith({
        "/v1/person": () => json(person({ photoId: null, careerStartedOn: "2018-03-01" })),
        "/v1/technologies": () => json(technologies),
        "/v1/current-focus": () => json(currentFocus),
        "/v1/explorations": () => json(explorations),
        "/v1/services": () => json(services),
      });

      const result = await loadHomepage(client, OPTIONS);
      if (result.status !== "ready") throw new Error("not ready");

      expect(result.profile.careerStartedOn).toBe("2018-03-01");
      expect(result.profile.technologies).toEqual(technologies);
      expect(result.profile.currentFocus).toEqual(currentFocus);
      expect(result.profile.explorations).toEqual(explorations);
      expect(result.profile.services).toEqual(services);
    });

    it("keeps the roadmap's current learning as the API answered it", async () => {
      const current = {
        areas: [
          {
            id: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a81",
            slug: "fictional-area",
            name: "Fictional area",
            description: null,
            weight: 20,
            position: 0,
            createdAt: STAMP,
            updatedAt: STAMP,
            progress: {
              completed: 1,
              total: 3,
              status: "in-progress",
              completedAt: null,
              lastUpdatedAt: STAMP,
              estimatedMinutes: 120,
            },
            modules: [
              {
                id: "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b92",
                slug: "fictional-module",
                name: "Fictional module",
                description: null,
                position: 0,
                createdAt: STAMP,
                updatedAt: STAMP,
                progress: {
                  completed: 1,
                  total: 2,
                  status: "in-progress",
                  completedAt: null,
                  lastUpdatedAt: STAMP,
                  estimatedMinutes: 60,
                },
              },
            ],
          },
        ],
      };
      const { client } = clientWith({
        "/v1/person": () => json(person({ photoId: null })),
        "/v1/roadmap/current": () => json(current),
      });

      const result = await loadHomepage(client, OPTIONS);
      if (result.status !== "ready") throw new Error("not ready");

      expect(result.profile.currentLearning).toEqual(current.areas);
    });

    it("keeps every project of the experiences in their order, for the homepage to select from", async () => {
      const first = [
        project({ slug: "first" }),
        project({ slug: "not-selected", selectedForHomepage: false }),
      ];
      const second = [project({ slug: "second", experience: "fictional-older-role" })];
      const experiences = [
        experience({ projects: first }),
        experience({ slug: "fictional-without-projects" }),
        experience({ slug: "fictional-older-role", endedOn: "2021-12-31", projects: second }),
      ];
      const { client, requests } = clientWith({
        "/v1/person": () => json(person({ photoId: null })),
        "/v1/experiences": () => json(experiences),
      });

      const result = await loadHomepage(client, OPTIONS);
      if (result.status !== "ready") throw new Error("not ready");

      expect(result.profile.experiences).toEqual(experiences);
      expect(result.profile.projects).toEqual([...first, ...second]);
      // The experiences carry their projects: the projects route is not asked as well.
      expect(requests.map((request) => new URL(request.url).pathname)).not.toContain(
        "/v1/projects",
      );
    });

    describe.each(LISTS)("when %s cannot be read", (path) => {
      it.each([
        ["the read fails", () => apiError("internal_error", 500)],
        ["the read is rate limited", () => apiError("rate_limited", 429)],
        [
          "the request fails on the network",
          () => {
            throw new TypeError("fetch failed");
          },
        ],
      ])(
        "reports the content as unavailable when %s, never as content left out",
        async (_label, route) => {
          const { client } = clientWith({
            "/v1/person": () => json(person({ photoId: null })),
            [path]: route,
          });

          expect(await loadHomepage(client, OPTIONS)).toEqual({ status: "unavailable" });
        },
      );
    });
  });

  it("reports a profile that does not exist yet as missing", async () => {
    const { client } = clientWith({ "/v1/person": () => apiError("not_found", 404) });

    expect(await loadHomepage(client, OPTIONS)).toEqual({ status: "missing" });
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

    expect(await loadHomepage(client, OPTIONS)).toEqual({ status: "unavailable" });
  });

  it("gives up on an API that does not answer in time", async () => {
    const { client } = clientWith({
      "/v1/person": (request) =>
        new Promise<Response>((_resolve, reject) => {
          // A real fetch holds its request until it settles. This fake one never settles, so it is
          // held here; otherwise the request, and with it the timeout's signal, which Node holds
          // only weakly, could be collected before the timeout fires.
          hanging.push(request);
          request.signal.addEventListener("abort", () => {
            reject(request.signal.reason as Error);
          });
        }),
    });

    expect(await loadHomepage(client, { ...OPTIONS, timeoutMs: 20 })).toEqual({
      status: "unavailable",
    });
  });
});
