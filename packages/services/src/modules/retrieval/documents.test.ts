import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";
import {
  createFakeEmbedder,
  createFakeReranker,
  defaultDocumentLimits,
  type Embedder,
  type RetrievalConfig,
} from "@sebela/memory";
import { fixturePdf, malformedPdf, type FixturePdfPage } from "@sebela/memory/testing";

import { DomainError } from "../../errors.js";
import { createProfileService } from "../profile/index.js";
import { createRoadmapService } from "../roadmap/index.js";
import { openPrivateStorage, type PrivateStorage } from "../storage/index.js";
import { createKnowledgeService, type KnowledgeServiceOptions } from "./index.js";

// Ingesting, reviewing and approving supplemental documents through the knowledge service, over a
// real Postgres, local private storage and the fake embedder. Every fixture is fictional.

const config: RetrievalConfig = {
  embeddingModel: "fake-hashed-words",
  embeddingPricePerMillionTokensUsd: 0.06,
  embeddingBatchSize: 16,
  rerankModel: "fake-word-overlap",
  rerankPricePerMillionTokensUsd: 0.05,
  providerTimeoutMs: 1000,
  providerRetries: 0,
  providerMaxRetryWaitMs: 0,
  monthlyCeilingUsd: 1,
  candidatePool: 30,
  finalPassages: 6,
  relevanceFloor: 0.1,
};

const encode = (text: string) => new TextEncoder().encode(text);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const HANDBOOK = `# Harbour support handbook

## Opening hours

The harbour help desk answers questions about mooring permits from eight until four.

## Refunds

A cancelled mooring permit is refunded within ten working days after the request.
`;

const REVISED = HANDBOOK.replace("ten working days", "five working days");

// Assembled at run time, so the fixture is not a literal address in the repository.
const LEAKY = `${HANDBOOK}\n## Contact\n\nWrite to ${["harbour.desk", "example.test"].join("@")} for help.\n`;

const handbook = (bytes = encode(HANDBOOK)) => ({
  slug: "harbour-handbook",
  title: "Harbour support handbook",
  fileName: "Internal handbook FINAL v3.md",
  bytes,
});

async function refusal(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.then(
    () => null,
    (failure: unknown) => failure,
  );
  if (!(error instanceof DomainError)) {
    throw new Error(`Expected a domain error, got ${String(error)}`);
  }
  return error;
}

/** Every file below a folder, as relative paths. */
async function filesBelow(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    },
  );
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

