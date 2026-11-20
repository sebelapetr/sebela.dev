// The knowledge maintenance command over a real database with the fake embedder: reindexing,
// the evals' candidate pools and the month's recorded spend, printed as JSON.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { demoSeedFolder, type RetrievalConfig } from "@sebela/services";
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

    for (const args of [[], ["unknown"], ["candidates"], ["usage", "extra"]]) {
      const { code, err } = await run(args);
      expect(code, args.join(" ")).toBe(2);
      expect(err()).toMatch(/^Usage: knowledge/);
    }
  });
});
