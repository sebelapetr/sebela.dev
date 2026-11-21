import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fixturePdf, malformedPdf, type FixturePdfPage } from "../../testing.js";
import { chunkMaxLength } from "../ingest/index.js";

import {
  DocumentRejectedError,
  contentHashOf,
  defaultDocumentLimits,
  documentSourceId,
  documentTypeOf,
  prepareDocument,
  type DocumentInput,
  type DocumentRejection,
  type SensitivityKind,
} from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);

const input = (text: string, change: Partial<DocumentInput> = {}): DocumentInput => ({
  slug: "fictional-notes",
  title: "Fictional notes",
  fileName: "notes.md",
  bytes: encode(text),
  ...change,
});

/** The refusal of a preparation that must fail. */
async function refusal(run: () => Promise<unknown>): Promise<DocumentRejectedError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DocumentRejectedError) return error;
    throw error;
  }
  throw new Error("The preparation succeeded.");
}

/** The rejection reason of a preparation, or `null` when it succeeded. */
async function rejection(run: () => Promise<unknown>): Promise<DocumentRejection | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof DocumentRejectedError) {
      expect(error.message.length).toBeGreaterThan(20);
      return error.reason;
    }
    throw error;
  }
}

// Every value below is fictional; tokens are assembled at run time so no scanner mistakes the
// source for a leaked credential.
const sensitive: readonly [SensitivityKind, string][] = [
  [
    "private_key",
    "-----BEGIN RSA " + "PRIVATE KEY-----\nMIIEfictional\n-----END RSA PRIVATE KEY-----",
  ],
  ["private_key", "-----BEGIN OPENSSH " + "PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n"],
  ["connection_string", "postgres" + "://reader:fictional-secret@db.example.test:5432/demo"],
  ["connection_string", "mongodb+srv" + "://cluster0.example.test/demo"],
  ["connection_string", "https://" + "jordan:fictional-pass@files.example.test/export"],
  [
    "connection_string",
    "Server=db.example.test;Database=demo;User Id=sa;Password=" + "fictional1;",
  ],
  ["credential", "AKIA" + "FICTIONALEXAMPLE"],
  ["credential", "gh" + "p_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"],
  ["credential", "github_pat_" + "11FICTIONAL0000000000_abcdefghijklmnopqrstuvwx"],
  ["credential", "xox" + "b-0000000000-fictionaltoken"],
  ["credential", "sk_" + "live_" + "FICTIONAL0000000000000000"],
  ["credential", "sk-" + "ant-" + "fictional0000000000000000000000"],
  ["credential", "AIza" + "SyFICTIONAL_000000000000000000000000"],
  ["credential", "pa-" + "FICTIONAL000000000000000000000000000000"],
  ["credential", "eyJ" + "hbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaWN0aW9uYWwifQ.c2lnbmF0dXJlZmljdGlvbmFs"],
  ["credential", "Authorization: Bearer " + "fictionalBearerToken000000"],
  ["credential", "api_key = " + "fictional0000value"],
  ["credential", "password: " + "Fictional-Passw0rd"],
  ["email", "jordan.sample@example.test"],
  ["national_identifier", "855415/0011"],
  ["national_identifier", "8554150011"],
  ["national_identifier", "123-45-6789"],
  ["bank_account", "CZ34 5500 0000 0012 3456 7004"],
  ["bank_account", "CZ3455000000001234567004"],
  ["bank_account", "1234567004/5500"],
  ["telephone", "+420 601 234 567"],
  ["telephone", "00421 905 123 456"],
  ["telephone", "601 234 567"],
  ["telephone", "(555) 010-0199"],
];

describe("documentSourceId", () => {
  it("names a document by its slug", () => {
    expect(documentSourceId("support-handbook-excerpt")).toBe("document:support-handbook-excerpt");
  });

  it.each(["", "Upper", "under_score", "-leading", "a/b", "../x", "a".repeat(200)])(
    "refuses the slug %j",
    (slug) => {
      expect(documentSourceId(slug)).toBeNull();
    },
  );
});

