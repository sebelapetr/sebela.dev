import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderUnavailableError } from "../ports/index.js";

import {
  createFakeEmbedder,
  createFakeReranker,
  createQueryCachingEmbedder,
  createVoyageEmbedder,
  createVoyageReranker,
} from "./index.js";

const KEY = "test-voyage-key-not-real";

describe("the fake embedder", () => {
  it("is deterministic, normalized and similar for texts sharing words", async () => {
    const embedder = createFakeEmbedder();
    expect(embedder.dimension).toBe(1024);
    const { vectors, tokens } = await embedder.embed(
      ["Hybrid search over the archive", "hybrid SEARCH over the archive", "Tax deadlines"],
      "document",
    );
    expect(tokens).toBe(12);
    const [a, b, c] = vectors;
    if (a === undefined || b === undefined || c === undefined) throw new Error("three vectors");
    expect(a).toEqual(b);
    expect(Math.hypot(...a)).toBeCloseTo(1, 10);
    const dot = (x: readonly number[], y: readonly number[]) =>
      x.reduce((sum, value, index) => sum + value * (y[index] ?? 0), 0);
    expect(dot(a, c)).toBeLessThan(dot(a, b));
    expect(embedder.calls).toBe(1);
  });

  it("treats accented and unaccented words alike", async () => {
    const embedder = createFakeEmbedder();
    const { vectors } = await embedder.embed(["vyhledávání", "vyhledavani"], "query");
    expect(vectors[0]).toEqual(vectors[1]);
  });

  it("fails like an unavailable provider when asked to", async () => {
    await expect(
      createFakeEmbedder({ failing: true }).embed(["x"], "query"),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});

function voyage(fetch: typeof globalThis.fetch, timeoutMs = 1000) {
  return createVoyageEmbedder({ apiKey: KEY, model: "voyage-4", dimension: 3, timeoutMs, fetch });
}

const answer = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("the Voyage embedder", () => {
  it("sends the texts with the input type and returns vectors in order with billed tokens", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const embedder = voyage((input, init) => {
      requests.push({ url: input instanceof Request ? input.url : input.toString(), init });
      return answer({
        data: [
          { index: 1, embedding: [0, 1, 0] },
          { index: 0, embedding: [1, 0, 0] },
        ],
        usage: { total_tokens: 7 },
      });
    });
    const result = await embedder.embed(["first", "second"], "document");
    expect(result).toEqual({
      vectors: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      tokens: 7,
    });
    const [request] = requests;
    expect(request?.url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(request?.init?.method).toBe("POST");
    expect(new Headers(request?.init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(request?.init?.body as string)).toEqual({
      input: ["first", "second"],
      model: "voyage-4",
      input_type: "document",
      output_dimension: 3,
    });
  });

  it.each([
    ["an error status", () => answer({ detail: "unauthorized" }, 401)],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
    ["a malformed body", () => answer({ data: "nope" })],
    [
      "a vector of another dimension",
      () => answer({ data: [{ index: 0, embedding: [1, 0] }], usage: { total_tokens: 1 } }),
    ],
    ["a missing vector", () => answer({ data: [], usage: { total_tokens: 1 } })],
  ])("reports %s as an unavailable provider without the key", async (_label, fetch) => {
    const failure = await voyage(fetch as typeof globalThis.fetch)
      .embed(["first"], "query")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailableError);
    expect((failure as Error).message).not.toContain(KEY);
  });

  describe("when rate limited", () => {
    const success = () =>
      answer({ data: [{ index: 0, embedding: [1, 0, 0] }], usage: { total_tokens: 1 } });
    const limited = (retryAfter?: string) =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "rate limited" }), {
          status: 429,
          headers: retryAfter === undefined ? {} : { "retry-after": retryAfter },
        }),
      );
    function limitedVoyage(
      answers: (() => Promise<Response>)[],
      retry: { retries: number; maxRetryWaitMs: number },
    ) {
      const waits: number[] = [];
      let calls = 0;
      const embedder = createVoyageEmbedder({
        apiKey: KEY,
        model: "voyage-4",
        dimension: 3,
        timeoutMs: 1000,
        ...retry,
        fetch: () => {
          const next = answers[Math.min(calls, answers.length - 1)];
          calls += 1;
          if (next === undefined) throw new Error("no answer");
          return next();
        },
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
        random: () => 1,
      });
      return { embedder, waits, calls: () => calls };
    }

    it("waits as long as Retry-After asks and tries again", async () => {
      const { embedder, waits, calls } = limitedVoyage([() => limited("2"), success], {
        retries: 3,
        maxRetryWaitMs: 5000,
      });
      const result = await embedder.embed(["first"], "query");
      expect(result.vectors).toEqual([[1, 0, 0]]);
      expect(waits).toEqual([2000]);
      expect(calls()).toBe(2);
    });

    it("backs off exponentially without Retry-After and gives up after the allowed retries", async () => {
      const { embedder, waits, calls } = limitedVoyage([() => limited()], {
        retries: 3,
        maxRetryWaitMs: 3000,
      });
      const failure = await embedder.embed(["first"], "query").catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ProviderUnavailableError);
      expect((failure as ProviderUnavailableError).status).toBe(429);
      expect((failure as Error).message).toContain("429");
      expect((failure as Error).message).not.toContain(KEY);
      expect(waits).toEqual([1000, 2000, 3000]);
      expect(calls()).toBe(4);
    });

    it("gives up at once when Retry-After asks for longer than the longest allowed wait", async () => {
      const { embedder, waits, calls } = limitedVoyage([() => limited("60"), success], {
        retries: 3,
        maxRetryWaitMs: 5000,
      });
      const failure = await embedder.embed(["first"], "query").catch((error: unknown) => error);
      expect((failure as ProviderUnavailableError).status).toBe(429);
      expect(waits).toEqual([]);
      expect(calls()).toBe(1);
    });

    it("does not retry without allowed retries, nor any other error status", async () => {
      for (const [status, retries] of [
        [429, 0],
        [401, 3],
        [500, 3],
      ] as const) {
        const { embedder, waits, calls } = limitedVoyage(
          [() => answer({ detail: "no" }, status), success],
          { retries, maxRetryWaitMs: 5000 },
        );
        const failure = await embedder.embed(["first"], "query").catch((error: unknown) => error);
        expect((failure as ProviderUnavailableError).status, String(status)).toBe(status);
        expect(waits).toEqual([]);
        expect(calls()).toBe(1);
      }
    });
  });

  it("gives up after the timeout", async () => {
    const embedder = voyage(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      20,
    );
    await expect(embedder.embed(["first"], "query")).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });
});

