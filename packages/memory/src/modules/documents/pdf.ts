// Reads the text layer of a PDF in a bounded worker and turns it into Markdown: page lines with
// running headers, footers and page numbers removed and headings found by their type size. The
// documents module cleans, checks and chunks the Markdown like any other.
import { Worker } from "node:worker_threads";

import type {
  PdfWorkerInput,
  PdfWorkerItem,
  PdfWorkerOutput,
  PdfWorkerPage,
} from "./pdf-worker.js";

/** Why the text of a PDF cannot be used. */
export type PdfFailure =
  | { readonly reason: "malformed" }
  | { readonly reason: "encrypted" }
  | { readonly reason: "no_text_layer" }
  | { readonly reason: "empty" }
  | {
      readonly reason: "incomplete_extraction";
      readonly page: number;
      readonly cause: "unreadable" | "images" | "undecodable";
    }
  | { readonly reason: "too_many_pages"; readonly pages: number }
  | { readonly reason: "extracted_too_large" }
  | { readonly reason: "parser_limit" }
  | { readonly reason: "too_slow" };

export interface PdfReadLimits {
  readonly maxPages: number;
  /** The most characters the parser extracts before it gives up. */
  readonly maxChars: number;
  readonly maxParserMemoryMb: number;
  /** How long the parser may run before it is stopped. */
  readonly timeoutMs: number;
}

/** A line of a page's text with its type size and its line number on the page (from 1). */
interface PdfLine {
  readonly text: string;
  readonly size: number;
  readonly page: number;
  readonly line: number;
}

/** The Markdown of a PDF and where each of its lines (from 1) came from. */
export interface PdfMarkdown {
  readonly text: string;
  readonly origins: readonly { readonly page: number; readonly line: number }[];
}

export type PdfReading =
  | { readonly ok: true; readonly markdown: PdfMarkdown }
  | { readonly ok: false; readonly failure: PdfFailure };

// Node.js runs the worker from source under the tests and from the build otherwise.
const workerUrl = new URL(
  import.meta.url.endsWith(".ts") ? "./pdf-worker.ts" : "./pdf-worker.js",
  import.meta.url,
);

/** Reads a PDF's text into Markdown, or says why it cannot be used. Never throws a rejection. */
export async function readPdf(bytes: Uint8Array, limits: PdfReadLimits): Promise<PdfReading> {
  const output = await parse(bytes, limits);
  if ("reason" in output) return { ok: false, failure: output };
  switch (output.kind) {
    case "malformed":
    case "encrypted":
    case "extracted_too_large":
      return { ok: false, failure: { reason: output.kind } };
    case "too_many_pages":
      return { ok: false, failure: { reason: "too_many_pages", pages: output.pages } };
    case "pages": {
      const pages = output.pages.map((page, index) => linesOf(page, index + 1));
      const failure = unusable(output.pages, pages);
      return failure === null
        ? { ok: true, markdown: markdownOf(withoutRunningLines(pages)) }
        : { ok: false, failure };
    }
  }
}

/** Runs the parser's worker within the memory and time limits. */
function parse(
  bytes: Uint8Array,
  limits: PdfReadLimits,
): Promise<PdfWorkerOutput | { readonly reason: "parser_limit" | "too_slow" }> {
  // A copy in its own memory: the worker takes it over, and a Buffer's `slice` would be a view
  // whose transfer detached the caller's bytes (and the rest of their pool).
  const copy = new Uint8Array(bytes);
  const input: PdfWorkerInput = {
    bytes: copy,
    maxPages: limits.maxPages,
    maxChars: limits.maxChars,
  };
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, {
      workerData: input,
      transferList: [copy.buffer],
      env: {},
      stdout: true,
      stderr: true,
      resourceLimits: {
        maxOldGenerationSizeMb: limits.maxParserMemoryMb,
        maxYoungGenerationSizeMb: Math.max(
          1,
          Math.min(32, Math.floor(limits.maxParserMemoryMb / 8)),
        ),
        stackSizeMb: 4,
      },
    });
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
      void worker.terminate();
    };
    const timer = setTimeout(
      () => {
        settle(() => {
          resolve({ reason: "too_slow" });
        });
      },
      Math.max(0, limits.timeoutMs),
    );
    worker.once("message", (message: PdfWorkerOutput) => {
      settle(() => {
        resolve(message);
      });
    });
    worker.once("error", (error: Error & { code?: string }) => {
      settle(() => {
        if (error.code === "ERR_WORKER_OUT_OF_MEMORY") resolve({ reason: "parser_limit" });
        else reject(error);
      });
    });
    worker.once("exit", (code) => {
      settle(() => {
        reject(new Error(`The PDF parser stopped with exit code ${String(code)}.`));
      });
    });
  });
}

/** Text that no font maps to a real character: the replacement character and private use. */
const undecodablePattern = /[�\p{Co}]/gu;

/** A page's items as lines: a new line after an end of line or where the baseline moves. */
function linesOf(page: PdfWorkerPage, number: number): PdfLine[] {
  const lines: PdfLine[] = [];
  let parts: string[] = [];
  let size = 0;
  let y: number | null = null;
  const close = () => {
    const text = parts.join("");
    if (text.trim() !== "") lines.push({ text, size, page: number, line: lines.length + 1 });
    parts = [];
    size = 0;
    y = null;
  };
  const sameLine = (item: PdfWorkerItem) =>
    y === null || Math.abs(item.y - y) <= Math.max(item.size, size, 1) * 0.5;
  for (const item of page.items) {
    if (item.str !== "") {
      if (!sameLine(item)) close();
      parts.push(item.str);
      if (item.str.trim() !== "") {
        size = Math.max(size, item.size);
        y ??= item.y;
      }
    }
    if (item.eol) close();
  }
  close();
  return lines;
}