describe("documentTypeOf", () => {
  it.each([
    ["notes.md", "md", "text/markdown"],
    ["NOTES.MARKDOWN", "md", "text/markdown"],
    ["notes.txt", "txt", "text/plain"],
    ["Report.PDF", "pdf", "application/pdf"],
  ])("accepts %s", (name, extension, mediaType) => {
    expect(documentTypeOf(name)).toEqual({ extension, mediaType });
  });

  it.each(["notes.docx", "notes", "notes.md.exe", ".md", ".pdf"])("refuses %s", (name) => {
    expect(documentTypeOf(name)).toBeNull();
  });
});

describe("prepareDocument", () => {
  it("hashes the exact original bytes", async () => {
    const bytes = encode("# Fictional notes\n\nSome text.\n");

    const prepared = await prepareDocument(input("", { bytes }));

    expect(prepared.contentHash).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(contentHashOf(bytes)).toBe(prepared.contentHash);
    expect(prepared).toMatchObject({
      sourceId: "document:fictional-notes",
      title: "Fictional notes",
      mediaType: "text/markdown",
      extension: "md",
      findings: [],
    });
  });

  it("splits by headings, keeping parent sections and ordinals", async () => {
    const prepared = await prepareDocument(
      input(
        [
          "# Fictional notes",
          "",
          "Opening paragraph.",
          "",
          "## Evaluation",
          "",
          "Golden sets first.",
          "",
          "### Graders",
          "",
          "Graders second.",
          "",
          "## Empty",
          "",
          "## Launch",
          "",
          "```",
          "# not a heading inside code",
          "```",
        ].join("\n"),
      ),
    );

    expect(prepared.sections.map((section) => section.headingPath)).toEqual([
      ["Fictional notes"],
      ["Fictional notes", "Evaluation"],
      ["Fictional notes", "Evaluation", "Graders"],
      ["Fictional notes", "Launch"],
    ]);
    expect(prepared.sections.map((section) => section.ordinal)).toEqual([0, 1, 2, 3]);
    expect(prepared.chunks.map((chunk) => [chunk.sectionOrdinal, chunk.ordinal])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(prepared.chunks[2]?.text).toBe(
      "Fictional notes / Evaluation / Graders\nGraders second.",
    );
    expect(prepared.chunks[3]?.text).toContain("# not a heading inside code");
    for (const chunk of prepared.chunks) {
      expect(chunk.textHash).toBe(createHash("sha256").update(chunk.text).digest("hex"));
    }
    for (const section of prepared.sections) {
      expect(prepared.text.slice(section.start, section.end).trim().length).toBeGreaterThan(0);
    }
  });

  it("bounds long sections and overlaps their chunks", async () => {
    const words = Array.from({ length: 900 }, (_, index) => `word${String(index)}`).join(" ");

    const prepared = await prepareDocument(input(`## Long\n\n${words}`));

    expect(prepared.chunks.length).toBeGreaterThan(3);
    for (const chunk of prepared.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(chunkMaxLength);
      expect(chunk.text.startsWith("Fictional notes / Long\n")).toBe(true);
    }
    const [first, second] = prepared.chunks.map((chunk) => chunk.text.split("\n")[1] ?? "");
    // The second chunk starts with words from the end of the first one.
    const head = (second ?? "").split(" ").slice(0, 5).join(" ");
    const at = (first ?? "").indexOf(head);
    expect(at).toBeGreaterThan(0);
    const overlap = (first ?? "").slice(at);
    expect(first?.startsWith(head)).toBe(false);
    expect(overlap.length).toBeGreaterThan(0);
    expect(overlap.length).toBeLessThanOrEqual(200);
    expect(second?.startsWith(overlap)).toBe(true);
  });

  it("treats plain text as one section below the title", async () => {
    const prepared = await prepareDocument(
      input("# Not a heading in text\nA line.", { fileName: "notes.txt" }),
    );

    expect(prepared.mediaType).toBe("text/plain");
    expect(prepared.sections.map((section) => section.headingPath)).toEqual([["Fictional notes"]]);
  });

  it("cleans Unicode, whitespace and line-break hyphenation", async () => {
    const prepared = await prepareDocument(
      input(
        "﻿Café   menu​ with   spaces   \r\nwell-\r\nknown words.\r\n\r\n\r\n\r\nNext - Item\r\n",
        { fileName: "notes.txt" },
      ),
    );

    expect(prepared.text).toBe("Café menu with spaces\nwellknown words.\n\nNext - Item");
  });

  it.each([
    ["notes.docx", "plain words"],
    ["notes.pdf", "plain words"],
    ["notes.md", "\u0000\u0001binary"],
    ["notes.txt", "\u0089PNG\r\n"],
    ["notes.md", "PK\u0003\u0004zip"],
  ])("rejects %s holding %j as an unsupported type", async (fileName, text) => {
    expect(await rejection(() => prepareDocument(input(text, { fileName })))).toBe(
      "unsupported_type",
    );
  });

  it("asks for the .pdf extension when a text file holds a PDF", async () => {
    const error = await refusal(() => prepareDocument(input("%PDF-1.7 renamed")));

    expect(error.reason).toBe("unsupported_type");
    expect(error.message).toMatch(/\.pdf/u);
  });

  it("rejects bytes that are not UTF-8", async () => {
    const bytes = new Uint8Array([0x23, 0x20, 0xc3, 0x28, 0x0a]);

    expect(await rejection(() => prepareDocument(input("", { bytes })))).toBe("not_utf8");
  });

  it.each(["", "   \n\n\t", "# Fictional notes\n\n## Only headings\n"])(
    "rejects the empty document %j",
    async (text) => {
      expect(await rejection(() => prepareDocument(input(text)))).toBe("empty");
    },
  );

  it("rejects an original over the byte limit before decoding it", async () => {
    const limits = { ...defaultDocumentLimits, maxBytes: 10 };

    expect(await rejection(() => prepareDocument(input("x".repeat(11)), { limits }))).toBe(
      "too_large",
    );
    expect(await rejection(() => prepareDocument(input("x".repeat(10)), { limits }))).toBeNull();
  });

  it("rejects a cleaned text over the extracted limit", async () => {
    const limits = { ...defaultDocumentLimits, maxExtractedChars: 20 };

    expect(await rejection(() => prepareDocument(input("word ".repeat(10)), { limits }))).toBe(
      "extracted_too_large",
    );
  });

  it("rejects a preparation that takes longer than its limit", async () => {
    let now = 0;
    const clock = () => (now += 600);
    const limits = { ...defaultDocumentLimits, maxProcessingMs: 1000 };

    expect(await rejection(() => prepareDocument(input("Some text."), { limits, clock }))).toBe(
      "too_slow",
    );
  });

  it.each(["", "   ", "x".repeat(301), "https://example.test/notes", "Line\nbreak"])(
    "rejects the display title %j",
    async (title) => {
      expect(await rejection(() => prepareDocument(input("Text.", { title })))).toBe(
        "invalid_title",
      );
    },
  );

  it("rejects an invalid slug", async () => {
    expect(await rejection(() => prepareDocument(input("Text.", { slug: "../x" })))).toBe(
      "invalid_slug",
    );
  });

  it.each(sensitive)("finds a %s value without keeping it", async (kind, value) => {
    const prepared = await prepareDocument(
      input(`# Fictional notes\n\nIntro.\n\nSee ${value} here.\n`),
    );

    expect(prepared.findings).toContainEqual({ kind, line: 5 });
    expect(JSON.stringify(prepared.findings)).not.toContain(value.slice(0, 12));
    expect(Object.keys(prepared.findings[0] ?? {}).sort()).toEqual(["kind", "line"]);
  });

  it("reports each finding at its line in the original file", async () => {
    const text = [
      "",
      "",
      "# Fictional notes",
      "",
      "Intro of a well-",
      "known team.",
      "",
      "",
      "",
      "",
      "Mail jordan.sample@example.test today.",
      "Before a form feed.\fCall +420 777 123 456 after it.",
      "Long-",
      "distance call 555-010-0199.",
      "",
    ].join("\r\n");

    const prepared = await prepareDocument(input(text, { fileName: "notes.txt" }));

    expect(prepared.findings).toEqual([
      { kind: "email", line: 11 },
      { kind: "telephone", line: 12 },
      // "Long-" and "distance" are joined; the number is on the second of the two lines.
      { kind: "telephone", line: 14 },
    ]);
  });

  it.each([
    ["dotted words", "", "a.", 48_000],
    ["hyphenated words", "", "a-", 48_000],
    ["a dotted address", "https://", "a.", 48_000],
    ["token-like words", "", "eyJ-", 48_000],
    ["connection settings", "", "Host=a;", 400_000],
    ["lines with telephone numbers", "", "Call 555-010-0199 now.\n", 400_000],
  ])("prepares a long run of %s within the processing time", async (_name, prefix, unit, size) => {
    const text = prefix + unit.repeat(Math.ceil(size / unit.length));
    const started = performance.now();

    expect(
      await rejection(() => prepareDocument(input(text, { fileName: "notes.txt" }))),
    ).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("finds a sensitive value in the display title as line 0", async () => {
    const prepared = await prepareDocument(
      input("Text.", { title: "Call jordan.sample@example.test" }),
    );

    expect(prepared.findings).toEqual([{ kind: "email", line: 0 }]);
  });

  it.each([
    "Founded in 2015, rebuilt in 2019 and retired in 2023.",
    "From February 2019 until June 2023.",
    "On 2021-03-15 we shipped version 1.2.3.",
    "It took 12 000 hours and 3 500 tests.",
    "Account 1234567005/5500 fails its checksum.",
    "The ratio 855415/0012 fails its checksum.",
    "A password: short is not a credential.",
  ])("finds nothing in %j", async (text) => {
    expect((await prepareDocument(input(text))).findings).toEqual([]);
  });

  it("finds nothing in the fictional supplemental documents of the eval set", async () => {
    const dataset = JSON.parse(
      readFileSync(new URL("../../../evals/datasets/questions.json", import.meta.url), "utf8"),
    ) as { documents: { sourceId: string; title: string; file: string }[] };

    for (const document of dataset.documents) {
      const bytes = readFileSync(
        new URL(`../../../evals/datasets/${document.file}`, import.meta.url),
      );
      const prepared = await prepareDocument({
        slug: document.sourceId.replace(/^document:/, ""),
        title: document.title,
        fileName: document.file,
        bytes,
      });

      expect(prepared.findings, document.sourceId).toEqual([]);
      expect(prepared.sourceId).toBe(document.sourceId);
      expect(prepared.sections[0]?.headingPath).toEqual([document.title]);
    }
  });
});

describe("prepareDocument with a PDF", () => {
  const pdf = (bytes: Uint8Array, change: Partial<DocumentInput> = {}): DocumentInput =>
    input("", { fileName: "field-report.pdf", bytes, ...change });

  // A fictional two-page report: a running header and a page-number footer on both pages,
  // headings in larger type and a word hyphenated across a line break.
  const reportPages: readonly FixturePdfPage[] = [
    {
      lines: [
        { text: "Fictional Field Report" },
        { text: "Northwind Survey", size: 20 },
        { text: "The survey covered three valleys and their hydro-" },
        { text: "logical stations over one season." },
        { text: "Methods", size: 15 },
        { text: "Each station was visited weekly." },
        { text: "Page 1 of 2" },
      ],
    },
    {
      lines: [
        { text: "Fictional Field Report" },
        { text: "Findings", size: 15 },
        { text: "Water levels rose in the spring." },
        { text: "Page 2 of 2" },
      ],
    },
  ];
  const report = fixturePdf(reportPages);

  it("accepts a PDF with a text layer, keeping its pages and headings", async () => {
    const prepared = await prepareDocument(pdf(report));

    expect(prepared).toMatchObject({
      sourceId: "document:fictional-notes",
      title: "Fictional notes",
      mediaType: "application/pdf",
      extension: "pdf",
      contentHash: contentHashOf(report),
      findings: [],
    });
    expect(prepared.sections.map((section) => section.headingPath)).toEqual([
      ["Fictional notes", "Northwind Survey"],
      ["Fictional notes", "Northwind Survey", "Methods"],
      ["Fictional notes", "Northwind Survey", "Findings"],
    ]);
    expect(prepared.chunks.map((chunk) => chunk.text)).toEqual([
      "Fictional notes / Northwind Survey\nThe survey covered three valleys and their hydrological stations over one season.",
      "Fictional notes / Northwind Survey / Methods\nEach station was visited weekly.",
      "Fictional notes / Northwind Survey / Findings\nWater levels rose in the spring.",
    ]);
  });

  it("removes running headers and page numbers but keeps a single page's first line", async () => {
    const prepared = await prepareDocument(pdf(report));
    const single = await prepareDocument(pdf(fixturePdf(reportPages.slice(0, 1))));

    expect(prepared.text).not.toContain("Fictional Field Report");
    expect(prepared.text).not.toMatch(/Page \d/u);
    expect(single.text).toContain("Fictional Field Report");
  });

  it("reports a finding at its page and its line on the page", async () => {
    const bytes = fixturePdf([
      reportPages[0] ?? {},
      {
        lines: [
          { text: "Fictional Field Report" },
          { text: "Findings", size: 15 },
          { text: "Write to jordan.sample@example.test for the data." },
          { text: "Page 2 of 2" },
        ],
      },
    ]);

    const prepared = await prepareDocument(pdf(bytes));

    expect(prepared.findings).toEqual([{ kind: "email", page: 2, line: 3 }]);
  });

  it("treats scripts and links as data: neither runs nor enters the text", async () => {
    const bytes = fixturePdf(reportPages, { activeContent: true });

    const prepared = await prepareDocument(pdf(bytes));

    expect(prepared.chunks).toHaveLength(3);
    expect(prepared.text).not.toMatch(/example\.test|app\.alert/u);
  });

  const body = { text: "Readable fictional text on this page." };
  it.each<[string, () => Uint8Array, DocumentRejection, RegExp]>([
    ["a malformed PDF", malformedPdf, "malformed", /damaged|not a readable PDF/u],
    [
      "a password-protected PDF",
      () => fixturePdf([{ lines: [body] }], { encrypted: true }),
      "encrypted",
      /password/u,
    ],
    [
      "a scanned PDF",
      () => fixturePdf([{ image: true }, { image: true }]),
      "no_text_layer",
      /text recognition \(OCR\)/u,
    ],
    ["an empty PDF", () => fixturePdf([{}, {}]), "empty", /no text/u],
    [
      "a PDF with a scanned page",
      () => fixturePdf([{ lines: [body] }, { image: true }]),
      "incomplete_extraction",
      /page 2/u,
    ],
    [
      "a PDF whose text cannot be decoded",
      () =>
        fixturePdf([
          { lines: [body, { text: "Glyphs without any Unicode mapping.", undecodable: true }] },
        ]),
      "incomplete_extraction",
      /page 1/u,
    ],
    ["a file named .pdf that is no PDF", () => encode("plain words"), "unsupported_type", /PDF/u],
  ])("rejects %s with its message", async (_name, bytes, reason, message) => {
    const error = await refusal(() => prepareDocument(pdf(bytes())));

    expect(error.reason).toBe(reason);
    expect(error.message).toMatch(message);
  });

  it("holds a PDF to its own byte limit before reading it", async () => {
    const tight = { ...defaultDocumentLimits, maxPdfBytes: report.length - 1 };
    const textTight = { ...defaultDocumentLimits, maxBytes: 10 };

    expect(await rejection(() => prepareDocument(pdf(report), { limits: tight }))).toBe(
      "too_large",
    );
    expect(await rejection(() => prepareDocument(pdf(report), { limits: textTight }))).toBeNull();
  });

  it("rejects a PDF with more pages than the limit", async () => {
    const limits = { ...defaultDocumentLimits, maxPages: 2 };
    const three = fixturePdf([...reportPages, { lines: [body] }]);

    expect(await rejection(() => prepareDocument(pdf(three), { limits }))).toBe("too_many_pages");
    expect(await rejection(() => prepareDocument(pdf(report), { limits }))).toBeNull();
  });

  it("rejects a PDF whose extracted text is over the limit", async () => {
    const limits = { ...defaultDocumentLimits, maxExtractedChars: 40 };

    expect(await rejection(() => prepareDocument(pdf(report), { limits }))).toBe(
      "extracted_too_large",
    );
  });

  it("stops reading a PDF that takes longer than the processing time", async () => {
    const limits = { ...defaultDocumentLimits, maxProcessingMs: 1 };

    expect(await rejection(() => prepareDocument(pdf(report), { limits }))).toBe("too_slow");
  });

  it("stops the parser when it needs more memory than its limit", async () => {
    const limits = { ...defaultDocumentLimits, maxParserMemoryMb: 4 };

    expect(await rejection(() => prepareDocument(pdf(report), { limits }))).toBe("parser_limit");
  });

  it("is the default limits' choice: 10 MiB, 100 pages, 256 MiB of parser memory", () => {
    expect(defaultDocumentLimits).toMatchObject({
      maxPdfBytes: 10_485_760,
      maxPages: 100,
      maxParserMemoryMb: 256,
    });
  });
});
