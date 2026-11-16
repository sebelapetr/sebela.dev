import { describe, expect, it } from "vitest";

import {
  MediaIdParamsSchema,
  MediaListSchema,
  MediaSchema,
  MediaUpdateSchema,
  MediaUploadSchema,
  mediaTypes,
} from "./index.js";

const image = {
  id: "0b8f5c2e-1d4a-4f6b-9c3e-2a7d8e9f0a1b",
  key: "development/feature-a/3f1c9a7e-2b4d-4e6f-8a9b-0c1d2e3f4a5b.png",
  mediaType: "image/png",
  byteSize: 2048,
  width: 640,
  height: 480,
  altText: "A fictional office building.",
  url: "https://media.example.test/development/feature-a/3f1c9a7e-2b4d-4e6f-8a9b-0c1d2e3f4a5b.png",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

const pdf = {
  ...image,
  key: "development/3f1c9a7e-2b4d-4e6f-8a9b-0c1d2e3f4a5b.pdf",
  mediaType: "application/pdf",
  width: null,
  height: null,
  altText: null,
  url: "https://media.example.test/development/3f1c9a7e-2b4d-4e6f-8a9b-0c1d2e3f4a5b.pdf",
};

describe("mediaTypes", () => {
  it("allows exactly PNG, JPEG, WebP and PDF", () => {
    expect(mediaTypes).toEqual(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
  });
});

describe("MediaSchema", () => {
  it("describes a stored image and a stored PDF", () => {
    expect(MediaSchema.parse(image)).toEqual(image);
    expect(MediaSchema.parse(pdf)).toEqual(pdf);
    expect(MediaListSchema.parse([image, pdf])).toEqual([image, pdf]);
  });

  it.each([
    ["an unsupported type", { ...image, mediaType: "image/svg+xml" }],
    ["an empty file", { ...image, byteSize: 0 }],
    ["a fractional size", { ...image, byteSize: 1.5 }],
    ["a relative address", { ...image, url: "/media/x.png" }],
  ])("rejects %s", (_name, input) => {
    expect(MediaSchema.safeParse(input).success).toBe(false);
  });
});

describe("MediaUpdateSchema", () => {
  it("changes or clears the alt text, trimmed", () => {
    expect(MediaUpdateSchema.parse({ altText: "  A desk.  " })).toEqual({ altText: "A desk." });
    expect(MediaUpdateSchema.parse({ altText: null })).toEqual({ altText: null });
  });

  it.each([
    ["an empty change", {}],
    ["an empty alt text", { altText: "   " }],
    ["an overlong alt text", { altText: "x".repeat(1001) }],
    ["a key", { key: "other.png" }],
    ["a media type", { mediaType: "image/png" }],
    ["dimensions", { width: 1 }],
  ])("rejects %s", (_name, input) => {
    expect(MediaUpdateSchema.safeParse(input).success).toBe(false);
  });
});

describe("MediaUploadSchema", () => {
  it("documents a file with an optional alt text", () => {
    expect(MediaUploadSchema.safeParse({ file: "binary", altText: "A desk." }).success).toBe(true);
    expect(MediaUploadSchema.safeParse({ file: "binary" }).success).toBe(true);
    expect(MediaUploadSchema.safeParse({ altText: "A desk." }).success).toBe(false);
  });

  it("refuses fields it does not document, such as a caller-chosen key", () => {
    expect(MediaUploadSchema.safeParse({ file: "binary", key: "../x" }).success).toBe(false);
  });
});

describe("MediaIdParamsSchema", () => {
  it("accepts a UUID and nothing else", () => {
    expect(MediaIdParamsSchema.parse({ id: image.id })).toEqual({ id: image.id });
    expect(MediaIdParamsSchema.safeParse({ id: "../etc/passwd" }).success).toBe(false);
    expect(MediaIdParamsSchema.safeParse({ id: "northwind" }).success).toBe(false);
  });
});
