import { crc32 } from "node:zlib";

import type { MediaType } from "@sebela/contracts";

import { DomainError } from "../../errors.js";
import type { StoredExtension } from "../storage/index.js";

/** What the content of an uploaded file proves. */
export interface Inspected {
  readonly mediaType: MediaType;
  readonly extension: StoredExtension;
  /** Pixels; `null` exactly for a PDF. */
  readonly width: number | null;
  readonly height: number | null;
}

interface Format {
  readonly mediaType: MediaType;
  readonly extension: StoredExtension;
  /** The file-name extensions a caller may use for the format. */
  readonly names: readonly string[];
  readonly matches: (bytes: Buffer) => boolean;
  /** The pixel size, or `null` for a document; throws `Malformed` when the structure is broken. */
  readonly measure: (bytes: Buffer) => { width: number; height: number } | null;
}

/** A structural defect; becomes a `validation_failed` refusal of the file. */
class Malformed extends Error {}

const fail = (reason: string): never => {
  throw new Malformed(reason);
};

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const startsWith = (bytes: Buffer, prefix: Buffer | string) =>
  bytes
    .subarray(0, prefix.length)
    .equals(typeof prefix === "string" ? Buffer.from(prefix, "latin1") : prefix);

/**
 * Walks every PNG chunk and checks its checksum: `IHDR` first, at least one `IDAT`, an empty
 * `IEND` exactly at the end. The compressed pixels are never inflated.
 */
function measurePng(bytes: Buffer) {
  let offset = pngSignature.length;
  let size: { width: number; height: number } | null = null;
  let hasData = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail("A PNG chunk is truncated.");
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (length > 0x7fffffff || end > bytes.length) fail("A PNG chunk overruns the file.");
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const typed = bytes.subarray(offset + 4, offset + 8 + length);
    if (crc32(typed) !== bytes.readUInt32BE(offset + 8 + length)) fail("A PNG checksum is wrong.");
    if (size === null && type !== "IHDR") fail("The PNG does not start with its header.");
    if (type === "IHDR") {
      if (size !== null || length !== 13) fail("The PNG header is invalid.");
      size = { width: bytes.readUInt32BE(offset + 8), height: bytes.readUInt32BE(offset + 12) };
    } else if (type === "IDAT") {
      hasData = true;
    } else if (type === "IEND") {
      if (length !== 0 || end !== bytes.length || !hasData) fail("The PNG does not end properly.");
      return size;
    }
    offset = end;
  }
  return fail("The PNG has no end.");
}

const isFrameMarker = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/**
 * Walks the JPEG segments up to the start of the scan, reads the frame size and requires the end
 * marker as the last two bytes. The compressed scan is never decoded.
 */
function measureJpeg(bytes: Buffer) {
  let offset = 2;
  let size: { width: number; height: number } | null = null;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) fail("A JPEG segment is missing its marker.");
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) fail("A JPEG segment overruns the file.");
    if (isFrameMarker(marker)) {
      if (length < 7) fail("The JPEG frame header is invalid.");
      size = { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    } else if (marker === 0xda) {
      if (size === null) fail("The JPEG scan starts before its frame header.");
      if (end + 2 > bytes.length || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) {
        fail("The JPEG has no end marker.");
      }
      return size;
    }
    offset = end;
  }
  return fail("The JPEG is truncated.");
}

/**
 * Checks the RIFF size against the file, walks the chunks and reads the size from the first image
 * chunk (`VP8 `, `VP8L` or `VP8X`). The compressed image is never decoded.
 */
