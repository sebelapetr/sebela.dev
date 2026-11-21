import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createPersistence,
  demoSeedFolder,
  readDatabaseConfig,
  type Persistence,
  type RetrievalPersistence,
} from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";
import {
  createFakeEmbedder,
  createFakeReranker,
  type Embedder,
  type RetrievalConfig,
} from "@sebela/memory";

import { DomainError } from "../../errors.js";
import { createProfileService } from "../profile/index.js";
import { createRoadmapService } from "../roadmap/index.js";
import { createSeedService } from "../seed/index.js";
import { openPrivateStorage, openStorage, type PrivateStorage } from "../storage/index.js";
import { createKnowledgeService, type KnowledgeService } from "./index.js";

// Replacing, withdrawing, deleting and rebuilding supplemental sources, and leaving conflicting
// chunks out of search, over a real Postgres with pgvector, local private storage and the fake
// embedder. Every fixture is fictional.

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

const HANDBOOK = `# Harbour support handbook

## Opening hours

The harbour help desk answers questions about mooring permits from eight until four.

## Refunds

A cancelled mooring permit is refunded within ten working days after the request.

## Waiting list

A berth on the waiting list is offered in the order of the requests.
`;

const REVISED = HANDBOOK.replace("ten working days", "five working days").replace(
  "eight until four",
  "nine until five",
);

const REVISED_AGAIN = REVISED.replace("in the order of the requests", "by lot each spring");

const handbook = (text = HANDBOOK, slug = "harbour-handbook") => ({
  slug,
  title: "Harbour support handbook",
  fileName: "handbook.md",
  bytes: encode(text),
});

// A fictional outdated CV of the demo seed's person: its Harbor Retail Group dates contradict the
// structured experience, which ended in March 2022.
const OUTDATED_CV = `# Alex Novara — CV (2021 edition)

## Harbor Retail Group

Senior full-stack developer from February 2019 until June 2023.

### What was built

The online store, the warehouse picking tools and a loyalty programme for the forty shops.

## Northwind Freight

Web developer from 2015, on the customer booking portal.
`;

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

async function filesBelow(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    },
  );
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

