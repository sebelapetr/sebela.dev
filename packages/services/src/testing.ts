// Test support for packages above services, which may not import `@sebela/db` themselves.
import { crc32, deflateSync } from "node:zlib";

export { createTemporaryDatabase } from "@sebela/db/testing";
export type { TemporaryDatabase } from "@sebela/db/testing";

/** Pixel size of a generated sample image. */
export interface SampleSize {
  readonly width: number;
  readonly height: number;
}

const uint32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value >>> 0);
  return bytes;
};

const pngChunk = (type: string, data: Buffer) => {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  return Buffer.concat([uint32(data.length), typed, uint32(crc32(typed))]);
};

/** A well-formed grey RGB PNG of the given size. */
export function samplePng({ width, height }: SampleSize): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3, 0x80);
  row[0] = 0;
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", pixels),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const jpegSegment = (marker: number, data: Buffer) => {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(data.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, data]);
};

/** A structurally well-formed baseline greyscale JPEG of the given size. */
export function sampleJpeg({ width, height }: SampleSize): Buffer {
  const frame = Buffer.alloc(9);
  frame[0] = 8;
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame.set([1, 1, 0x11, 0], 5);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    jpegSegment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    jpegSegment(0xc0, frame),
    jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.from([0x12, 0x34, 0x56, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A structurally well-formed lossless (VP8L) WebP of the given size. */
export function sampleWebp({ width, height }: SampleSize): Buffer {
  const bits = Buffer.alloc(4);
  bits.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0);
  const data = Buffer.concat([Buffer.from([0x2f]), bits, Buffer.from([0x00, 0x00, 0x00])]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  const chunk = Buffer.concat([Buffer.from("VP8L", "latin1"), size, data]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(4 + chunk.length);
  return Buffer.concat([
    Buffer.from("RIFF", "latin1"),
    riffSize,
    Buffer.from("WEBP", "latin1"),
    chunk,
  ]);
}

/** A minimal one-page PDF with fictional text. */
export function samplePdf(): Buffer {
  return Buffer.from(
    [
      "%PDF-1.7",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj",
      "trailer << /Root 1 0 R >>",
      "%%EOF",
      "",
    ].join("\n"),
    "latin1",
  );
}

export { createFakeEmbedder, createFakeReranker } from "@sebela/memory";
export type { FakeEmbedderOptions } from "@sebela/memory";
