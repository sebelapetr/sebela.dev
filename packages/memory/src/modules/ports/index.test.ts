import { describe, expect, it } from "vitest";

import { readRetrievalConfig } from "./index.js";

const complete = {
  RETRIEVAL_EMBEDDING_MODEL: "voyage-4",
  RETRIEVAL_EMBEDDING_PRICE_PER_MILLION_TOKENS_USD: "0.06",
  RETRIEVAL_EMBEDDING_BATCH_SIZE: "64",
  RETRIEVAL_PROVIDER_TIMEOUT_MS: "10000",
  RETRIEVAL_PROVIDER_RETRIES: "2",
  RETRIEVAL_PROVIDER_MAX_RETRY_WAIT_MS: "2000",
  RETRIEVAL_MONTHLY_CEILING_USD: "1",
  RETRIEVAL_CANDIDATE_POOL: "30",
  RETRIEVAL_FINAL_PASSAGES: "6",
  RETRIEVAL_RELEVANCE_FLOOR: "0.3",
};

describe("readRetrievalConfig", () => {
  it("reads every setting", () => {
    expect(readRetrievalConfig(complete)).toEqual({
      embeddingModel: "voyage-4",
      embeddingPricePerMillionTokensUsd: 0.06,
      embeddingBatchSize: 64,
      providerTimeoutMs: 10000,
      providerRetries: 2,
      providerMaxRetryWaitMs: 2000,
      monthlyCeilingUsd: 1,
      candidatePool: 30,
      finalPassages: 6,
      relevanceFloor: 0.3,
    });
  });

  it("is absent when no setting is given", () => {
    expect(readRetrievalConfig({ MEDIA_MAX_BYTES: "10485760" })).toBeNull();
  });

  it("names every missing or invalid setting", () => {
    const partial = {
      ...complete,
      RETRIEVAL_CANDIDATE_POOL: undefined,
      RETRIEVAL_FINAL_PASSAGES: "0",
      RETRIEVAL_RELEVANCE_FLOOR: "1.5",
      RETRIEVAL_MONTHLY_CEILING_USD: "-1",
      RETRIEVAL_PROVIDER_RETRIES: "11",
      RETRIEVAL_PROVIDER_MAX_RETRY_WAIT_MS: undefined,
    };
    for (const name of [
      "RETRIEVAL_CANDIDATE_POOL",
      "RETRIEVAL_FINAL_PASSAGES",
      "RETRIEVAL_RELEVANCE_FLOOR",
      "RETRIEVAL_MONTHLY_CEILING_USD",
      "RETRIEVAL_PROVIDER_RETRIES",
      "RETRIEVAL_PROVIDER_MAX_RETRY_WAIT_MS",
    ]) {
      expect(() => readRetrievalConfig(partial)).toThrow(name);
    }
  });

  it("refuses more final passages than the contract allows or than the pool holds", () => {
    expect(() => readRetrievalConfig({ ...complete, RETRIEVAL_FINAL_PASSAGES: "9" })).toThrow(
      /RETRIEVAL_FINAL_PASSAGES/,
    );
    expect(() =>
      readRetrievalConfig({
        ...complete,
        RETRIEVAL_CANDIDATE_POOL: "4",
        RETRIEVAL_FINAL_PASSAGES: "6",
      }),
    ).toThrow(/RETRIEVAL_CANDIDATE_POOL/);
  });
});
