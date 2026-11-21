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
  | { readonly kind: "extracted_too_large" };

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

parentPort?.postMessage(await read(workerData as PdfWorkerInput));
