// The knowledge maintenance command over a real database with the fake embedder: reindexing,
// the evals' candidate pools and the month's recorded spend, printed as JSON.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  demoSeedFolder,
  openPrivateStorage,
  type PrivateStorage,
  type RetrievalConfig,
} from "@sebela/services";
import { createFakeEmbedder } from "@sebela/services/testing";

import { openTestBackend, type TestBackend } from "../test-support.js";
import { runKnowledgeCommand } from "./knowledge.js";

const config: RetrievalConfig = {
  embeddingModel: "fake",
  embeddingPricePerMillionTokensUsd: 0.06,
  embeddingBatchSize: 32,
  providerTimeoutMs: 1000,
  providerRetries: 0,
  providerMaxRetryWaitMs: 0,
  monthlyCeilingUsd: 1,
  candidatePool: 20,
  finalPassages: 6,
  relevanceFloor: 0.1,
};

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    output: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) },
    json: () => JSON.parse(out.join("")) as unknown,
    err: () => err.join(""),
  };
}

describe("the knowledge command", () => {
  let backend: TestBackend;
  let failing: TestBackend;
  let folder: string;

  beforeAll(async () => {
    [backend, failing] = await Promise.all([
      openTestBackend({ retrieval: { config, embedder: createFakeEmbedder() } }),
      openTestBackend({
        retrieval: { config, embedder: createFakeEmbedder({ failing: true, failureStatus: 429 }) },
      }),
    ]);
    await Promise.all([
      backend.services.seed.loadSeed(demoSeedFolder),
      failing.services.seed.loadSeed(demoSeedFolder),
    ]);
    folder = await mkdtemp(join(tmpdir(), "sebela-knowledge-"));
  });

  afterAll(async () => {
    await Promise.all([backend.close(), failing.close()]);
    await rm(folder, { recursive: true, force: true });
  });

  const run = async (args: string[], on = backend) => {
    const captured = capture();
    const code = await runKnowledgeCommand(args, on.services, captured.output, folder);
    return { code, ...captured };
  };

  it("reindexes the portfolio and embeds nothing the second time", async () => {
    const first = await run(["reindex"]);
    expect(first.code).toBe(0);
    expect(first.json()).toMatchObject({ embedded: expect.any(Number) as number, reused: 0 });

    const second = await run(["reindex"]);
    expect(second.code).toBe(0);
    expect(second.json()).toMatchObject({ updated: 0, embedded: 0, tokens: 0, costUsd: 0 });
  });

  it("works through queued work on demand and reports what is still queued", async () => {
    await backend.services.knowledge.schedule([
      { domain: "service", record: "evaluation-setup", action: "updated" },
    ]);
    const queued = await run(["pending"]);
    expect(queued.code).toBe(0);
    expect(queued.json()).toEqual({ pending: 1, failed: 0 });

    const processed = await run(["reindex"]);
    expect(processed.code).toBe(0);
    expect(processed.json()).toMatchObject({ completed: 1, remaining: { pending: 0, failed: 0 } });
    expect((await run(["pending"])).json()).toEqual({ pending: 0, failed: 0 });
  });

  it("rebuilds the portfolio from the embedding cache without embedding again", async () => {
    const { code, json } = await run(["rebuild"]);
    expect(code).toBe(0);
    const report = json() as { sources: number; updated: number; embedded: number };
    expect(report.updated).toBe(report.sources);
    expect(report.embedded).toBe(0);
  });

  it("prints each question's candidate pool by its ID", async () => {
    const questions = join(folder, "questions.json");
    await writeFile(
      questions,
      JSON.stringify([
        { id: "q-context", query: "context window tokens" },
        { id: "q-kinds", query: "context window tokens", kinds: ["glossary_term"] },
      ]),
    );
    const { code, json } = await run(["candidates", "questions.json"]);
    expect(code).toBe(0);
    const { pools } = json() as { pools: Record<string, string[]> };
    expect(Object.keys(pools)).toEqual(["q-context", "q-kinds"]);
    expect(pools["q-context"]?.[0]).toBe("portfolio:glossary_term:context-window");
  });

  it("prints the month's recorded spend by operation", async () => {
    const { code, json } = await run(["usage"]);
    expect(code).toBe(0);
    const usage = json() as { tokens: number; costUsd: number; byOperation: object };
    expect(usage.tokens).toBeGreaterThan(0);
    expect(usage.byOperation).toHaveProperty("index");
    expect(usage.byOperation).toHaveProperty("candidates");
  });

  it("reports a failing provider and bad usage without printing JSON", async () => {
    const unavailable = await run(["reindex"], failing);
    expect(unavailable.code).toBe(1);
    expect(unavailable.err()).toMatch(/unavailable/i);
    // The status class tells a rate limit from an outage; nothing else of the answer is printed.
    expect(unavailable.err()).toContain("HTTP 429 (4xx, rate limited)");

    for (const args of [
      [],
      ["unknown"],
      ["candidates"],
      ["usage", "extra"],
      ["rebuild", "x"],
      ["pending", "x"],
    ]) {
      const { code, err } = await run(args);
      expect(code, args.join(" ")).toBe(2);
      expect(err()).toMatch(/^Usage: knowledge/);
    }
  });
});

