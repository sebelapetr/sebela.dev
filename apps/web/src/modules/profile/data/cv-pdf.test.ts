import { describe, expect, it } from "vitest";

import { createApiClient, type Media } from "@sebela/api-client";

import { readCvPdf, toCvPdf } from "./cv-pdf";

const BASE = "https://api.example.test";
const PDF_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

/** A fictional CV PDF as the public media route returns it. */
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

const init = () => ({ cache: "no-store" as const, signal: AbortSignal.timeout(1_000) });

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("toCvPdf", () => {
  it("dates the PDF by the day its file was uploaded", () => {
    expect(toCvPdf(pdf())).toEqual({ updatedOn: "2026-03-14" });
  });

  it("reads the upload day in UTC, whatever the offset the time carries", () => {
    expect(toCvPdf(pdf({ createdAt: "2026-03-14T23:30:00.000-02:00" }))).toEqual({
      updatedOn: "2026-03-15",
    });
  });

  it("ignores a later edit of the media's metadata: the file itself did not change", () => {
    expect(toCvPdf(pdf({ updatedAt: "2026-11-01T08:00:00.000Z" }))).toEqual({
      updatedOn: "2026-03-14",
    });
  });

  it("is absent without a PDF", () => {
    expect(toCvPdf(null)).toBeNull();
  });

  it("is absent for media that is not a PDF", () => {
    expect(toCvPdf(pdf({ mediaType: "image/png" }))).toBeNull();
  });

  it("is absent for a file without a web address", () => {
    expect(toCvPdf(pdf({ url: null }))).toBeNull();
    expect(toCvPdf(pdf({ url: "file:///srv/cv.pdf" }))).toBeNull();
  });
});

describe("readCvPdf", () => {
  it("reads the PDF's media from the public media route, uncached and without credentials", async () => {
    const { client, requests } = clientAnswering(() => json(pdf()));

    expect(await readCvPdf(client, PDF_ID, init())).toEqual({ updatedOn: "2026-03-14" });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(new URL(request?.url ?? "").pathname).toBe(`/v1/media/${PDF_ID}`);
    expect(request?.headers.get("Authorization")).toBeNull();
    expect(request?.cache).toBe("no-store");
  });

  it("is absent when the media no longer exists", async () => {
    const { client } = clientAnswering(() =>
      json({ error: { code: "not_found", message: "A fictional failure." } }, 404),
    );

    expect(await readCvPdf(client, PDF_ID, init())).toBeNull();
  });

  it("is absent, without throwing, when the read fails", async () => {
    const { client } = clientAnswering(() => {
      throw new TypeError("fetch failed");
    });

    expect(await readCvPdf(client, PDF_ID, init())).toBeNull();
  });
});