describe("the fake reranker", () => {
  it("scores each document by the share of the query's words it holds, in order", async () => {
    const reranker = createFakeReranker();
    const { scores, tokens } = await reranker.rerank("Hybrid search reranker", [
      "a reranker over HYBRID search",
      "hybrid notes",
      "tax deadlines",
    ]);
    expect(scores[0]).toBe(1);
    expect(scores[1]).toBeCloseTo(1 / 3, 10);
    expect(scores[2]).toBe(0);
    expect(tokens).toBe(3 + 5 + 2 + 2);
    expect(reranker.calls).toBe(1);
  });

  it("fails like an unavailable provider when asked to", async () => {
    const failure = await createFakeReranker({ failing: true, failureStatus: 503 })
      .rerank("x", ["y"])
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailableError);
    expect((failure as ProviderUnavailableError).status).toBe(503);
  });
});

describe("the Voyage reranker", () => {
  function reranker(
    fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
    retry: {
      retries?: number;
      maxRetryWaitMs?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
    timeoutMs = 1000,
  ) {
    return createVoyageReranker({
      apiKey: KEY,
      model: "rerank-3",
      timeoutMs,
      fetch,
      random: () => 1,
      ...retry,
    });
  }

  it("sends the query and every document and returns the scores by document index", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const voyageReranker = reranker((input, init) => {
      requests.push({ url: input instanceof Request ? input.url : input.toString(), init });
      return answer({
        data: [
          { index: 2, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.4 },
          { index: 1, relevance_score: 0.1 },
        ],
        usage: { total_tokens: 42 },
      });
    });
    expect(voyageReranker.model).toBe("rerank-3");
    const result = await voyageReranker.rerank("which archive?", ["first", "second", "third"]);
    expect(result).toEqual({ scores: [0.4, 0.1, 0.9], tokens: 42 });
    const [request] = requests;
    expect(request?.url).toBe("https://api.voyageai.com/v1/rerank");
    expect(request?.init?.method).toBe("POST");
    expect(new Headers(request?.init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(request?.init?.body as string)).toEqual({
      query: "which archive?",
      documents: ["first", "second", "third"],
      model: "rerank-3",
      truncation: true,
    });
  });

  it("returns no scores for no documents without calling the provider", async () => {
    let calls = 0;
    const voyageReranker = reranker(() => {
      calls += 1;
      return answer({ data: [], usage: { total_tokens: 0 } });
    });
    await expect(voyageReranker.rerank("q", [])).resolves.toEqual({ scores: [], tokens: 0 });
    expect(calls).toBe(0);
  });

  it.each([
    ["an error status", () => answer({ detail: "unauthorized" }, 401)],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
    ["a malformed body", () => answer({ data: "nope" })],
    [
      "a score that is not a number",
      () => answer({ data: [{ index: 0, relevance_score: "high" }], usage: { total_tokens: 1 } }),
    ],
    ["a missing score", () => answer({ data: [], usage: { total_tokens: 1 } })],
  ])("reports %s as an unavailable provider without the key", async (_label, fetch) => {
    const failure = await reranker(fetch)
      .rerank("q", ["first"])
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderUnavailableError);
    expect((failure as Error).message).not.toContain(KEY);
  });

  it("honours Retry-After on a rate-limited call and gives up after the allowed retries", async () => {
    const waits: number[] = [];
    const sleep = (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    };
    let calls = 0;
    const limitedThenFine = reranker(
      () => {
        calls += 1;
        return calls === 1
          ? Promise.resolve(new Response("{}", { status: 429, headers: { "retry-after": "3" } }))
          : answer({ data: [{ index: 0, relevance_score: 0.5 }], usage: { total_tokens: 2 } });
      },
      { retries: 2, maxRetryWaitMs: 5000, sleep },
    );
    await expect(limitedThenFine.rerank("q", ["first"])).resolves.toEqual({
      scores: [0.5],
      tokens: 2,
    });
    expect(waits).toEqual([3000]);

    waits.length = 0;
    const alwaysLimited = reranker(() => Promise.resolve(new Response("{}", { status: 429 })), {
      retries: 2,
      maxRetryWaitMs: 1500,
      sleep,
    });
    const failure = await alwaysLimited.rerank("q", ["first"]).catch((error: unknown) => error);
    expect((failure as ProviderUnavailableError).status).toBe(429);
    expect(waits).toEqual([1000, 1500]);
  });

  it("gives up after the timeout", async () => {
    const voyageReranker = reranker(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      {},
      20,
    );
    await expect(voyageReranker.rerank("q", ["first"])).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });
});