function measureWebp(bytes: Buffer) {
  if (bytes.length < 12 || bytes.readUInt32LE(4) + 8 !== bytes.length) {
    fail("The WebP size does not match the file.");
  }
  let offset = 12;
  let canvas: { width: number; height: number } | null = null;
  let hasImage = false;
  let first: { width: number; height: number } | null = null;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail("A WebP chunk is truncated.");
    const type = bytes.toString("latin1", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    const end = data + length + (length % 2);
    if (data + length > bytes.length) fail("A WebP chunk overruns the file.");
    if (type === "VP8X") {
      if (offset !== 12 || length < 10) fail("The WebP extended header is invalid.");
      canvas = {
        width: bytes.readUIntLE(data + 4, 3) + 1,
        height: bytes.readUIntLE(data + 7, 3) + 1,
      };
    } else if (type === "VP8 ") {
      if (length < 10) fail("The WebP image header is invalid.");
      const keyframe = ((bytes[data] ?? 1) & 1) === 0;
      if (!keyframe || bytes.readUIntBE(data + 3, 3) !== 0x9d012a) {
        fail("The WebP image header is invalid.");
      }
      hasImage = true;
      first ??= {
        width: bytes.readUInt16LE(data + 6) & 0x3fff,
        height: bytes.readUInt16LE(data + 8) & 0x3fff,
      };
    } else if (type === "VP8L") {
      if (length < 5 || bytes[data] !== 0x2f) fail("The WebP image header is invalid.");
      const bits = bytes.readUInt32LE(data + 1);
      if (bits >>> 29 !== 0) fail("The WebP image version is unknown.");
      hasImage = true;
      first ??= { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    } else if (type === "ANMF") {
      hasImage = true;
    }
    offset = end;
  }
  if (offset !== bytes.length) fail("The WebP is truncated.");
  if (!hasImage) fail("The WebP has no image.");
  const size = canvas ?? first;
  return size ?? fail("The WebP has no image size.");
}

/** A PDF header with a known version and an end-of-file marker near the end. */
function checkPdf(bytes: Buffer) {
  if (!/^%PDF-[12]\.\d/.test(bytes.toString("latin1", 0, 8))) fail("The PDF header is invalid.");
  if (!bytes.toString("latin1", Math.max(0, bytes.length - 1024)).includes("%%EOF")) {
    fail("The PDF has no end-of-file marker.");
  }
  return null;
}

const formats: readonly Format[] = [
  {
    mediaType: "image/png",
    extension: "png",
    names: ["png"],
    matches: (bytes) => startsWith(bytes, pngSignature),
    measure: measurePng,
  },
  {
    mediaType: "image/jpeg",
    extension: "jpg",
    names: ["jpg", "jpeg"],
    matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    measure: measureJpeg,
  },
  {
    mediaType: "image/webp",
    extension: "webp",
    names: ["webp"],
    matches: (bytes) => startsWith(bytes, "RIFF") && bytes.toString("latin1", 8, 12) === "WEBP",
    measure: measureWebp,
  },
  {
    mediaType: "application/pdf",
    extension: "pdf",
    names: ["pdf"],
    matches: (bytes) => startsWith(bytes, "%PDF-"),
    measure: checkPdf,
  },
];

const genericTypes = new Set(["", "application/octet-stream"]);

const refuseFile = (message: string) =>
  new DomainError("validation_failed", message, [{ path: "file", message }]);

/**
 * Proves what an uploaded file is from its content: its signature picks the format, the declared
 * type (unless generic) and the last file-name extension must agree with it, and the structure is
 * walked without decoding pixels, so the work is bounded by the byte size. Refusals:
 * `payload_too_large` over `maxBytes`, `unsupported_media_type` for another format or a
 * contradicting type or extension, `validation_failed` on `file` for an empty, malformed or
 * oversized image.
 */
export function inspectUpload(
  input: { bytes: Uint8Array; filename: string; declaredType: string },
  limits: { maxBytes: number; maxImageDimension: number },
): Inspected {
  const bytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  if (bytes.length > limits.maxBytes) {
    throw new DomainError(
      "payload_too_large",
      `The file is larger than the limit of ${String(limits.maxBytes)} bytes.`,
    );
  }
  if (bytes.length === 0) throw refuseFile("The file is empty.");

  const format = formats.find((candidate) => candidate.matches(bytes));
  if (format === undefined) {
    throw new DomainError("unsupported_media_type", "Upload a PNG, JPEG or WebP image or a PDF.");
  }
  const declared = input.declaredType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!genericTypes.has(declared) && declared !== format.mediaType) {
    throw new DomainError(
      "unsupported_media_type",
      `The declared type does not match the content, which is ${format.mediaType}.`,
    );
  }
  const dot = input.filename.lastIndexOf(".");
  const extension = dot < 0 ? "" : input.filename.slice(dot + 1).toLowerCase();
  if (!format.names.includes(extension)) {
    throw new DomainError(
      "unsupported_media_type",
      `The file name extension does not match the content, which is ${format.mediaType}.`,
    );
  }

  let size: { width: number; height: number } | null;
  try {
    size = format.measure(bytes);
  } catch (error) {
    if (error instanceof Malformed) throw refuseFile(`The file is malformed: ${error.message}`);
    throw error;
  }
  if (size !== null) {
    if (size.width <= 0 || size.height <= 0) throw refuseFile("The image has no pixels.");
    if (size.width > limits.maxImageDimension || size.height > limits.maxImageDimension) {
      throw refuseFile(
        `The image is larger than ${String(limits.maxImageDimension)} pixels in one dimension.`,
      );
    }
  }
  return {
    mediaType: format.mediaType,
    extension: format.extension,
    width: size?.width ?? null,
    height: size?.height ?? null,
  };
}
