import { describe, expect, it } from "vitest";

import { createApiClient, type Cv, type Media, type Person } from "@sebela/api-client";

import { readCvPdfFile } from "./read-cv-pdf-file";

const BASE = "https://api.example.test";
const STAMP = "2026-01-01T00:00:00.000Z";
const PDF_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const FILE_URL = "https://api.example.test/v1/media/files/test/cv.pdf";
const PDF_BYTES = Uint8Array.from(new TextEncoder().encode("%PDF-1.4\n% a fictional CV\n%%EOF\n"));

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "0b6f4f43-61a4-4c1e-8f0e-6f1c1c5d2a10",
    name: "Robin Example",
    headline: "Fictional engineer for tests",
    shortBio: "Robin is made up for the tests.",
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
    byteSize: PDF_BYTES.byteLength,
    width: null,
    height: null,
    altText: null,
    url: FILE_URL,
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

function pdfFile(
  bytes: Uint8Array<ArrayBuffer> = PDF_BYTES,
  contentType = "application/pdf",
): Response {
  return new Response(bytes, { status: 200, headers: { "Content-Type": contentType } });
}

type Route = (request: Request) => Response | Promise<Response>;

/** One fake network: the API's CV route and the PDF file's own address. */
function network(routes: { cv: Route; file?: Route; fileUrl?: string }) {
  const requests: Request[] = [];
  const answer = async (request: Request): Promise<Response> => {
    requests.push(request);
    if (
      request.url === FILE_URL ||
      (routes.fileUrl !== undefined && request.url === routes.fileUrl)
    ) {
      if (!routes.file) throw new Error("unexpected request for the file");
      return routes.file(request);
    }
    if (new URL(request.url).pathname === "/v1/cv") return routes.cv(request);
    throw new Error(`unexpected request to ${request.url}`);
  };
  const client = createApiClient({ baseUrl: BASE, fetch: answer });
  const fetchFile = (input: string, init?: RequestInit) => answer(new Request(input, init));
  return { client, fetchFile, requests };
}

describe("readCvPdfFile", () => {
  it("reads the current PDF's bytes from the file the CV names", async () => {
    const { client, fetchFile } = network({ cv: () => json(cv()), file: () => pdfFile() });

    expect(await readCvPdfFile(client, { apiBaseUrl: BASE, fetch: fetchFile })).toEqual({
      status: "ready",
      bytes: PDF_BYTES,
      personName: "Robin Example",
    });
  });

  it("asks the API's public routes only, uncached and without credentials", async () => {
    const { client, fetchFile, requests } = network({
      cv: () => json(cv()),
      file: () => pdfFile(),
    });

    await readCvPdfFile(client, { apiBaseUrl: BASE, fetch: fetchFile });

    expect(requests.map((request) => request.url)).toEqual([`${BASE}/v1/cv`, FILE_URL]);
    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBeNull();
      expect(request.cache).toBe("no-store");
    }
  });

  it("reports no PDF when the person has none, and asks for no file", async () => {
    const { client, fetchFile, requests } = network({
      cv: () => json(cv({ person: person({ cvPdfId: null }), cvPdf: null })),
    });

    expect(await readCvPdfFile(client, { apiBaseUrl: BASE, fetch: fetchFile })).toEqual({
      status: "none",
    });
    expect(requests).toHaveLength(1);
  });

  it("reports no PDF when no profile is published", async () => {
    const { client, fetchFile } = network({
      cv: () => json({ error: { code: "not_found", message: "A fictional failure." } }, 404),
    });

    expect(await readCvPdfFile(client, { apiBaseUrl: BASE, fetch: fetchFile })).toEqual({
      status: "none",
    });
  });

  it.each<[string, Partial<{ cv: Route; file: Route }>]>([
    ["the CV cannot be read", { cv: () => new Response("Bad gateway", { status: 502 }) }],
    [
      "the API cannot be reached",
      {
        cv: () => {
          throw new TypeError("fetch failed");
        },
      },
    ],
    ["the PDF has no web address", { cv: () => json(cv({ cvPdf: pdf({ url: null }) })) }],
    [
      "the file is missing",
      {
        file: () => json({ error: { code: "not_found", message: "A fictional failure." } }, 404),
      },
    ],
    ["the file is not served as a PDF", { file: () => pdfFile(PDF_BYTES, "text/html") }],
    [
      "the file's bytes are not a PDF",
      { file: () => pdfFile(Uint8Array.from(new TextEncoder().encode("<html>not a pdf</html>"))) },
    ],
    [
      "the file cannot be fetched",
      {
        file: () => {
          throw new TypeError("fetch failed");
        },
      },
    ],
  ])("reports the PDF as unavailable when %s, never as a download", async (_label, given) => {
    const { client, fetchFile } = network({
      cv: given.cv ?? (() => json(cv())),
      file: given.file ?? (() => pdfFile()),
    });

    expect(await readCvPdfFile(client, { apiBaseUrl: BASE, fetch: fetchFile })).toEqual({
      status: "unavailable",
    });
  });

  it.each([
    ["a plain http address outside the API", "http://files.example.test/cv.pdf"],
    ["an address that is not on the web", "ftp://files.example.test/cv.pdf"],
  ])("never fetches the file from %s", async (_label, url) => {
    const { client, fetchFile, requests } = network({
      cv: () => json(cv({ cvPdf: pdf({ url }) })),
      file: () => pdfFile(),
      fileUrl: url,
    });

    expect(await readCvPdfFile(client, { apiBaseUrl: BASE, fetch: fetchFile })).toEqual({
      status: "unavailable",
    });
    expect(requests.map((request) => request.url)).toEqual([`${BASE}/v1/cv`]);
  });

  it("reads a plain http file only from the API's own origin, where local storage is served", async () => {
    const api = "http://localhost:4100";
    const url = `${api}/v1/media/files/test/cv.pdf`;
    const requests: string[] = [];
    const answer = (request: Request): Promise<Response> => {
      requests.push(request.url);
      return Promise.resolve(request.url === url ? pdfFile() : json(cv({ cvPdf: pdf({ url }) })));
    };
    const client = createApiClient({ baseUrl: api, fetch: answer });
    const fetchFile = (input: string, init?: RequestInit) => answer(new Request(input, init));

    expect(await readCvPdfFile(client, { apiBaseUrl: api, fetch: fetchFile })).toMatchObject({
      status: "ready",
    });
    expect(requests).toEqual([`${api}/v1/cv`, url]);
  });

  it("does not follow a redirect from the file's address", async () => {
    const { client, fetchFile, requests } = network({
      cv: () => json(cv()),
      file: (request) =>
        request.redirect === "manual"
          ? new Response(null, { status: 302, headers: { Location: "http://elsewhere.test/" } })
          : pdfFile(),
    });

    expect(await readCvPdfFile(client, { apiBaseUrl: BASE, fetch: fetchFile })).toEqual({
      status: "unavailable",
    });
    expect(requests.at(-1)?.redirect).toBe("manual");
  });

  it("gives up on a file that does not arrive in time", async () => {
    const { client, fetchFile } = network({
      cv: () => json(cv()),
      file: (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            reject(request.signal.reason as Error);
          });
        }),
    });

    expect(
      await readCvPdfFile(client, { apiBaseUrl: BASE, fetch: fetchFile, timeoutMs: 20 }),
    ).toEqual({
      status: "unavailable",
    });
  });
});