describe("the query-caching embedder", () => {
  let folder: string;
  let file: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "sebela-query-cache-"));
    file = join(folder, "nested", "queries.json");
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("embeds each query once across instances and bills only what it sent", async () => {
    const provider = createFakeEmbedder();
    const first = createQueryCachingEmbedder(provider, file);
    expect(first).toMatchObject({ model: provider.model, version: "1", dimension: 1024 });

    const fresh = await first.embed(["golden sets", "refund policy"], "query");
    expect(fresh.tokens).toBe(4);
    expect(provider.calls).toBe(1);

    const second = createQueryCachingEmbedder(provider, file);
    const mixed = await second.embed(
      ["refund policy", "loyalty programme", "golden sets"],
      "query",
    );
    expect(provider.calls).toBe(2);
    expect(mixed.tokens).toBe(2);
    expect(mixed.vectors[0]).toEqual(fresh.vectors[1]);
    expect(mixed.vectors[2]).toEqual(fresh.vectors[0]);

    const cached = await second.embed(["golden sets"], "query");
    expect(cached).toEqual({ vectors: [fresh.vectors[0]], tokens: 0 });
    expect(provider.calls).toBe(2);
    expect(await readFile(file, "utf8")).not.toContain("golden sets");
  });

  it("never caches documents and keeps models and versions apart", async () => {
    const provider = createFakeEmbedder();
    const cached = createQueryCachingEmbedder(provider, file);
    await cached.embed(["harbour handbook"], "document");
    await cached.embed(["harbour handbook"], "document");
    expect(provider.calls).toBe(2);

    await cached.embed(["harbour handbook"], "query");
    const revised = createQueryCachingEmbedder(
      { ...provider, embed: (texts, input) => provider.embed(texts, input), version: "2" },
      file,
    );
    await revised.embed(["harbour handbook"], "query");
    expect(provider.calls).toBe(4);
  });

  it("passes a provider failure through and caches nothing", async () => {
    const cached = createQueryCachingEmbedder(createFakeEmbedder({ failing: true }), file);
    await expect(cached.embed(["golden sets"], "query")).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    await expect(readFile(file, "utf8")).rejects.toThrow(/ENOENT/);
  });
});