/**
 * Why the pages cannot be used: one could not be read, none has text (scanned or empty), a page
 * without text shows images (a scanned page), or most of a page's text maps to no character.
 */
function unusable(pages: readonly PdfWorkerPage[], lines: readonly PdfLine[][]): PdfFailure | null {
  const unreadable = pages.findIndex((page) => page.failed);
  if (unreadable >= 0) {
    return { reason: "incomplete_extraction", page: unreadable + 1, cause: "unreadable" };
  }
  if (lines.every((page) => page.length === 0)) {
    return pages.some((page) => page.images) ? { reason: "no_text_layer" } : { reason: "empty" };
  }
  const scanned = pages.findIndex((page, index) => page.images && lines[index]?.length === 0);
  if (scanned >= 0) {
    return { reason: "incomplete_extraction", page: scanned + 1, cause: "images" };
  }
  for (const [index, page] of lines.entries()) {
    const text = page.map((line) => line.text.replace(/\s+/gu, "")).join("");
    const undecodable = text.match(undecodablePattern)?.length ?? 0;
    if (undecodable > 0 && undecodable / text.length > 0.1) {
      return { reason: "incomplete_extraction", page: index + 1, cause: "undecodable" };
    }
  }
  return null;
}

/** A line's text compared across pages: case and digits (page numbers) ignored. */
const runningKey = (text: string) =>
  text.toLowerCase().replace(/\d+/gu, "#").replace(/\s+/gu, " ").trim();

/** How many lines at the top and at the bottom of a page may be a running header or footer. */
const runningDepth = 2;

/**
 * Removes running headers and footers: a line in the same place among the first or last two of at
 * least half the pages (two at least), digits ignored, so page numbers go too. One page keeps all.
 */
function withoutRunningLines(pages: readonly PdfLine[][]): PdfLine[][] {
  if (pages.length < 2) return pages.map((page) => [...page]);
  const needed = Math.max(2, Math.ceil(pages.length / 2));
  const places = (page: readonly PdfLine[]) => {
    const found: [place: string, line: PdfLine][] = [];
    for (let depth = 0; depth < Math.min(runningDepth, page.length); depth += 1) {
      const top = page[depth];
      const bottom = page[page.length - 1 - depth];
      if (top !== undefined) found.push([`top:${String(depth)}:${runningKey(top.text)}`, top]);
      if (bottom !== undefined) {
        found.push([`bottom:${String(depth)}:${runningKey(bottom.text)}`, bottom]);
      }
    }
    return found;
  };
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const place of new Set(places(page).map(([key]) => key))) {
      counts.set(place, (counts.get(place) ?? 0) + 1);
    }
  }
  return pages.map((page) => {
    const running = new Set(
      places(page)
        .filter(([key]) => (counts.get(key) ?? 0) >= needed)
        .map(([, line]) => line),
    );
    return page.filter((line) => !running.has(line));
  });
}

/** Type sizes within this step are one size. */
const sizeStep = 0.5;
const roundedSize = (size: number) => Math.round(size / sizeStep) * sizeStep;
/** How much larger than the body text a heading is set. */
const headingRatio = 1.15;
const maxHeadingLength = 150;

/**
 * The pages as Markdown: a line set larger than the body text (the size holding most characters)
 * is a heading, its level by the rank of its size (at most 6), and lines of one heading in a row
 * are joined; a body line that Markdown would read as a heading or a code fence is escaped.
 */
function markdownOf(pages: readonly PdfLine[][]): PdfMarkdown {
  const lines = pages.flat();
  const weights = new Map<number, number>();
  for (const line of lines) {
    const size = roundedSize(line.size);
    weights.set(size, (weights.get(size) ?? 0) + line.text.length);
  }
  let body = 0;
  let heaviest = -1;
  for (const [size, weight] of weights) {
    if (weight > heaviest || (weight === heaviest && size < body)) {
      body = size;
      heaviest = weight;
    }
  }
  const isHeading = (line: PdfLine) =>
    roundedSize(line.size) >= body * headingRatio &&
    line.text.trim().length <= maxHeadingLength &&
    /\p{L}/u.test(line.text);
  const headingSizes = [...new Set(lines.filter(isHeading).map((line) => roundedSize(line.size)))]
    .sort((left, right) => right - left)
    .slice(0, 6);
  const levelOf = (line: PdfLine) => {
    if (!isHeading(line)) return 0;
    const rank = headingSizes.indexOf(roundedSize(line.size));
    return rank < 0 ? 6 : rank + 1;
  };

  const texts: string[] = [];
  const origins: { page: number; line: number }[] = [];
  /** The heading level and page of the line before, when it is a heading. */
  let previous: { level: number; page: number } | undefined;
  for (const line of lines) {
    const text = line.text.replace(undecodablePattern, "").trim();
    const level = levelOf(line);
    if (level > 0 && previous?.level === level && previous.page === line.page) {
      texts[texts.length - 1] = `${texts.at(-1) ?? ""} ${text}`;
    } else {
      texts.push(
        level > 0 ? `${"#".repeat(level)} ${text}` : text.replace(/^(#|```|~~~)/u, "\\$1"),
      );
      origins.push({ page: line.page, line: line.line });
    }
    previous = level > 0 ? { level, page: line.page } : undefined;
  }
  return { text: texts.join("\n"), origins };
}
