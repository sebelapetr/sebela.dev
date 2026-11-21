// The PDF parser's thread. It runs in a worker with its own heap limit and no environment, so the
// parser of an untrusted file cannot reach the process's settings and can be stopped at any time.
// It reads the document from memory only: no URL, no range requests, no system fonts, no scripts,
// no XFA forms and no annotations, so a link or a script in the file is never followed or run.
// Fonts' character maps come from the parser's own package on disk.
//
// This file imports only pdfjs-dist and Node.js built-ins and uses only erasable TypeScript, so
// Node.js runs it from source under the tests and from `dist` in production.
import { fileURLToPath } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

import { OPS, PasswordException, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** What the worker is given. */
export interface PdfWorkerInput {
  readonly bytes: Uint8Array;
  readonly maxPages: number;
  readonly maxChars: number;
  /** The most bytes one typed array or buffer may take. */
  readonly maxAllocationBytes: number;
}

/** A piece of text in reading order: its string, whether a line ends after it, its baseline and size. */
export interface PdfWorkerItem {
  readonly str: string;
  readonly eol: boolean;
  readonly y: number;
  readonly size: number;
}

export interface PdfWorkerPage {
  readonly items: readonly PdfWorkerItem[];
  /** Whether a page without text paints an image; not looked at on a page with text. */
  readonly images: boolean;
  /** Whether its text could not be read. */
  readonly failed: boolean;
}

/** The worker's one message. */
export type PdfWorkerOutput =
  | { readonly kind: "pages"; readonly pages: readonly PdfWorkerPage[] }
  | { readonly kind: "malformed" }
  | { readonly kind: "encrypted" }
  | { readonly kind: "too_many_pages"; readonly pages: number }
  | { readonly kind: "extracted_too_large" }
  | { readonly kind: "parser_limit" };

const imageOperators = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObject,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintImageMaskXObjectRepeat,
  OPS.paintSolidColorImageMask,
]);

/** The constructors that allocate memory outside the JavaScript heap. */
const typedArrays = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
] as const;

/** The elements a typed array's constructor allocates for its first argument; none for a view. */
function elementsOf(argument: unknown): number {
  if (typeof argument === "number") return argument;
  if (argument instanceof ArrayBuffer || argument instanceof SharedArrayBuffer) return 0;
  if (typeof argument === "object" && argument !== null && "length" in argument) {
    const length = Number(argument.length);
    return Number.isFinite(length) ? length : 0;
  }
  return 0;
}

/** The bytes an `ArrayBuffer` asks for, including the most a resizable one may grow to. */
function bufferBytesOf(args: readonly unknown[]): number {
  const [length, options] = args;
  const maxByteLength =
    typeof options === "object" && options !== null && "maxByteLength" in options
      ? Number(options.maxByteLength)
      : 0;
  return Math.max(typeof length === "number" ? length : 0, maxByteLength);
}

/**
 * Caps every typed array and buffer the parser's thread allocates at `maxBytes`, refusing a larger
 * one before it is allocated and calling `onRefuse`; returns a function restoring the constructors.
 *
 * The parser decodes a stream into one buffer that it doubles as it grows, so a single allocation
 * could hold a whole decompressed stream: the heap limit does not count it and a sample of the
 * thread's memory could come after it. The parser looks these constructors up as globals, so
 * wrapping them here bounds every such buffer. It would otherwise inflate a stream natively with
 * `DecompressionStream`, collecting the whole output in buffers no constructor sees, so that is
 * hidden too: the parser then decodes the stream itself, within the cap.
 */
