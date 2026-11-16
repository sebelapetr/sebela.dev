import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MediaListSchema, MediaSchema, type PersonCreate } from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import { DomainError, type DomainErrorCode } from "../../errors.js";
import { samplePdf, samplePng, sampleJpeg, sampleWebp } from "../../testing.js";
import { createProfileService } from "../profile/index.js";
import { openStorage, type OpenedStorage, type Storage } from "../storage/index.js";
import {
  createMediaService,
  readMediaConfig,
  type CleanupFailure,
  type MediaLimits,
  type MediaService,
  type MediaUploadInput,
} from "./index.js";

const limits: MediaLimits = { maxBytes: 64 * 1024, maxImageDimension: 2000 };

const person: PersonCreate = {
  name: "Ada Example",
  headline: "Fictional engineer",
  shortBio: "A made-up person for tests.",
  longBio: null,
  location: null,
  email: null,
  links: [],
  availability: null,
  careerStartedOn: null,
  photoId: null,
  cvPdfId: null,
};

const png = (overrides: Partial<MediaUploadInput> = {}): MediaUploadInput => ({
  bytes: samplePng({ width: 40, height: 30 }),
  filename: "office.png",
  declaredType: "image/png",
  altText: "A fictional office.",
  ...overrides,
});

/** A copy of the bytes with one byte changed. */
const corrupted = (bytes: Buffer, index: number) => {
  const copy = Buffer.from(bytes);
  copy[index] = (copy[index] ?? 0) ^ 0xff;
  return copy;
};

async function filesBelow(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function refusal(operation: Promise<unknown>): Promise<DomainError> {
  const error = await operation.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof DomainError)) throw new Error("Expected a DomainError.");
  return error;
}

describe("readMediaConfig", () => {
  const env = {
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_ROOT: "/srv/fictional-storage",
    STORAGE_ENVIRONMENT: "development",
    STORAGE_WORKTREE: "",
    STORAGE_PUBLIC_BASE_URL: "https://media.example.test",
    MEDIA_MAX_BYTES: "1048576",
    MEDIA_MAX_IMAGE_DIMENSION: "4000",
  };

  it("reads the storage and the upload limits", () => {
    expect(readMediaConfig(env)).toEqual({
      storage: {
        driver: "local",
        root: "/srv/fictional-storage",
        environment: "development",
        worktree: null,
        publicBaseUrl: "https://media.example.test",
      },
      limits: { maxBytes: 1048576, maxImageDimension: 4000 },
    });
  });

  it("names every missing or invalid limit", () => {
    const attempt = () =>
      readMediaConfig({ ...env, MEDIA_MAX_BYTES: "0", MEDIA_MAX_IMAGE_DIMENSION: "" });
    expect(attempt).toThrow(/MEDIA_MAX_BYTES/);
    expect(attempt).toThrow(/MEDIA_MAX_IMAGE_DIMENSION/);
  });
});

