import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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

/** The rejection reason of a preparation, or `null` when it succeeded. */
function rejection(run: () => unknown): DocumentRejection | null {
  try {
    run();
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
  ])("accepts %s", (name, extension, mediaType) => {
    expect(documentTypeOf(name)).toEqual({ extension, mediaType });
  });

  it.each(["notes.pdf", "notes.docx", "notes", "notes.md.exe", ".md"])("refuses %s", (name) => {
    expect(documentTypeOf(name)).toBeNull();
  });
});

describe("prepareDocument", () => {
  it("hashes the exact original bytes", () => {
    const bytes = encode("# Fictional notes\n\nSome text.\n");

    const prepared = prepareDocument(input("", { bytes }));

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

  it("splits by headings, keeping parent sections and ordinals", () => {
    const prepared = prepareDocument(
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

  it("bounds long sections and overlaps their chunks", () => {
    const words = Array.from({ length: 900 }, (_, index) => `word${String(index)}`).join(" ");

    const prepared = prepareDocument(input(`## Long\n\n${words}`));

    expect(prepared.chunks.length).toBeGreaterThan(3);
    for (const chunk of prepared.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(chunkMaxLength);
      expect(chunk.text.startsWith("Fictional notes / Long\n")).toBe(true);
    }
    const [first, second] = prepared.chunks.map((chunk) => chunk.text.split("\n")[1] ?? "");
    // The second chunk starts with words from the end of the first one.
    const head = (second ?? "").split(" ").slice(0, 5).join(" ");
    const overlap = (first ?? "").slice((first ?? "").indexOf(head));
    expect(first?.startsWith(head)).toBe(false);
    expect(overlap.length).toBeGreaterThan(0);
    expect(overlap.length).toBeLessThanOrEqual(200);
    expect(second?.startsWith(overlap)).toBe(true);
  });

  it("treats plain text as one section below the title", () => {
    const prepared = prepareDocument(
      input("# Not a heading in text\nA line.", { fileName: "notes.txt" }),
    );

    expect(prepared.mediaType).toBe("text/plain");
    expect(prepared.sections.map((section) => section.headingPath)).toEqual([["Fictional notes"]]);
  });

  it("cleans Unicode, whitespace and line-break hyphenation", () => {
    const prepared = prepareDocument(
      input(
        "﻿Café   menu​ with   spaces   \r\nwell-\r\nknown words.\r\n\r\n\r\n\r\nNext - Item\r\n",
        { fileName: "notes.txt" },
      ),
    );

    expect(prepared.text).toBe("Café menu with spaces\nwellknown words.\n\nNext - Item");
  });

  it.each([
    ["notes.pdf", "%PDF-1.7 fictional"],
    ["notes.docx", "plain words"],
    ["notes.md", "%PDF-1.7 renamed"],
    ["notes.md", "\u0000\u0001binary"],
    ["notes.txt", "\u0089PNG\r\n"],
    ["notes.md", "PK\u0003\u0004zip"],
  ])("rejects %s holding %j as an unsupported type", (fileName, text) => {
    expect(rejection(() => prepareDocument(input(text, { fileName })))).toBe("unsupported_type");
  });

  it("says that PDF is not supported yet", () => {
    expect(() => prepareDocument(input("%PDF-1.7", { fileName: "notes.pdf" }))).toThrow(/PDF/);
  });

  it("rejects bytes that are not UTF-8", () => {
    const bytes = new Uint8Array([0x23, 0x20, 0xc3, 0x28, 0x0a]);

    expect(rejection(() => prepareDocument(input("", { bytes })))).toBe("not_utf8");
  });

  it.each(["", "   \n\n\t", "# Fictional notes\n\n## Only headings\n"])(
    "rejects the empty document %j",
    (text) => {
      expect(rejection(() => prepareDocument(input(text)))).toBe("empty");
    },
  );

  it("rejects an original over the byte limit before decoding it", () => {
    const limits = { ...defaultDocumentLimits, maxBytes: 10 };

    expect(rejection(() => prepareDocument(input("x".repeat(11)), { limits }))).toBe("too_large");
    expect(rejection(() => prepareDocument(input("x".repeat(10)), { limits }))).toBeNull();
  });

  it("rejects a cleaned text over the extracted limit", () => {
    const limits = { ...defaultDocumentLimits, maxExtractedChars: 20 };

    expect(rejection(() => prepareDocument(input("word ".repeat(10)), { limits }))).toBe(
      "extracted_too_large",
    );
  });

  it("rejects a preparation that takes longer than its limit", () => {
    let now = 0;
    const clock = () => (now += 600);
    const limits = { ...defaultDocumentLimits, maxProcessingMs: 1000 };

    expect(rejection(() => prepareDocument(input("Some text."), { limits, clock }))).toBe(
      "too_slow",
    );
  });

  it.each(["", "   ", "x".repeat(301), "https://example.test/notes", "Line\nbreak"])(
    "rejects the display title %j",
    (title) => {
      expect(rejection(() => prepareDocument(input("Text.", { title })))).toBe("invalid_title");
    },
  );

  it("rejects an invalid slug", () => {
    expect(rejection(() => prepareDocument(input("Text.", { slug: "../x" })))).toBe("invalid_slug");
  });

  it.each(sensitive)("finds a %s value without keeping it", (kind, value) => {
    const prepared = prepareDocument(input(`# Fictional notes\n\nIntro.\n\nSee ${value} here.\n`));

    expect(prepared.findings).toContainEqual({ kind, line: 5 });
    expect(JSON.stringify(prepared.findings)).not.toContain(value.slice(0, 12));
    expect(Object.keys(prepared.findings[0] ?? {}).sort()).toEqual(["kind", "line"]);
  });

  it("finds a sensitive value in the display title as line 0", () => {
    const prepared = prepareDocument(input("Text.", { title: "Call jordan.sample@example.test" }));

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
  ])("finds nothing in %j", (text) => {
    expect(prepareDocument(input(text)).findings).toEqual([]);
  });

  it("finds nothing in the fictional supplemental documents of the eval set", () => {
    const dataset = JSON.parse(
      readFileSync(new URL("../../../evals/datasets/questions.json", import.meta.url), "utf8"),
    ) as { documents: { sourceId: string; title: string; file: string }[] };

    for (const document of dataset.documents) {
      const bytes = readFileSync(
        new URL(`../../../evals/datasets/${document.file}`, import.meta.url),
      );
      const prepared = prepareDocument({
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
