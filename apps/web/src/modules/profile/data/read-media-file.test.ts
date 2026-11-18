import { describe, expect, it } from "vitest";

import { readMediaFile } from "./read-media-file";

// Fictional addresses and bytes for these tests only.
const READ_BASE = "http://api.example.test/v1/media/files/test/feat-1";
const NAME = "5f0c6a52-4f7e-4c4a-9d1e-0c2b7d3e8a11.png";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type Answer = (request: Request) => Response | Promise<Response>;

function storage(answer: Answer = () => file()) {
  const requests: Request[] = [];
  const fetchFile = async (input: string, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    requests.push(request);
    return answer(request);
  };
  return { fetchFile, requests };
}

function file(bytes: Uint8Array<ArrayBuffer> = PNG, contentType = "image/png", status = 200) {
  return new Response(bytes, { status, headers: { "Content-Type": contentType } });
}

describe("readMediaFile", () => {
  it("serves a stored image's bytes from the read address, with its type", async () => {
    const { fetchFile, requests } = storage();

    const response = await readMediaFile(NAME, { mediaReadBaseUrl: READ_BASE, fetch: fetchFile });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(requests.map((request) => request.url)).toEqual([`${READ_BASE}/${NAME}`]);
  });

  it("reads uncached, without credentials and without following a redirect", async () => {
    const { fetchFile, requests } = storage();

    await readMediaFile(NAME, { mediaReadBaseUrl: READ_BASE, fetch: fetchFile });

    const [request] = requests;
    expect(request?.cache).toBe("no-store");
    expect(request?.credentials).toBe("omit");
    expect(request?.redirect).toBe("manual");
    expect(request?.headers.get("Authorization")).toBeNull();
  });

  it("forbids sniffing and running anything from the file, and lets it be cached briefly", async () => {
    const { fetchFile } = storage();

    const response = await readMediaFile(NAME, { mediaReadBaseUrl: READ_BASE, fetch: fetchFile });

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  it.each([
    ["a JPEG", "a.jpg", "image/jpeg"],
    ["a WebP image", "a-1.webp", "image/webp"],
  ])("serves %s with its own type", async (_label, name, type) => {
    const { fetchFile } = storage(() => file(PNG, type));

    const response = await readMediaFile(name, { mediaReadBaseUrl: READ_BASE, fetch: fetchFile });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(type);
  });

  it.each([
    ["a traversal", "../other/a.png"],
    ["a nested folder", "nested/a.png"],
    ["an encoded separator", "nested%2Fa.png"],
    ["a PDF", "cv.pdf"],
    ["an SVG", "a.svg"],
    ["an upper-case extension", "a.PNG"],
    ["no extension", "a"],
    ["an empty name", ""],
    ["a query", "a.png?x=1"],
  ])("answers 404 for %s and reads nothing", async (_label, name) => {
    const { fetchFile, requests } = storage();

    const response = await readMediaFile(name, { mediaReadBaseUrl: READ_BASE, fetch: fetchFile });

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(requests).toEqual([]);
  });

  it("answers 404 when the storage has no such file", async () => {
    const { fetchFile } = storage(() => new Response("{}", { status: 404 }));

    const response = await readMediaFile(NAME, { mediaReadBaseUrl: READ_BASE, fetch: fetchFile });

    expect(response.status).toBe(404);
  });

  it.each<[string, Answer]>([
    ["the storage fails", () => new Response("Bad", { status: 500 })],
    [
      "the storage redirects",
      () => new Response(null, { status: 302, headers: { Location: "http://elsewhere.test/" } }),
    ],
    ["the file is served as another type", () => file(PNG, "text/html")],
    ["the file is served as another image type", () => file(PNG, "image/jpeg")],
    [
      "the storage cannot be reached",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("answers 502 when %s, never the upstream's body", async (_label, answer) => {
    const { fetchFile } = storage(answer);

    const response = await readMediaFile(NAME, { mediaReadBaseUrl: READ_BASE, fetch: fetchFile });

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("answers 502 for a file larger than the limit", async () => {
    const { fetchFile } = storage(() => file(new Uint8Array(11)));

    const response = await readMediaFile(NAME, {
      mediaReadBaseUrl: READ_BASE,
      fetch: fetchFile,
      maxBytes: 10,
    });

    expect(response.status).toBe(502);
  });

  it("serves a file exactly at the limit", async () => {
    const { fetchFile } = storage(() => file(new Uint8Array(10)));

    const response = await readMediaFile(NAME, {
      mediaReadBaseUrl: READ_BASE,
      fetch: fetchFile,
      maxBytes: 10,
    });

    expect(response.status).toBe(200);
  });

  it("answers 502 when the file does not arrive in time", async () => {
    const { fetchFile } = storage(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            reject(request.signal.reason as Error);
          });
        }),
    );

    const response = await readMediaFile(NAME, {
      mediaReadBaseUrl: READ_BASE,
      fetch: fetchFile,
      timeoutMs: 20,
    });

    expect(response.status).toBe(502);
  });
});