describe("supplemental documents through the knowledge service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let privateRoot: string;
  let privateStorage: PrivateStorage;

  const open = (
    options: Partial<Omit<KnowledgeServiceOptions, "privateStorage">> & {
      store?: Persistence["retrieval"];
      /** `null` opens the service without private storage. */
      privateStorage?: KnowledgeServiceOptions["privateStorage"] | null;
    } = {},
  ) => {
    const embedder = createFakeEmbedder();
    const { store, privateStorage: storage, ...rest } = options;
    const knowledge = createKnowledgeService(
      {
        store: store ?? persistence.retrieval,
        profile: createProfileService(persistence.profile),
        roadmap: createRoadmapService(persistence.roadmap),
      },
      {
        config,
        embedder,
        reranker: createFakeReranker(),
        ...(storage === null ? {} : { privateStorage: storage ?? privateStorage }),
        ...rest,
      },
    );
    return { knowledge, embedder };
  };

  const supplementalPassages = async (
    knowledge: ReturnType<typeof open>["knowledge"],
    query: string,
  ) => (await knowledge.search({ query })).passages.filter((p) => p.sourceKind === "supplemental");

  // A fresh database for every test: each one starts without document versions or sources.
  beforeEach(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    privateRoot = await mkdtemp(join(tmpdir(), "sebela-private-documents-"));
    privateStorage = openPrivateStorage({
      driver: "local",
      root: privateRoot,
      environment: "test",
      worktree: "documents",
    });
  }, 60_000);

  afterEach(async () => {
    await persistence.close();
    await database.drop();
    await rm(privateRoot, { recursive: true, force: true });
  });

  it("records a pending version with a preview and never calls the provider before approval", async () => {
    const { knowledge, embedder } = open();

    const ingested = await knowledge.ingestDocument(handbook());

    expect(ingested.created).toBe(true);
    expect(ingested.version).toMatchObject({
      sourceId: "document:harbour-handbook",
      contentHash: sha(encode(HANDBOOK)),
      title: "Harbour support handbook",
      mediaType: "text/markdown",
      byteSize: encode(HANDBOOK).length,
      status: "pending",
      findings: [],
      sectionCount: 2,
    });
    expect(ingested.version).not.toHaveProperty("storageKey");
    expect(await knowledge.listDocuments()).toEqual([ingested.version]);

    const preview = await knowledge.showDocument(ingested.version.contentHash);
    expect(preview.version).toEqual(ingested.version);
    expect(preview.text).toContain("mooring permits");
    expect(preview.sections.map((section) => section.headingPath)).toEqual([
      ["Harbour support handbook", "Opening hours"],
      ["Harbour support handbook", "Refunds"],
    ]);
    expect(preview.chunks.length).toBe(ingested.version.chunkCount);
    expect(preview.findings).toEqual([]);

    expect(embedder.calls).toBe(0);
    expect(await filesBelow(privateRoot)).toHaveLength(1);
  });

  it("does nothing when the same bytes are ingested again", async () => {
    const { knowledge, embedder } = open();
    const first = await knowledge.ingestDocument(handbook());

    const again = await knowledge.ingestDocument({ ...handbook(), title: "Another title" });

    expect(again).toEqual({ created: false, version: first.version });
    expect(await knowledge.listDocuments()).toHaveLength(1);
    expect(await filesBelow(privateRoot)).toHaveLength(1);
    expect(embedder.calls).toBe(0);
  });

  it("refuses the same bytes under another slug", async () => {
    const { knowledge } = open();
    await knowledge.ingestDocument(handbook());
    const error = await refusal(
      knowledge.ingestDocument({ ...handbook(), slug: "another-handbook" }),
    );
    expect(error.code).toBe("conflict");
  });

  it("keeps a pending version out of search and makes the approved bytes searchable", async () => {
    const { knowledge, embedder } = open();
    const { version } = await knowledge.ingestDocument(handbook());
    expect(await supplementalPassages(knowledge, "mooring permit refund")).toEqual([]);
    const callsBefore = embedder.calls;

    const approved = await knowledge.approveDocument(version.contentHash);

    expect(approved.version.status).toBe("approved");
    expect(approved.report.embedded).toBe(version.chunkCount);
    expect(embedder.calls).toBeGreaterThan(callsBefore);
    const [passage] = await supplementalPassages(knowledge, "mooring permit refund");
    expect(passage).toMatchObject({
      sourceKind: "supplemental",
      sourceId: "document:harbour-handbook",
      title: "Harbour support handbook",
      version: version.contentHash,
      provenance: { contentKind: "document" },
    });
    expect(JSON.stringify(passage)).not.toContain("FINAL");
    expect(passage).not.toHaveProperty("path");
  });

  it("approves only the exact content hash", async () => {
    const { knowledge, embedder } = open();
    const { version } = await knowledge.ingestDocument(handbook());

    expect((await refusal(knowledge.approveDocument("f".repeat(64)))).code).toBe("not_found");
    expect((await refusal(knowledge.approveDocument(version.contentHash.slice(0, 12)))).code).toBe(
      "validation_failed",
    );
    expect((await refusal(knowledge.approveDocument(version.contentHash.toUpperCase()))).code).toBe(
      "validation_failed",
    );
    expect(embedder.calls).toBe(0);
    expect((await knowledge.listDocuments())[0]?.status).toBe("pending");
  });

  it("refuses to approve when the stored original no longer has the approved hash", async () => {
    const tampered: PrivateStorage = {
      store: (file) => privateStorage.store(file),
      read: async (key) => {
        const bytes = await privateStorage.read(key);
        return bytes === null ? null : encode(REVISED);
      },
      delete: (key) => privateStorage.delete(key),
    };
    const { knowledge, embedder } = open({ privateStorage: tampered });
    const { version } = await knowledge.ingestDocument(handbook());

    expect((await refusal(knowledge.approveDocument(version.contentHash))).code).toBe("conflict");
    expect(embedder.calls).toBe(0);
    expect(await persistence.retrieval.indexedSources()).toEqual([]);
  });

  it("refuses to approve a pending version whose original now has findings", async () => {
    // A version recorded clean before a sensitivity check caught its e-mail address.
    const bytes = encode(LEAKY);
    const storageKey = await privateStorage.store({ bytes, extension: "md" });
    await persistence.retrieval.addDocumentVersion({
      sourceId: "document:harbour-handbook",
      contentHash: sha(bytes),
      title: "Harbour support handbook",
      mediaType: "text/markdown",
      byteSize: bytes.length,
      sectionCount: 4,
      chunkCount: 4,
      storageKey,
      status: "pending",
      findings: [],
    });
    const { knowledge, embedder } = open();

    const error = await refusal(knowledge.approveDocument(sha(bytes)));
    expect(error.code).toBe("conflict");
    expect(error.message).toMatch(/sensitivity findings.*sanitized revision/);
    expect(embedder.calls).toBe(0);
    expect(await persistence.retrieval.indexedSources()).toEqual([]);
    expect((await knowledge.showDocument(sha(bytes))).version.status).toBe("pending");
  });

  it("needs a new approval for changed bytes and keeps the approved version until then", async () => {
    const { knowledge } = open();
    const first = await knowledge.ingestDocument(handbook());
    await knowledge.approveDocument(first.version.contentHash);

    const revised = await knowledge.ingestDocument(handbook(encode(REVISED)));

    expect(revised.created).toBe(true);
    expect(revised.version.status).toBe("pending");
    const [before] = await supplementalPassages(knowledge, "mooring permit refund");
    expect(before?.version).toBe(first.version.contentHash);

    await knowledge.approveDocument(revised.version.contentHash);
    const [after] = await supplementalPassages(knowledge, "mooring permit refund");
    expect(after?.version).toBe(revised.version.contentHash);
    const statuses = Object.fromEntries(
      (await knowledge.listDocuments()).map((each) => [each.contentHash, each.status]),
    );
    expect(statuses).toEqual({
      [first.version.contentHash]: "superseded",
      [revised.version.contentHash]: "approved",
    });
  });

  it("blocks a version with findings, keeps no original and stores no detected value", async () => {
    const { knowledge, embedder } = open();

    const { version } = await knowledge.ingestDocument(handbook(encode(LEAKY)));

    expect(version.status).toBe("blocked");
    expect(version.findings).toEqual([{ kind: "email", line: 13 }]);
    expect(JSON.stringify(await knowledge.listDocuments())).not.toContain("harbour.desk");
    expect(await filesBelow(privateRoot)).toEqual([]);

    const error = await refusal(knowledge.approveDocument(version.contentHash));
    expect(error.code).toBe("conflict");
    expect(error.message).toContain("sanitized revision");
    expect(embedder.calls).toBe(0);
    expect(await supplementalPassages(knowledge, "harbour desk help")).toEqual([]);

    const preview = await knowledge.showDocument(version.contentHash);
    expect(preview).toMatchObject({ text: null, sections: [], chunks: [] });
    expect(preview.findings).toEqual(version.findings);
  });

  it("rejects a pending version, deletes its original and never indexes it", async () => {
    const { knowledge, embedder } = open();
    const { version } = await knowledge.ingestDocument(handbook());

    const rejected = await knowledge.rejectDocument(version.contentHash);

    expect(rejected.status).toBe("rejected");
    expect(await filesBelow(privateRoot)).toEqual([]);
    expect((await refusal(knowledge.approveDocument(version.contentHash))).code).toBe("conflict");
    expect(embedder.calls).toBe(0);
    expect(await supplementalPassages(knowledge, "mooring permit refund")).toEqual([]);
    expect((await refusal(knowledge.rejectDocument(version.contentHash))).code).toBe("conflict");
  });

  it("does not reject the approved version", async () => {
    const { knowledge } = open();
    const { version } = await knowledge.ingestDocument(handbook());
    await knowledge.approveDocument(version.contentHash);
    expect((await refusal(knowledge.rejectDocument(version.contentHash))).code).toBe("conflict");
  });

  it.each([
    ["an unsupported type", { fileName: "handbook.html" }, "unsupported_media_type"],
    ["Markdown bytes named .pdf", { fileName: "handbook.pdf" }, "unsupported_media_type"],
    [
      "bytes that are not UTF-8",
      { bytes: new Uint8Array([0x23, 0x20, 0xff, 0xfe]) },
      "unsupported_media_type",
    ],
    ["an empty file", { bytes: encode(" \n\n ") }, "validation_failed"],
    ["an invalid slug", { slug: "Harbour Handbook" }, "validation_failed"],
    ["a title that is an address", { title: "https://example.test/handbook" }, "validation_failed"],
  ])("refuses %s with an actionable message and stores nothing", async (_name, change, code) => {
    const { knowledge, embedder } = open();
    const error = await refusal(knowledge.ingestDocument({ ...handbook(), ...change }));
    expect(error.code).toBe(code);
    expect(error.message.length).toBeGreaterThan(20);
    expect(await knowledge.listDocuments()).toEqual([]);
    expect(await filesBelow(privateRoot)).toEqual([]);
    expect(embedder.calls).toBe(0);
  });

  // A fictional two-page PDF report with a running header and page-number footers.
  const reportPages = (
    contact = "Ask the harbour office for the tide tables.",
  ): FixturePdfPage[] => [
    {
      lines: [
        { text: "Fictional Harbour Report" },
        { text: "Harbour tides", size: 20 },
        { text: "The spring tides lift the moored boats by two metres." },
        { text: "Page 1 of 2" },
      ],
    },
    {
      lines: [
        { text: "Fictional Harbour Report" },
        { text: "Contact", size: 15 },
        { text: contact },
        { text: "Page 2 of 2" },
      ],
    },
  ];
  const report = (bytes = fixturePdf(reportPages())) => ({
    slug: "harbour-report",
    title: "Harbour tide report",
    fileName: "tide report.pdf",
    bytes,
  });

  it("ingests a PDF as a pending version, embeds it only on approval and restores it on rebuild", async () => {
    const { knowledge, embedder } = open();
    const bytes = fixturePdf(reportPages());

    const { version } = await knowledge.ingestDocument(report(bytes));

    expect(version).toMatchObject({
      sourceId: "document:harbour-report",
      contentHash: sha(bytes),
      mediaType: "application/pdf",
      byteSize: bytes.length,
      status: "pending",
      findings: [],
      sectionCount: 2,
    });
    const preview = await knowledge.showDocument(version.contentHash);
    expect(preview.sections.map((section) => section.headingPath)).toEqual([
      ["Harbour tide report", "Harbour tides"],
      ["Harbour tide report", "Harbour tides", "Contact"],
    ]);
    expect(preview.text).not.toContain("Fictional Harbour Report");
    expect(embedder.calls).toBe(0);
    expect(await filesBelow(privateRoot)).toEqual([expect.stringMatching(/\.pdf$/) as string]);

    const approved = await knowledge.approveDocument(version.contentHash);
    expect(approved.report.embedded).toBe(version.chunkCount);
    const [passage] = await supplementalPassages(knowledge, "spring tides moored boats");
    expect(passage).toMatchObject({ sourceId: "document:harbour-report", version: sha(bytes) });

    await persistence.retrieval.removeSourcesExcept("supplemental", []);
    const rebuilt = await knowledge.rebuildIndex();
    expect(rebuilt.documents).toMatchObject({ restored: 1, missing: 0 });
    expect(await supplementalPassages(knowledge, "spring tides moored boats")).toHaveLength(1);
  });

  it("blocks a PDF with findings at their page and line", async () => {
    const { knowledge, embedder } = open();
    const contact = `Write to ${["tide.desk", "example.test"].join("@")} for the tables.`;

    const { version } = await knowledge.ingestDocument(report(fixturePdf(reportPages(contact))));

    expect(version.status).toBe("blocked");
    expect(version.findings).toEqual([{ kind: "email", page: 2, line: 3 }]);
    expect((await knowledge.listDocuments())[0]?.findings).toEqual(version.findings);
    expect(await filesBelow(privateRoot)).toEqual([]);
    expect(embedder.calls).toBe(0);
  });

  it.each([
    ["a malformed PDF", malformedPdf(), "unsupported_media_type"],
    [
      "a password-protected PDF",
      fixturePdf(reportPages(), { encrypted: true }),
      "unsupported_media_type",
    ],
    ["a scanned PDF", fixturePdf([{ image: true }]), "unsupported_media_type"],
    [
      "a PDF with a scanned page",
      fixturePdf([...reportPages(), { image: true }]),
      "unsupported_media_type",
    ],
    ["an empty PDF", fixturePdf([{}]), "validation_failed"],
  ])("refuses %s with an actionable message and stores nothing", async (_name, bytes, code) => {
    const { knowledge, embedder } = open();
    const error = await refusal(knowledge.ingestDocument(report(bytes)));
    expect(error.code).toBe(code);
    expect(error.message.length).toBeGreaterThan(20);
    expect(await knowledge.listDocuments()).toEqual([]);
    expect(await filesBelow(privateRoot)).toEqual([]);
    expect(embedder.calls).toBe(0);
  });

  it.each([
    ["more pages than the limit", { maxPages: 1 }],
    ["more parser memory than the limit", { maxParserMemoryMb: 4 }],
    ["more bytes than the PDF limit", { maxPdfBytes: 64 }],
  ])("refuses a PDF that needs %s as too large", async (_name, change) => {
    const { knowledge } = open({ documentLimits: { ...defaultDocumentLimits, ...change } });
    expect((await refusal(knowledge.ingestDocument(report()))).code).toBe("payload_too_large");
    expect(await filesBelow(privateRoot)).toEqual([]);
  });

  it("refuses a file over the size limit as too large", async () => {
    const { knowledge } = open({
      documentLimits: { ...defaultDocumentLimits, maxBytes: 64, maxExtractedChars: 1000 },
    });
    expect((await refusal(knowledge.ingestDocument(handbook()))).code).toBe("payload_too_large");
    expect(await filesBelow(privateRoot)).toEqual([]);
  });

  it("removes the staged original when recording the version fails", async () => {
    const failing = {
      ...persistence.retrieval,
      addDocumentVersion: () => Promise.reject(new Error("The database is gone.")),
    };
    const { knowledge } = open({ store: failing });
    await expect(knowledge.ingestDocument(handbook())).rejects.toThrow("The database is gone.");
    expect(await filesBelow(privateRoot)).toEqual([]);
  });

  it("needs private storage to ingest, show or approve, and no provider to ingest", async () => {
    const withoutStorage = open({ privateStorage: null }).knowledge;
    await expect(withoutStorage.ingestDocument(handbook())).rejects.toThrow(/private storage/i);

    const offline: Embedder = createFakeEmbedder({ failing: true });
    const { knowledge } = open({ embedder: offline });
    const { version } = await knowledge.ingestDocument(handbook());
    expect(version.status).toBe("pending");
    expect((await refusal(knowledge.approveDocument(version.contentHash))).code).toBe(
      "provider_unavailable",
    );
    expect((await knowledge.listDocuments())[0]?.status).toBe("pending");
  });
});
