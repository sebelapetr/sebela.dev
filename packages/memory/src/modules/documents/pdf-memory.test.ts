// The parser's memory bound measured as the process's peak resident memory. In a file of its own,
// so no other test's documents raise the peak while the bomb is read.
import { resourceUsage } from "node:process";

import { describe, expect, it } from "vitest";

import { fixturePdf } from "../../testing.js";
import { defaultDocumentLimits, prepareDocument, type DocumentInput } from "./index.js";

const mebibyte = 1_048_576;

const pdf = (bytes: Uint8Array): DocumentInput => ({
  fileName: "bomb.pdf",
  bytes,
  slug: "bomb",
  title: "Fictional bomb",
});

/** The process's peak resident memory so far, in bytes. */
const peakBytes = () => resourceUsage().maxRSS * 1024;

const reasonOf = async (input: DocumentInput) => {
  try {
    await prepareDocument(input);
    return null;
  } catch (error) {
    return (error as { reason?: string }).reason ?? null;
  }
};

describe("the PDF parser's memory", () => {
  it("refuses a stream that decodes to a gigabyte before its buffers reach the limit", async () => {
    const body = { text: "Fictional body text for the parser's memory bound." };
    // The worker's own start and the parser's code, measured on a harmless PDF first.
    expect(await reasonOf(pdf(fixturePdf([{ lines: [body] }])))).toBeNull();
    const before = peakBytes();

    const bomb = fixturePdf([{ lines: [body] }], { inflatedSpaces: 1024 * mebibyte });
    expect(bomb.length).toBeLessThan(defaultDocumentLimits.maxPdfBytes);
    expect(await reasonOf(pdf(bomb))).toBe("parser_limit");

    // No buffer may exceed an eighth of the limit: the growing stream, its copy while it doubles
    // and the parser's heap stay within half of it.
    const limit = defaultDocumentLimits.maxParserMemoryMb * mebibyte;
    expect(peakBytes() - before).toBeLessThan(limit / 2);
  }, 60_000);
});