describe("the lifecycle of supplemental sources", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let privateRoot: string;
  let mediaRoot: string;
  let privateStorage: PrivateStorage;
  const embedder = createFakeEmbedder();

  const open = (
    overrides: {
      embedder?: Embedder;
      privateStorage?: PrivateStorage;
      store?: RetrievalPersistence;
    } = {},
  ): KnowledgeService =>
    createKnowledgeService(
      {
        store: overrides.store ?? persistence.retrieval,
        profile: createProfileService(persistence.profile),
        roadmap: createRoadmapService(persistence.roadmap),
      },
      {
        config,
        embedder: overrides.embedder ?? embedder,
        reranker: createFakeReranker(),
        privateStorage: overrides.privateStorage ?? privateStorage,
      },
    );

  /** The private storage with every deletion failing, as when it is unreachable. */
  const undeletable = (): PrivateStorage => ({
    store: (file) => privateStorage.store(file),
    read: (key) => privateStorage.read(key),
    delete: () => Promise.reject(new Error("The private storage is unavailable.")),
  });

  const keyOf = async (contentHash: string) =>
    (await persistence.retrieval.documentVersion(contentHash))?.storageKey;

  /** Every indexed document chunk the store holds, as the search's candidates read them. */
  const documentChunks = async (query: string) => {
    const [vector] = (await embedder.embed([query], "query")).vectors;
    if (vector === undefined) throw new Error("The fake embedder returned no vector.");
    return persistence.retrieval.nearest({
      vector,
      model: embedder.model,
      modelVersion: embedder.version,
      kinds: ["document"],
      limit: 100,
    });
  };

  const documentSources = async () =>
    (await persistence.retrieval.indexedSources())
      .filter((source) => source.sourceKind === "supplemental")
      .map((source) => source.sourceId)
      .sort();

  const statuses = async (knowledge: KnowledgeService) =>
    Object.fromEntries(
      (await knowledge.listDocuments()).map((version) => [version.contentHash, version.status]),
    );

  const loadDemoSeed = () =>
    createSeedService(persistence, {
      storage: openStorage({
        driver: "local",
        root: mediaRoot,
        environment: "test",
        worktree: "lifecycle",
        publicBaseUrl: "https://media.example.test/files",
      }),
      limits: { maxBytes: 10 * 1024 * 1024, maxImageDimension: 4000 },
      onCleanupFailure: () => undefined,
    }).loadSeed(demoSeedFolder);

  beforeEach(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
    privateRoot = await mkdtemp(join(tmpdir(), "sebela-private-lifecycle-"));
    mediaRoot = await mkdtemp(join(tmpdir(), "sebela-media-lifecycle-"));
    privateStorage = openPrivateStorage({
      driver: "local",
      root: privateRoot,
      environment: "test",
      worktree: "lifecycle",
    });
  }, 60_000);

  afterEach(async () => {
    await persistence.close();
    await database.drop();
    await rm(privateRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it("replaces an approved version atomically: a concurrent search never sees mixed versions", async () => {
    const knowledge = open();
    const first = await knowledge.ingestDocument(handbook());
    await knowledge.approveDocument(first.version.contentHash);
    const revised = await knowledge.ingestDocument(handbook(REVISED));
    const again = await knowledge.ingestDocument(handbook(REVISED_AGAIN));

    const state = { approving: true };
    const approvals = (async () => {
      try {
        await knowledge.approveDocument(revised.version.contentHash);
        await knowledge.approveDocument(again.version.contentHash);
      } finally {
        state.approving = false;
      }
    })();
    const seen: string[][] = [];
    while (state.approving) {
      const chunks = await documentChunks("mooring permit refund berth help desk");
      seen.push([...new Set(chunks.map((chunk) => chunk.version))]);
    }
    await approvals;

    expect(seen.length).toBeGreaterThan(0);
    for (const versions of seen) expect(versions).toHaveLength(1);
    const after = await documentChunks("mooring permit refund berth help desk");
    expect(new Set(after.map((chunk) => chunk.version))).toEqual(
      new Set([again.version.contentHash]),
    );
    expect(after).toHaveLength(again.version.chunkCount);
    expect(await statuses(knowledge)).toEqual({
      [first.version.contentHash]: "superseded",
      [revised.version.contentHash]: "superseded",
      [again.version.contentHash]: "approved",
    });
    // Only the approved version's original is kept; superseded ones are not referenced any more.
    expect(await filesBelow(privateRoot)).toHaveLength(1);
    for (const version of [first.version, revised.version]) {
      expect((await persistence.retrieval.documentVersion(version.contentHash))?.storageKey).toBe(
        null,
      );
    }
  });

  it("keeps the approved version whole when embedding a revision fails", async () => {
    const knowledge = open();
    const first = await knowledge.ingestDocument(handbook());
    await knowledge.approveDocument(first.version.contentHash);
    const revised = await knowledge.ingestDocument(handbook(REVISED));

    const offline = open({ embedder: createFakeEmbedder({ failing: true }) });
    expect((await refusal(offline.approveDocument(revised.version.contentHash))).code).toBe(
      "provider_unavailable",
    );

    const chunks = await documentChunks("mooring permit refund berth help desk");
    expect(chunks).toHaveLength(first.version.chunkCount);
    expect(new Set(chunks.map((chunk) => chunk.version))).toEqual(
      new Set([first.version.contentHash]),
    );
    expect(await statuses(knowledge)).toEqual({
      [first.version.contentHash]: "approved",
      [revised.version.contentHash]: "pending",
    });
    expect(await filesBelow(privateRoot)).toHaveLength(2);
  });

  it("withdraws an approved source from search at once, with the provider failing", async () => {
    const first = await open().ingestDocument(handbook());
    await open().approveDocument(first.version.contentHash);
    const pending = await open().ingestDocument(handbook(REVISED));
    const offline = open({ embedder: createFakeEmbedder({ failing: true }) });

    const withdrawn = await offline.withdrawDocument(first.version.contentHash);

    expect(withdrawn).toMatchObject({
      contentHash: first.version.contentHash,
      status: "withdrawn",
    });
    expect(withdrawn.decidedAt).not.toBeNull();
    expect(await documentSources()).toEqual([]);
    expect(await documentChunks("mooring permit refund")).toEqual([]);
    const search = await open().search({ query: "mooring permit refund", kinds: ["document"] });
    expect(search.status).toBe("no_evidence");
    // The withdrawn original is deleted; the pending revision's stays for its review.
    expect(await filesBelow(privateRoot)).toHaveLength(1);

    expect((await refusal(offline.withdrawDocument(first.version.contentHash))).code).toBe(
      "conflict",
    );
    expect((await refusal(offline.withdrawDocument(pending.version.contentHash))).code).toBe(
      "conflict",
    );
    expect((await refusal(offline.withdrawDocument("f".repeat(64)))).code).toBe("not_found");
    expect((await refusal(offline.approveDocument(first.version.contentHash))).code).toBe(
      "conflict",
    );
  });

  it("deletes a source completely: every version, its chunks and every original", async () => {
    const knowledge = open();
    const first = await knowledge.ingestDocument(handbook());
    await knowledge.approveDocument(first.version.contentHash);
    const revised = await knowledge.ingestDocument(handbook(REVISED));
    await knowledge.approveDocument(revised.version.contentHash);
    await knowledge.ingestDocument(handbook(REVISED_AGAIN));
    const kept = await knowledge.ingestDocument({
      ...handbook(`${HANDBOOK}\nA second, unrelated note.\n`, "harbour-notes"),
      title: "Harbour notes",
    });
    await knowledge.approveDocument(kept.version.contentHash);

    const deleted = await open({ embedder: createFakeEmbedder({ failing: true }) }).deleteDocument(
      "harbour-handbook",
    );

    expect(deleted).toEqual({ sourceId: "document:harbour-handbook", deletedVersions: 3 });
    expect((await knowledge.listDocuments()).map((version) => version.sourceId)).toEqual([
      "document:harbour-notes",
    ]);
    expect(await documentSources()).toEqual(["document:harbour-notes"]);
    expect(
      new Set((await documentChunks("mooring permit")).map((chunk) => chunk.sourceId)),
    ).toEqual(new Set(["document:harbour-notes"]));
    expect(await filesBelow(privateRoot)).toHaveLength(1);

    expect((await refusal(knowledge.deleteDocument("harbour-handbook"))).code).toBe("not_found");
    expect((await refusal(knowledge.deleteDocument("Harbour Handbook"))).code).toBe(
      "validation_failed",
    );
  });

  it("rebuilds the index from approved originals only and keeps every decision", async () => {
    const knowledge = open();
    const approve = async (text: string, slug: string) => {
      const { version } = await knowledge.ingestDocument({ ...handbook(text, slug), title: slug });
      await knowledge.approveDocument(version.contentHash);
      return version;
    };
    const approved = await approve(HANDBOOK, "approved-handbook");
    const gone = await approve(`${HANDBOOK}\nA lost note.\n`, "lost-handbook");
    const withdrawn = await approve(REVISED, "withdrawn-handbook");
    await knowledge.withdrawDocument(withdrawn.contentHash);
    const rejected = (await knowledge.ingestDocument(handbook(REVISED_AGAIN, "rejected-handbook")))
      .version;
    await knowledge.rejectDocument(rejected.contentHash);
    const pending = (
      await knowledge.ingestDocument(handbook(`${REVISED_AGAIN}\nA draft.\n`, "pending-handbook"))
    ).version;
    const before = await statuses(knowledge);

    // The index is lost, and one approved original with it.
    await persistence.retrieval.removeSourcesExcept("supplemental", []);
    await persistence.retrieval.removeSourcesExcept("portfolio", []);
    const lostKey = (await persistence.retrieval.documentVersion(gone.contentHash))?.storageKey;
    if (lostKey === null || lostKey === undefined) throw new Error("The original has no key.");
    await privateStorage.delete(lostKey);

    const rebuilt = await knowledge.rebuildIndex();

    expect(rebuilt.documents).toMatchObject({
      restored: 1,
      missing: 1,
      missingVersions: [gone.contentHash],
      conflicts: 0,
      originalsLeft: 0,
    });
    expect(rebuilt.documents.embedded).toBe(0);
    expect(await documentSources()).toEqual(["document:approved-handbook"]);
    const chunks = await documentChunks("mooring permit refund berth");
    expect(new Set(chunks.map((chunk) => chunk.version))).toEqual(new Set([approved.contentHash]));
    expect(await statuses(knowledge)).toEqual(before);
    expect(before[pending.contentHash]).toBe("pending");
    expect(before[rejected.contentHash]).toBe("rejected");
    expect(before[withdrawn.contentHash]).toBe("withdrawn");
  });

  it("keeps a withdrawn original referenced while private storage fails, so withdraw can finish it", async () => {
    const first = await open().ingestDocument(handbook());
    await open().approveDocument(first.version.contentHash);

    const failed = await refusal(
      open({ privateStorage: undeletable() }).withdrawDocument(first.version.contentHash),
    );

    expect(failed.code).toBe("provider_unavailable");
    expect(failed.message).toContain("withdraw");
    expect(await documentSources()).toEqual([]);
    expect(await statuses(open())).toEqual({ [first.version.contentHash]: "withdrawn" });
    expect(await filesBelow(privateRoot)).toHaveLength(1);
    expect(await keyOf(first.version.contentHash)).not.toBeNull();

    const finished = await open().withdrawDocument(first.version.contentHash);
    expect(finished.status).toBe("withdrawn");
    expect(await filesBelow(privateRoot)).toEqual([]);
    expect(await keyOf(first.version.contentHash)).toBeNull();
    expect((await refusal(open().withdrawDocument(first.version.contentHash))).code).toBe(
      "conflict",
    );
  });

  it("deletes nothing of a source while private storage fails, so the delete can be repeated", async () => {
    const knowledge = open();
    const first = await knowledge.ingestDocument(handbook());
    await knowledge.approveDocument(first.version.contentHash);
    await knowledge.ingestDocument(handbook(REVISED));

    const failed = await refusal(
      open({ privateStorage: undeletable() }).deleteDocument("harbour-handbook"),
    );

    expect(failed.code).toBe("provider_unavailable");
    expect(failed.message).toContain("delete");
    expect(await knowledge.listDocuments()).toHaveLength(2);
    expect(await filesBelow(privateRoot)).toHaveLength(2);

    expect(await knowledge.deleteDocument("harbour-handbook")).toEqual({
      sourceId: "document:harbour-handbook",
      deletedVersions: 2,
    });
    expect(await knowledge.listDocuments()).toEqual([]);
    expect(await documentSources()).toEqual([]);
    expect(await filesBelow(privateRoot)).toEqual([]);
  });

  it("approves a revision while private storage fails and deletes the superseded original at the next rebuild", async () => {
    const first = await open().ingestDocument(handbook());
    expect((await open().approveDocument(first.version.contentHash)).originalsLeft).toBe(0);
    const revised = await open().ingestDocument(handbook(REVISED));

    const approval = await open({ privateStorage: undeletable() }).approveDocument(
      revised.version.contentHash,
    );

    expect(approval.version.status).toBe("approved");
    expect(approval.originalsLeft).toBe(1);
    expect(await filesBelow(privateRoot)).toHaveLength(2);
    expect(await keyOf(first.version.contentHash)).not.toBeNull();

    const rebuilt = await open().rebuildIndex();
    expect(rebuilt.documents).toMatchObject({ restored: 1, originalsLeft: 0 });
    expect(await filesBelow(privateRoot)).toHaveLength(1);
    expect(await keyOf(first.version.contentHash)).toBeNull();
    expect(await keyOf(revised.version.contentHash)).not.toBeNull();
  });

  it("keeps a document another process approves while a rebuild runs", async () => {
    const knowledge = open();
    const first = await knowledge.ingestDocument(handbook());
    await knowledge.approveDocument(first.version.contentHash);
    const late = await knowledge.ingestDocument({
      ...handbook(`${HANDBOOK}\nA late note.\n`, "late-handbook"),
      title: "Late handbook",
    });
    const retrieval = persistence.retrieval;
    // The other process approves just before the rebuild unpublishes what has no approved version.
    const racing: RetrievalPersistence = {
      ...retrieval,
      unpublishDocumentSources: async (unpublished) => {
        await knowledge.approveDocument(late.version.contentHash);
        return retrieval.unpublishDocumentSources(unpublished);
      },
    };

    await open({ store: racing }).rebuildIndex();

    expect(await documentSources()).toEqual([
      "document:harbour-handbook",
      "document:late-handbook",
    ]);
    expect((await statuses(knowledge))[late.version.contentHash]).toBe("approved");
  });

  it("records a conflict with the API facts, shows it and leaves its chunk out of search", async () => {
    await loadDemoSeed();
    const knowledge = open();
    await knowledge.reindexPortfolio();
    const { version } = await knowledge.ingestDocument({
      slug: "harbor-retail-cv-2021",
      title: "Outdated CV (2021 edition)",
      fileName: "cv-2021.md",
      bytes: encode(OUTDATED_CV),
    });

    const approval = await knowledge.approveDocument(version.contentHash);

    const conflict = {
      kind: "date",
      sourceId: "portfolio:experience:harbor-retail-senior-developer",
      claim: "2023",
      fact: "2019-02-01 to 2022-03-31",
    };
    expect(approval.version.conflicts).toEqual([expect.objectContaining(conflict)]);
    const [recorded] = approval.version.conflicts;
    const preview = await knowledge.showDocument(version.contentHash);
    expect(preview.version.conflicts).toEqual(approval.version.conflicts);
    expect((await knowledge.listDocuments())[0]?.conflicts).toEqual(approval.version.conflicts);
    const conflicting = preview.chunks.find((chunk) => chunk.ordinal === recorded?.chunkOrdinal);
    expect(conflicting?.text).toContain("June 2023");

    const indexed = await documentChunks("senior full-stack developer harbor retail june 2023");
    expect(indexed).toHaveLength(version.chunkCount - 1);
    expect(indexed.some((chunk) => chunk.text.includes("2023"))).toBe(false);
    const found = await knowledge.search({
      query: "warehouse picking tools loyalty programme",
      kinds: ["document"],
    });
    expect(found.passages[0]?.text).toContain("loyalty programme");

    // A rebuild checks the approved original again and still leaves the chunk out.
    await persistence.retrieval.removeSourcesExcept("supplemental", []);
    const rebuilt = await knowledge.rebuildIndex();
    expect(rebuilt.documents).toMatchObject({ restored: 1, missing: 0, conflicts: 1 });
    expect(rebuilt.portfolio.sources).toBeGreaterThan(20);
    const restored = await documentChunks("senior full-stack developer harbor retail june 2023");
    expect(restored).toHaveLength(version.chunkCount - 1);
    expect(restored.some((chunk) => chunk.text.includes("2023"))).toBe(false);
    expect((await knowledge.showDocument(version.contentHash)).version.conflicts).toEqual(
      approval.version.conflicts,
    );
  });
});