export function capAllocations(maxBytes: number, onRefuse: () => void): () => void {
  const scope = globalThis as unknown as Record<string, unknown>;
  const refuse = (bytes: number): never => {
    onRefuse();
    throw new RangeError(
      `The PDF parser may not allocate ${String(bytes)} bytes at once; its limit is ${String(maxBytes)}.`,
    );
  };
  const restore: (() => void)[] = [];
  const wrap = (
    name: string,
    constructor: new (...args: never[]) => object,
    bytesOf: (args: readonly unknown[]) => number,
  ) => {
    const capped: new (...args: never[]) => object = new Proxy(constructor, {
      construct(target, args: unknown[], newTarget: new (...args: never[]) => object): object {
        const bytes = bytesOf(args);
        if (bytes > maxBytes) refuse(bytes);
        return Reflect.construct(target, args, newTarget === capped ? target : newTarget) as object;
      },
    });
    scope[name] = capped;
    restore.push(() => {
      scope[name] = constructor;
    });
  };
  for (const constructor of typedArrays) {
    wrap(
      constructor.name,
      constructor,
      (args) => elementsOf(args[0]) * constructor.BYTES_PER_ELEMENT,
    );
  }
  wrap("ArrayBuffer", ArrayBuffer, bufferBytesOf);
  const decompression = Object.getOwnPropertyDescriptor(globalThis, "DecompressionStream");
  if (decompression !== undefined) {
    Reflect.deleteProperty(globalThis, "DecompressionStream");
    restore.push(() => {
      Object.defineProperty(globalThis, "DecompressionStream", decompression);
    });
  }
  return () => {
    for (const undo of restore) undo();
  };
}

const assets = new URL("./", import.meta.resolve("pdfjs-dist/package.json"));

async function read(input: PdfWorkerInput): Promise<PdfWorkerOutput> {
  const task = getDocument({
    data: input.bytes,
    cMapUrl: fileURLToPath(new URL("cmaps/", assets)),
    cMapPacked: true,
    standardFontDataUrl: fileURLToPath(new URL("standard_fonts/", assets)),
    useSystemFonts: false,
    useWorkerFetch: false,
    disableFontFace: true,
    enableXfa: false,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    // Text is all the reading needs: an image beyond a small size is not decoded at all.
    maxImageSize: 1_048_576,
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    let document;
    try {
      document = await task.promise;
    } catch (error) {
      return error instanceof PasswordException ? { kind: "encrypted" } : { kind: "malformed" };
    }
    if (document.numPages > input.maxPages) {
      return { kind: "too_many_pages", pages: document.numPages };
    }
    const pages: PdfWorkerPage[] = [];
    let chars = 0;
    for (let number = 1; number <= document.numPages; number += 1) {
      let page;
      try {
        page = await document.getPage(number);
      } catch {
        pages.push({ items: [], images: false, failed: true });
        continue;
      }
      const items: PdfWorkerItem[] = [];
      let failed = false;
      try {
        const content = await page.getTextContent({ includeMarkedContent: false });
        for (const item of content.items) {
          if (!("str" in item)) continue;
          const transform = item.transform as number[];
          chars += item.str.length;
          items.push({
            str: item.str,
            eol: item.hasEOL,
            y: transform[5] ?? 0,
            size: Math.hypot(transform[2] ?? 0, transform[3] ?? 0),
          });
        }
      } catch {
        failed = true;
      }
      if (chars > input.maxChars) return { kind: "extracted_too_large" };
      let images = false;
      if (!failed && items.every((item) => item.str.trim() === "")) {
        try {
          const operators = await page.getOperatorList();
          images = operators.fnArray.some((operator) => imageOperators.has(operator));
        } catch {
          failed = true;
        }
      }
      page.cleanup();
      pages.push({ items, images, failed });
    }
    return { kind: "pages", pages };
  } finally {
    await task.destroy();
  }
}

if (parentPort !== null) {
  const port = parentPort;
  const input = workerData as PdfWorkerInput;
  const state = { refused: false };
  // The first refusal is the answer: the parent stops the thread on its first message.
  capAllocations(input.maxAllocationBytes, () => {
    if (state.refused) return;
    state.refused = true;
    port.postMessage({ kind: "parser_limit" } satisfies PdfWorkerOutput);
  });
  const output = await read(input);
  if (!state.refused) port.postMessage(output);
}
