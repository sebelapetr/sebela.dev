import { readdir } from "node:fs/promises";
import { dirname } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MediaListSchema, MediaSchema, type Media } from "@sebela/contracts";
import { samplePdf, samplePng, sampleJpeg, sampleWebp } from "@sebela/services/testing";

import type { WriteEvent } from "./app.js";
import { logCleanupFailure } from "./modules/media/index.js";
import {
  anyText,
  bearer,
  connection,
  json,
  MEDIA_LIMITS,
  MEDIA_PUBLIC_BASE,
  openTestBackend,
  person,
  testConfig,
  upload,
  type TestBackend,
} from "./test-support.js";

const png = { bytes: samplePng({ width: 4, height: 3 }), name: "portrait.png", type: "image/png" };
const pdf = { bytes: samplePdf(), name: "cv.pdf", type: "application/pdf" };
const KEY = /^test\/[0-9a-f-]{36}\.(png|jpg|webp|pdf)$/;

describe("the media API", () => {
  let backend: TestBackend;
  let auth: Record<string, string>;

  beforeAll(async () => {
    backend = await openTestBackend();
    auth = bearer((await backend.services.apiKeys.createKey("media routes")).key);
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    const { profile, media } = backend.services;
    await profile.deletePerson().catch(() => undefined);
    for (const { slug } of await profile.listProjects()) await profile.deleteProject(slug);
    for (const { slug } of await profile.listExperiences()) await profile.deleteExperience(slug);
    for (const { slug } of await profile.listOrganizations()) {
      await profile.deleteOrganization(slug);
    }
    for (const { id } of await media.listMedia()) await media.deleteMedia(id);
    backend.cleanupFailures.length = 0;
  });

  const request = (path: string, method = "GET", init: RequestInit = {}) =>
    backend.api().app.request(path, { method, ...init }, connection());

  const send = (file: { bytes: Uint8Array; name: string; type?: string }, altText?: string) =>
    request("/v1/media", "POST", upload(file, altText === undefined ? {} : { altText }, auth));

  async function uploaded(file = png, altText?: string): Promise<Media> {
    const response = await send(file, altText);
    expect(response.status).toBe(201);
    return MediaSchema.parse(await response.json());
  }

  async function expectNothingStored() {
    await expect(backend.services.media.listMedia()).resolves.toEqual([]);
    await expect(backend.storedFiles()).resolves.toEqual([]);
  }

  describe("uploading", () => {
    it("lists no media publicly", async () => {
      const response = await request("/v1/media");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    });

    it("stores an image under a generated key with the type, size and dimensions it proves", async () => {
      const response = await send(png, "A fictional portrait");

      expect(response.status).toBe(201);
      const body = MediaSchema.parse(await response.json());
      expect(response.headers.get("location")).toBe(`/v1/media/${body.id}`);
      expect(body).toMatchObject({
        mediaType: "image/png",
        byteSize: png.bytes.byteLength,
        width: 4,
        height: 3,
        altText: "A fictional portrait",
      });
      expect(body.key).toMatch(KEY);
      expect(body.key.endsWith(".png")).toBe(true);
      expect(body.url).toBe(`${MEDIA_PUBLIC_BASE}/${body.key}`);
      await expect(backend.storedFiles()).resolves.toEqual([body.key]);

      const read = await request(`/v1/media/${body.id}`);
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual(body);
      const list = await request("/v1/media");
      expect(MediaListSchema.parse(await list.json())).toEqual([body]);
    });

    it("accepts JPEG, WebP and PDF, and a generic declared type judged by the content", async () => {
      const jpeg = await uploaded({
        bytes: sampleJpeg({ width: 10, height: 20 }),
        name: "photo.JPEG",
        type: "image/jpeg",
      });
      const webp = await uploaded({
        bytes: sampleWebp({ width: 30, height: 40 }),
        name: "logo.webp",
        type: "application/octet-stream",
      });
      const document = await uploaded(pdf);

      expect(jpeg).toMatchObject({ mediaType: "image/jpeg", width: 10, height: 20 });
      expect(jpeg.key.endsWith(".jpg")).toBe(true);
      expect(webp).toMatchObject({ mediaType: "image/webp", width: 30, height: 40 });
      expect(document).toMatchObject({
        mediaType: "application/pdf",
        width: null,
        height: null,
        altText: null,
      });
    });

    it("never lets the original file name choose the destination", async () => {
      const media = await uploaded({ ...png, name: "../../../escape.png" });

      expect(media.key).toMatch(KEY);
      await expect(backend.storedFiles()).resolves.toEqual([media.key]);
      expect(await readdir(dirname(backend.storageRoot))).not.toContain("escape.png");
    });

    it("reports a successful upload as a write", async () => {
      const events: WriteEvent[] = [];
      const response = await backend
        .api({
          onWrite: (event) => {
            events.push(event);
            return Promise.resolve();
          },
        })
        .app.request("/v1/media", { method: "POST", ...upload(png, {}, auth) }, connection());

      expect(response.status).toBe(201);
      expect(events).toEqual([{ operationId: "uploadMedia", method: "POST", path: "/v1/media" }]);
    });
  });

  describe("refusing uploads", () => {
    it("refuses a file that is not an accepted type", async () => {
      const response = await send({
        bytes: Buffer.from("fictional notes"),
        name: "notes.txt",
        type: "text/plain",
      });

      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({
        error: { code: "unsupported_media_type", message: anyText },
      });
      await expectNothingStored();
    });

    it("refuses a declared type or extension that contradicts the content", async () => {
      for (const file of [
        { ...png, type: "image/jpeg" },
        { ...png, name: "portrait.jpg" },
        { ...png, name: "portrait.pdf", type: "application/pdf" },
        { ...pdf, name: "cv.png", type: "image/png" },
        { ...png, type: "text/html" },
      ]) {
        const response = await send(file);

        expect(response.status, `${file.name} as ${file.type}`).toBe(415);
        expect(await response.json()).toMatchObject({ error: { code: "unsupported_media_type" } });
      }
      await expectNothingStored();
    });

    it("refuses a malformed or empty file, naming the file field", async () => {
      for (const bytes of [png.bytes.subarray(0, png.bytes.length - 8), Buffer.alloc(0)]) {
        const response = await send({ ...png, bytes });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: {
            code: "validation_failed",
            message: anyText,
            fields: [{ path: "file", message: anyText }],
          },
        });
      }
      await expectNothingStored();
    });

    it("refuses an image larger than the dimension limit", async () => {
      const response = await send({
        ...png,
        bytes: samplePng({ width: MEDIA_LIMITS.maxImageDimension + 1, height: 1 }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "validation_failed", fields: [{ path: "file" }] },
      });
      await expectNothingStored();
    });

    it("refuses a file over the byte limit", async () => {
      const padded = Buffer.concat([
        Buffer.from("%PDF-1.7\n%"),
        Buffer.alloc(MEDIA_LIMITS.maxBytes, 0x20),
        Buffer.from("\n%%EOF\n"),
      ]);
      const response = await send({ ...pdf, bytes: padded });

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({
        error: { code: "payload_too_large", message: anyText },
      });
      await expectNothingStored();
    });

    it("stops receiving a body far over the limit", async () => {
      const response = await send({ ...pdf, bytes: Buffer.alloc(MEDIA_LIMITS.maxBytes * 4, 0x25) });

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } });
      await expectNothingStored();
    });

    it("accepts only multipart/form-data", async () => {
      for (const init of [
        json({ file: "x" }, auth),
        { headers: { ...auth, "content-type": "image/png" }, body: png.bytes },
        { headers: auth },
      ]) {
        const response = await request("/v1/media", "POST", init);

        expect(response.status).toBe(415);
        expect(await response.json()).toMatchObject({ error: { code: "unsupported_media_type" } });
      }
      await expectNothingStored();
    });

    it("refuses a malformed form", async () => {
      const response = await request("/v1/media", "POST", {
        headers: { ...auth, "content-type": "multipart/form-data; boundary=fictional" },
        body: "--fictional\r\nnot a part",
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
      await expectNothingStored();
    });

    it("requires one file and a valid alt text", async () => {
      const textOnly = new FormData();
      textOnly.append("file", "not a file");
      const twoFiles = upload(png, {}, auth);
      (twoFiles.body as FormData).append(
        "file",
        new Blob([new Uint8Array(png.bytes)]),
        "second.png",
      );

      for (const [init, field] of [
        [{ body: textOnly, headers: auth }, "file"],
        [upload(png, { altText: "x".repeat(1001) }, auth), "altText"],
        [upload(png, { altText: "   " }, auth), "altText"],
        [twoFiles, "file"],
      ] as const) {
        const response = await request("/v1/media", "POST", init);

        expect(response.status, field).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: "validation_failed", fields: [{ path: field }] },
        });
      }
      await expectNothingStored();
    });
  });

  describe("serving files", () => {
    it("serves an image with its recorded type, unsniffable and sandboxed", async () => {
      const media = await uploaded();

      const response = await request(`/v1/media/files/${media.key}`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toContain("sandbox");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(png.bytes);
    });

    it("serves a PDF as a PDF", async () => {
      const media = await uploaded(pdf);

      const response = await request(`/v1/media/files/${media.key}`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf.bytes);
    });

    it("answers 404 for unknown keys and traversal attempts", async () => {
      const media = await uploaded();
      const name = media.key.split("/")[1] ?? "";

      for (const path of [
        "/v1/media/files/test/00000000-0000-4000-8000-000000000000.png",
        `/v1/media/files/${name}`,
        `/v1/media/files/other/${name}`,
        `/v1/media/files/test/..%2F..%2F${name}`,
        // Encoded slashes are not path segments, so the URL parser cannot resolve them away.
        `/v1/media/files/test%2F%2e%2e%2Ftest%2F${name}`,
        `/v1/media/files/..%2F..%2Fetc%2Fpasswd`,
        "/v1/media/files/test/%00.png",
      ]) {
        const response = await request(path);

        expect(response.status, path).toBe(404);
        expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
      }
    });
  });

  describe("maintaining media", () => {
    it("changes and clears the alt text", async () => {
      const media = await uploaded(png, "Before");

      const changed = await request(
        `/v1/media/${media.id}`,
        "PATCH",
        json({ altText: "After" }, auth),
      );
      expect(changed.status).toBe(200);
      expect(await changed.json()).toMatchObject({
        id: media.id,
        key: media.key,
        altText: "After",
      });

      const cleared = await request(
        `/v1/media/${media.id}`,
        "PATCH",
        json({ altText: null }, auth),
      );
      expect(await cleared.json()).toMatchObject({ altText: null });
    });

    it("refuses replacing the file or an empty change", async () => {
      const media = await uploaded();

      for (const body of [{}, { key: "test/other.png" }, { mediaType: "application/pdf" }]) {
        const response = await request(`/v1/media/${media.id}`, "PATCH", json(body, auth));
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: "validation_failed" } });
      }
    });

    it("answers 404 for unknown media and 400 for a malformed identifier", async () => {
      const unknown = "00000000-0000-4000-8000-000000000000";

      expect((await request(`/v1/media/${unknown}`)).status).toBe(404);
      expect(
        (await request(`/v1/media/${unknown}`, "PATCH", json({ altText: "x" }, auth))).status,
      ).toBe(404);
      expect((await request(`/v1/media/${unknown}`, "DELETE", { headers: auth })).status).toBe(404);
      const malformed = await request("/v1/media/not-a-uuid");
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({
        error: { code: "validation_failed", fields: [{ path: "id" }] },
      });
    });

    it("deletes media and its file; a retry finds nothing", async () => {
      const media = await uploaded();

      const deleted = await request(`/v1/media/${media.id}`, "DELETE", { headers: auth });
      expect(deleted.status).toBe(204);
      expect(await deleted.text()).toBe("");
      await expectNothingStored();
      expect((await request(`/v1/media/${media.id}`)).status).toBe(404);
      expect((await request(`/v1/media/files/${media.key}`)).status).toBe(404);

      expect((await request(`/v1/media/${media.id}`, "DELETE", { headers: auth })).status).toBe(
        404,
      );
      expect(backend.cleanupFailures).toEqual([]);
    });
  });

  describe("attaching media", () => {
    it("attaches a photo and the current CV PDF to the person, and downloads them", async () => {
      const photo = await uploaded(png, "A fictional portrait");
      const cv = await uploaded(pdf);

      const created = await request(
        "/v1/person",
        "POST",
        json({ ...person, photoId: photo.id, cvPdfId: cv.id }, auth),
      );
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({ photoId: photo.id, cvPdfId: cv.id });

      const read = await request("/v1/person");
      const { photoId, cvPdfId } = (await read.json()) as { photoId: string; cvPdfId: string };
      for (const [id, file] of [
        [photoId, png],
        [cvPdfId, pdf],
      ] as const) {
        const media = MediaSchema.parse(await (await request(`/v1/media/${id}`)).json());
        expect(media.url).toBe(`${MEDIA_PUBLIC_BASE}/${media.key}`);
        const download = await request(`/v1/media/files/${media.key}`);
        expect(download.status).toBe(200);
        expect(download.headers.get("content-type")).toBe(file.type);
        expect(Buffer.from(await download.arrayBuffer())).toEqual(file.bytes);
      }
    });

    it("refuses deleting attached media until it is cleared", async () => {
      const photo = await uploaded();
      await request("/v1/person", "POST", json({ ...person, photoId: photo.id }, auth));

      const refused = await request(`/v1/media/${photo.id}`, "DELETE", { headers: auth });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ error: { code: "conflict" } });
      await expect(backend.storedFiles()).resolves.toEqual([photo.key]);

      const cleared = await request("/v1/person", "PATCH", json({ photoId: null }, auth));
      expect(await cleared.json()).toMatchObject({ photoId: null });
      expect((await request(`/v1/media/${photo.id}`, "DELETE", { headers: auth })).status).toBe(
        204,
      );
      await expectNothingStored();
    });

    it("refuses unknown media and the wrong kind of media, naming the field", async () => {
      const image = await uploaded();
      const document = await uploaded(pdf);
      const unknown = "00000000-0000-4000-8000-000000000000";

      for (const [body, field] of [
        [{ ...person, photoId: document.id }, "photoId"],
        [{ ...person, cvPdfId: image.id }, "cvPdfId"],
        [{ ...person, photoId: unknown }, "photoId"],
      ] as const) {
        const response = await request("/v1/person", "POST", json(body, auth));

        expect(response.status, field).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: "validation_failed", fields: [{ path: field }] },
        });
      }
      expect((await request("/v1/person")).status).toBe(404);
    });

    it("attaches and clears an organization logo", async () => {
      const logo = await uploaded({
        bytes: sampleWebp({ width: 8, height: 8 }),
        name: "logo.webp",
        type: "image/webp",
      });
      const document = await uploaded(pdf);
      const organization = { slug: "northwind", name: "Northwind Example" };

      const refused = await request(
        "/v1/organizations",
        "POST",
        json({ ...organization, logoId: document.id }, auth),
      );
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { fields: [{ path: "logoId" }] } });

      const created = await request(
        "/v1/organizations",
        "POST",
        json({ ...organization, logoId: logo.id }, auth),
      );
      expect(await created.json()).toMatchObject({ logoId: logo.id });
      const cleared = await request(
        "/v1/organizations/northwind",
        "PATCH",
        json({ logoId: null }, auth),
      );
      expect(await cleared.json()).toMatchObject({ logoId: null });
    });

    it("attaches and clears a project cover", async () => {
      const cover = await uploaded();
      const document = await uploaded(pdf);
      await backend.services.profile.createOrganization({
        slug: "fabrikam",
        name: "Fabrikam",
        website: null,
        description: null,
        logoId: null,
      });
      await backend.services.profile.createExperience({
        slug: "fabrikam-engineer",
        organization: "fabrikam",
        title: "Engineer",
        kind: "main_job",
        summary: "A fictional role.",
        startedOn: "2021-03-01",
        endedOn: null,
        responsibilities: [],
        technologies: [],
        inCv: true,
      });
      const project = {
        slug: "routing-engine",
        experience: "fabrikam-engineer",
        name: "Routing engine",
        summary: "A fictional route planner.",
        problem: "Routes were planned by hand.",
        workDone: "Built the planner.",
        result: "Routes are planned in minutes.",
        startedOn: "2022-01-01",
        position: 1,
      };

      const created = await request(
        "/v1/projects",
        "POST",
        json({ ...project, coverId: cover.id }, auth),
      );
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({ coverId: cover.id });

      const refused = await request(
        "/v1/projects/routing-engine",
        "PATCH",
        json({ coverId: document.id }, auth),
      );
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { fields: [{ path: "coverId" }] } });

      const cleared = await request(
        "/v1/projects/routing-engine",
        "PATCH",
        json({ coverId: null }, auth),
      );
      expect(await cleared.json()).toMatchObject({ coverId: null });
    });
  });

  describe("rate limiting", () => {
    it("counts uploads against their own per-client budget, before the key is verified", async () => {
      const once = { max: 1, windowMs: 30_000 };
      const { app } = backend.api({ config: testConfig({ rateLimits: { upload: once } }) });
      const post = (headers: Record<string, string>) =>
        app.request("/v1/media", { method: "POST", ...upload(png, {}, headers) }, connection());

      expect((await post({})).status).toBe(401);
      const limited = await post(auth);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("30");
      await expectNothingStored();

      // Other private writes keep their own budget.
      const other = await app.request(
        "/v1/person",
        { method: "DELETE", headers: auth },
        connection(),
      );
      expect(other.status).toBe(404);
    });
  });
});

describe("logging a cleanup failure", () => {
  it("names the operation and the key, redacted, without a stack", () => {
    const lines: string[] = [];
    const error = new Error(`unlink failed for Bearer sebela_${"0".repeat(16)}_secretpart`);

    logCleanupFailure((line: string) => lines.push(line))({
      operation: "upload",
      key: "test/00000000-0000-4000-8000-000000000000.png",
      error,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("upload");
    expect(lines[0]).toContain("test/00000000-0000-4000-8000-000000000000.png");
    expect(lines[0]).not.toContain("secretpart");
    expect(lines[0]).not.toContain(" at ");
  });
});
