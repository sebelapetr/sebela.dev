import { describe, expect, it } from "vitest";

import { ProviderUnavailableError } from "../ports/index.js";

import { createFakeEmbedder, createVoyageEmbedder } from "./index.js";

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