describe("media service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let folder: string;
  let opened: OpenedStorage;
  let failures: CleanupFailure[];
  let media: MediaService;

  const serviceWith = (storage: Storage, over: Persistence = persistence) =>
    createMediaService(over.profile, {
      storage: { storage, files: opened.files },
      limits,
      onCleanupFailure: (failure) => failures.push(failure),
    });

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(async () => {
    await persistence.profile.deletePerson();
    for (const { id } of await persistence.profile.listMedia()) {
      await persistence.profile.deleteMedia(id);
    }
    folder = await mkdtemp(join(tmpdir(), "sebela-media-"));
    opened = openStorage({
      driver: "local",
      root: folder,
      environment: "test",
      worktree: "feature-a",
      publicBaseUrl: "https://media.example.test/files",
    });
    failures = [];
    media = serviceWith(opened.storage);
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  describe("upload", () => {
    it.each([
      ["a PNG", png(), "image/png", 40, 30],
      [
        "a JPEG",
        png({
          bytes: sampleJpeg({ width: 320, height: 200 }),
          filename: "desk.JPG",
          declaredType: "image/jpeg",
        }),
        "image/jpeg",
        320,
        200,
      ],
      [
        "a JPEG named .jpeg",
        png({
          bytes: sampleJpeg({ width: 8, height: 9 }),
          filename: "desk.jpeg",
          declaredType: "image/jpeg",
        }),
        "image/jpeg",
        8,
        9,
      ],
      [
        "a WebP",
        png({
          bytes: sampleWebp({ width: 1200, height: 630 }),
          filename: "cover.webp",
          declaredType: "image/webp",
        }),
        "image/webp",
        1200,
        630,
      ],
      [
        "a PDF",
        png({
          bytes: samplePdf(),
          filename: "cv.pdf",
          declaredType: "application/pdf",
          altText: null,
        }),
        "application/pdf",
        null,
        null,
      ],
    ])(
      "stores %s with the type and size its content proves",
      async (_name, input, type, width, height) => {
        const uploaded = await media.uploadMedia(input);

        expect(MediaSchema.parse(uploaded)).toEqual(uploaded);
        expect(uploaded).toMatchObject({
          mediaType: type,
          byteSize: input.bytes.length,
          width,
          height,
          altText: input.altText ?? null,
        });
        expect(uploaded.key).toMatch(/^test\/feature-a\/[0-9a-f-]{36}\.(png|jpg|webp|pdf)$/);
        expect(uploaded.url).toBe(`https://media.example.test/files/${uploaded.key}`);
        await expect(media.getMedia(uploaded.id)).resolves.toEqual(uploaded);
        await expect(media.readMediaFile(uploaded.key)).resolves.toEqual({
          bytes: Buffer.from(input.bytes),
          mediaType: type,
        });
      },
    );

    it("accepts a generic declared type and judges the content", async () => {
      const uploaded = await media.uploadMedia(png({ declaredType: "application/octet-stream" }));
      expect(uploaded.mediaType).toBe("image/png");
      await expect(media.uploadMedia(png({ declaredType: "" }))).resolves.toMatchObject({
        mediaType: "image/png",
      });
    });

    it("never lets the original filename choose where the file goes", async () => {
      const uploaded = await media.uploadMedia(png({ filename: "../../../escape/evil.png" }));

      expect(uploaded.key).toMatch(/^test\/feature-a\/[0-9a-f-]{36}\.png$/);
      expect(uploaded.key).not.toContain("evil");
      expect(await filesBelow(folder)).toEqual([uploaded.key.split("/")[2]]);
    });

    it("lists media newest first", async () => {
      const first = await media.uploadMedia(png());
      const second = await media.uploadMedia(
        png({ bytes: samplePdf(), filename: "cv.pdf", declaredType: "application/pdf" }),
      );

      const listed = await media.listMedia();
      expect(MediaListSchema.parse(listed)).toEqual([second, first]);
    });

    const pngBytes = samplePng({ width: 40, height: 30 });
    const jpegBytes = sampleJpeg({ width: 40, height: 30 });
    const webpBytes = sampleWebp({ width: 40, height: 30 });
    const pdfBytes = samplePdf();

    it.each<[string, MediaUploadInput, DomainErrorCode]>([
      [
        "a GIF",
        png({
          bytes: Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1"),
          filename: "x.gif",
          declaredType: "image/gif",
        }),
        "unsupported_media_type",
      ],
      [
        "an SVG",
        png({
          bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
          filename: "x.svg",
          declaredType: "image/svg+xml",
        }),
        "unsupported_media_type",
      ],
      [
        "an SVG named and declared as PNG",
        png({ bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }),
        "unsupported_media_type",
      ],
      ["a PNG declared as JPEG", png({ declaredType: "image/jpeg" }), "unsupported_media_type"],
      ["a PNG named .jpg", png({ filename: "office.jpg" }), "unsupported_media_type"],
      ["a PNG named .pdf", png({ filename: "office.pdf" }), "unsupported_media_type"],
      ["a PNG without an extension", png({ filename: "office" }), "unsupported_media_type"],
      ["a PNG named .png.exe", png({ filename: "office.png.exe" }), "unsupported_media_type"],
      [
        "a PDF declared as an image",
        png({ bytes: pdfBytes, filename: "cv.pdf" }),
        "unsupported_media_type",
      ],
      ["an empty file", png({ bytes: Buffer.alloc(0) }), "validation_failed"],
      [
        "a truncated PNG",
        png({ bytes: pngBytes.subarray(0, pngBytes.length - 12) }),
        "validation_failed",
      ],
      [
        "a PNG with a broken checksum",
        png({ bytes: corrupted(pngBytes, 20) }),
        "validation_failed",
      ],
      [
        "a PNG with trailing data",
        png({ bytes: Buffer.concat([pngBytes, Buffer.from("tail")]) }),
        "validation_failed",
      ],
      [
        "a PNG of zero width",
        png({ bytes: samplePng({ width: 0, height: 3 }) }),
        "validation_failed",
      ],
      [
        "a JPEG without an end marker",
        png({
          bytes: jpegBytes.subarray(0, jpegBytes.length - 2),
          filename: "x.jpg",
          declaredType: "image/jpeg",
        }),
        "validation_failed",
      ],
      [
        "a JPEG whose segment overruns the file",
        png({ bytes: jpegBytes.subarray(0, 30), filename: "x.jpg", declaredType: "image/jpeg" }),
        "validation_failed",
      ],
      [
        "a WebP with a wrong RIFF size",
        png({
          bytes: Buffer.concat([webpBytes, Buffer.from("xx")]),
          filename: "x.webp",
          declaredType: "image/webp",
        }),
        "validation_failed",
      ],
      [
        "a truncated WebP",
        png({ bytes: webpBytes.subarray(0, 20), filename: "x.webp", declaredType: "image/webp" }),
        "validation_failed",
      ],
      [
        "a PDF without an end marker",
        png({
          bytes: Buffer.from("%PDF-1.7\n1 0 obj\n"),
          filename: "cv.pdf",
          declaredType: "application/pdf",
        }),
        "validation_failed",
      ],
      [
        "an image wider than the limit",
        png({ bytes: samplePng({ width: 2001, height: 1 }) }),
        "validation_failed",
      ],
      [
        "an image taller than the limit",
        png({
          bytes: sampleWebp({ width: 1, height: 2001 }),
          filename: "x.webp",
          declaredType: "image/webp",
        }),
        "validation_failed",
      ],
      [
        "a file over the byte limit",
        png({
          bytes: Buffer.concat([pdfBytes, Buffer.alloc(limits.maxBytes)]),
          filename: "cv.pdf",
          declaredType: "application/pdf",
        }),
        "payload_too_large",
      ],
    ])("refuses %s and leaves neither a record nor a file", async (_name, input, code) => {
      const error = await refusal(media.uploadMedia(input));

      expect(error.code).toBe(code);
      if (code === "validation_failed") expect(error.fields?.[0]?.path).toBe("file");
      await expect(media.listMedia()).resolves.toEqual([]);
      expect(await filesBelow(folder)).toEqual([]);
    });

    it("accepts an image exactly at the dimension limit", async () => {
      const uploaded = await media.uploadMedia(
        png({ bytes: samplePng({ width: 2000, height: 1 }) }),
      );
      expect(uploaded.width).toBe(2000);
    });

    it("removes the stored file when the metadata cannot be written", async () => {
      const closed = createPersistence(database.config);
      await closed.close();

      await expect(serviceWith(opened.storage, closed).uploadMedia(png())).rejects.toThrow();

      expect(await filesBelow(folder)).toEqual([]);
      expect(failures).toEqual([]);
      await expect(media.listMedia()).resolves.toEqual([]);
    });

    it("reports a file it could not remove after the metadata failed, then still fails", async () => {
      const closed = createPersistence(database.config);
      await closed.close();
      const cannotDelete: Storage = {
        ...opened.storage,
        store: (file) => opened.storage.store(file),
        publicAddress: (key) => opened.storage.publicAddress(key),
        delete: () => Promise.reject(new Error("storage is unavailable")),
      };

      await expect(serviceWith(cannotDelete, closed).uploadMedia(png())).rejects.toThrow();

      expect(failures).toHaveLength(1);
      expect(failures[0]?.operation).toBe("upload");
      expect(failures[0]?.key).toMatch(/^test\/feature-a\/[0-9a-f-]{36}\.png$/);
    });

    it("writes no record when the file cannot be stored", async () => {
      const cannotStore: Storage = {
        store: () => Promise.reject(new Error("storage is unavailable")),
        delete: (key) => opened.storage.delete(key),
        publicAddress: (key) => opened.storage.publicAddress(key),
      };

      await expect(serviceWith(cannotStore).uploadMedia(png())).rejects.toThrow(/unavailable/);

      await expect(media.listMedia()).resolves.toEqual([]);
    });
  });

  describe("maintain", () => {
    it("changes and clears the alt text", async () => {
      const uploaded = await media.uploadMedia(png());

      const changed = await media.updateMedia(uploaded.id, { altText: "A desk." });
      expect(changed).toMatchObject({ id: uploaded.id, key: uploaded.key, altText: "A desk." });
      await expect(media.updateMedia(uploaded.id, { altText: null })).resolves.toMatchObject({
        altText: null,
      });
    });

    it("reports unknown media as not found", async () => {
      const unknown = "00000000-0000-4000-8000-000000000000";
      expect((await refusal(media.getMedia(unknown))).code).toBe("not_found");
      expect((await refusal(media.updateMedia(unknown, { altText: "x" }))).code).toBe("not_found");
      expect((await refusal(media.deleteMedia(unknown))).code).toBe("not_found");
    });
  });

  describe("delete", () => {
    it("removes the record and the file", async () => {
      const uploaded = await media.uploadMedia(png());

      await media.deleteMedia(uploaded.id);

      await expect(media.listMedia()).resolves.toEqual([]);
      expect(await filesBelow(folder)).toEqual([]);
      await expect(media.readMediaFile(uploaded.key)).resolves.toBeNull();
    });

    it("refuses to delete attached media and keeps the file", async () => {
      const photo = await media.uploadMedia(png());
      await createProfileService(persistence.profile).createPerson({
        ...person,
        photoId: photo.id,
      });

      expect((await refusal(media.deleteMedia(photo.id))).code).toBe("conflict");

      await expect(media.getMedia(photo.id)).resolves.toEqual(photo);
      await expect(media.readMediaFile(photo.key)).resolves.not.toBeNull();
    });

    it("deletes the record and reports a file it could not remove", async () => {
      const uploaded = await media.uploadMedia(png());
      const cannotDelete: Storage = {
        store: (file) => opened.storage.store(file),
        publicAddress: (key) => opened.storage.publicAddress(key),
        delete: () => Promise.reject(new Error("storage is unavailable")),
      };

      await serviceWith(cannotDelete).deleteMedia(uploaded.id);

      await expect(media.listMedia()).resolves.toEqual([]);
      expect(failures).toEqual([
        { operation: "delete", key: uploaded.key, error: new Error("storage is unavailable") },
      ]);
      await expect(media.readMediaFile(uploaded.key)).resolves.toBeNull();
    });
  });

  describe("records of another prefix", () => {
    it("lists and reads them without an address and serves no file for them", async () => {
      const uploaded = await media.uploadMedia(png());
      const elsewhere = createMediaService(persistence.profile, {
        storage: openStorage({
          driver: "local",
          root: folder,
          environment: "test",
          worktree: "feature-b",
          publicBaseUrl: "https://media.example.test/files",
        }),
        limits,
        onCleanupFailure: (failure) => failures.push(failure),
      });

      const foreign = { ...uploaded, url: null };
      await expect(elsewhere.listMedia()).resolves.toEqual([foreign]);
      await expect(elsewhere.getMedia(uploaded.id)).resolves.toEqual(foreign);
      await expect(elsewhere.updateMedia(uploaded.id, { altText: null })).resolves.toMatchObject({
        altText: null,
        url: null,
      });
      await expect(elsewhere.readMediaFile(uploaded.key)).resolves.toBeNull();
    });
  });

  describe("serve", () => {
    it("serves nothing for an unknown key or a recorded file that is missing", async () => {
      await expect(media.readMediaFile("test/feature-a/missing.png")).resolves.toBeNull();
      await expect(media.readMediaFile("../../etc/hostname")).resolves.toBeNull();

      const uploaded = await media.uploadMedia(png());
      await opened.storage.delete(uploaded.key);
      await expect(media.readMediaFile(uploaded.key)).resolves.toBeNull();
    });

    it("serves nothing when the driver keeps no local files", async () => {
      const uploaded = await media.uploadMedia(png());
      const remote = createMediaService(persistence.profile, {
        storage: { storage: opened.storage, files: null },
        limits,
        onCleanupFailure: (failure) => failures.push(failure),
      });

      await expect(remote.readMediaFile(uploaded.key)).resolves.toBeNull();
    });
  });
});