describe("the knowledge command's supplemental documents", () => {
  let backend: TestBackend;
  let folder: string;
  let privateRoot: string;
  let privateStorage: PrivateStorage;

  // A fictional document; the e-mail address of the leaky revision is put together at run time.
  const handbook = [
    "# Studio handbook",
    "",
    "## Opening hours",
    "",
    "The fictional studio opens at nine and closes at five on weekdays.",
    "",
    "## Refunds",
    "",
    "A refund is paid within fourteen days of a written request.",
    "",
  ].join("\n");
  const leaky = `${handbook}\nWrite to ${["front-desk", "studio.example"].join("@")} for help.\n`;

  beforeAll(async () => {
    privateRoot = await mkdtemp(join(tmpdir(), "sebela-knowledge-private-"));
    privateStorage = openPrivateStorage({
      driver: "local",
      root: privateRoot,
      environment: "test",
      worktree: null,
    });
    backend = await openTestBackend({
      retrieval: { config, embedder: createFakeEmbedder(), privateStorage },
    });
    folder = await mkdtemp(join(tmpdir(), "sebela-knowledge-documents-"));
    await writeFile(join(folder, "handbook-FINAL.md"), handbook);
    await writeFile(join(folder, "leaky.md"), leaky);
    await writeFile(join(folder, "other.txt"), "Another fictional note about parking.\n");
  });

  afterAll(async () => {
    await backend.close();
    await rm(folder, { recursive: true, force: true });
    await rm(privateRoot, { recursive: true, force: true });
  });

  const run = async (args: string[]) => {
    const captured = capture();
    const code = await runKnowledgeCommand(args, backend.services, captured.output, folder);
    return { code, ...captured };
  };

  interface Version {
    contentHash: string;
    status: string;
    title: string;
  }

  it("ingests, lists, shows and approves a document by its exact hash", async () => {
    const ingest = [
      "ingest",
      "handbook-FINAL.md",
      "--slug",
      "studio-handbook",
      "--title",
      "Studio handbook",
    ];
    const first = await run(ingest);
    expect(first.code).toBe(0);
    const { created, version } = first.json() as { created: boolean; version: Version };
    expect(created).toBe(true);
    expect(version).toMatchObject({ status: "pending", title: "Studio handbook" });
    expect(version).not.toHaveProperty("storageKey");

    const again = await run(ingest);
    expect(again.code).toBe(0);
    expect(again.json()).toMatchObject({ created: false, version: { status: "pending" } });

    const listed = await run(["list"]);
    expect(listed.code).toBe(0);
    expect((listed.json() as { documents: Version[] }).documents.map((d) => d.contentHash)).toEqual(
      [version.contentHash],
    );

    const shown = await run(["show", version.contentHash]);
    expect(shown.code).toBe(0);
    const preview = shown.json() as { text: string; chunks: unknown[]; findings: unknown[] };
    expect(preview.text).toContain("closes at five");
    expect(preview.chunks.length).toBeGreaterThan(0);
    expect(preview.findings).toEqual([]);

    const approved = await run(["approve", version.contentHash]);
    expect(approved.code).toBe(0);
    expect(approved.json()).toMatchObject({
      version: { status: "approved" },
      report: { embedded: expect.any(Number) as number },
    });
    const { passages } = await backend.services.knowledge.search({ query: "refund request" });
    const supplemental = passages.filter((p) => p.sourceKind === "supplemental");
    expect(supplemental[0]).toMatchObject({ title: "Studio handbook", path: null });
    expect(JSON.stringify(supplemental)).not.toContain("FINAL");
  });

  it("blocks a document with findings and prints their kinds and lines only", async () => {
    const blocked = await run(["ingest", "leaky.md", "--slug", "leaky", "--title", "Leaky note"]);
    expect(blocked.code).toBe(1);
    expect(blocked.err()).toMatch(/sanitized revision/);
    const { version } = blocked.json() as { version: Version & { findings: unknown[] } };
    expect(version.status).toBe("blocked");
    expect(version.findings).toEqual([{ kind: "email", line: expect.any(Number) as number }]);
    expect(blocked.err() + JSON.stringify(blocked.json())).not.toContain("front-desk");

    const approval = await run(["approve", version.contentHash]);
    expect(approval.code).toBe(1);
    expect(approval.err()).toMatch(/sanitized revision/);
  });

  it("rejects a pending document and refuses unknown hashes and unreadable files", async () => {
    const ingested = await run(["ingest", "other.txt", "--slug", "parking", "--title", "Parking"]);
    const { version } = ingested.json() as { version: Version };
    const rejected = await run(["reject", version.contentHash]);
    expect(rejected.code).toBe(0);
    expect(rejected.json()).toMatchObject({ status: "rejected" });

    const unknown = await run(["show", "0".repeat(64)]);
    expect(unknown.code).toBe(1);
    expect(unknown.err()).toMatch(/not found|no document/i);

    const missing = await run(["ingest", "missing.md", "--slug", "missing", "--title", "Missing"]);
    expect(missing.code).toBe(1);
    expect(missing.err()).toContain("ENOENT");
    expect(missing.err()).not.toContain(folder);
  });

  it("prints the usage for incomplete document commands", async () => {
    for (const args of [
      ["ingest"],
      ["ingest", "other.txt"],
      ["ingest", "other.txt", "--slug", "parking"],
      ["ingest", "other.txt", "--slug", "parking", "--title"],
      ["ingest", "other.txt", "--slug", "parking", "--title", "Parking", "--extra", "x"],
      ["list", "x"],
      ["show"],
      ["approve"],
      ["reject", "a", "b"],
    ]) {
      const { code, err } = await run(args);
      expect(code, args.join(" ")).toBe(2);
      expect(err()).toMatch(/^Usage: knowledge/);
    }
  });
});
