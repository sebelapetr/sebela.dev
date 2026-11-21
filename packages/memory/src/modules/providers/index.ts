// Providers behind the `Embedder` and `Reranker` ports: the Voyage AI adapters for deployment and
// paid evals, and deterministic fakes for every other test. Nothing outside this module knows a
// provider's wire format.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  ProviderUnavailableError,
  type Embedder,
  type Embedding,
  type EmbeddingInput,
  type Reranker,
} from "../ports/index.js";

/** The fake embedder's model name; the store keeps its vectors apart from any real model's. */
export const fakeEmbeddingModel = "fake-hashed-words";

export interface FakeEmbedderOptions {
  /** Vector length; the retrieval schema stores 1024. */
  readonly dimension?: number;
  /** Fails every call with `ProviderUnavailableError`, as a provider outage would. */
  readonly failing?: boolean;
  /** The HTTP status a failing call reports, as a provider answering one would. */
  readonly failureStatus?: number;
}

/**
 * A deterministic embedder for tests: a normalized hashed bag of lower-cased, unaccented words, so
 * texts sharing words are similar and the same text always has the same vector. It bills one token
 * per word and counts its calls in `calls`.
 */
export function createFakeEmbedder(
  options: FakeEmbedderOptions = {},
): Embedder & { readonly calls: number } {
  const dimension = options.dimension ?? 1024;
  let calls = 0;
  const vector = (text: string) => {
    const values = new Array<number>(dimension).fill(0);
    for (const word of words(text)) {
      const hash = fnv1a(word);
      values[hash % dimension] = (values[hash % dimension] ?? 0) + 1;
    }
    const length = Math.hypot(...values);
    return length === 0 ? values : values.map((value) => value / length);
  };
  return {
    model: fakeEmbeddingModel,
    version: "1",
    dimension,
    get calls() {
      return calls;
    },
    embed(texts) {
      calls += 1;
      if (options.failing === true) {
        return Promise.reject(
          new ProviderUnavailableError("The fake provider is failing.", options.failureStatus),
        );
      }
      const tokens = texts.reduce((sum, text) => sum + words(text).length, 0);
      return Promise.resolve({ vectors: texts.map(vector), tokens });
    },
  };
}

/** The fake reranker's model name. */
export const fakeRerankModel = "fake-word-overlap";

export interface FakeRerankerOptions {
  /** Fails every call with `ProviderUnavailableError`, as a provider outage would. */
  readonly failing?: boolean;
  /** The HTTP status a failing call reports. */
  readonly failureStatus?: number;
}

/**
 * A deterministic reranker for tests: a document's score is the share of the query's distinct
 * (lower-cased, unaccented) words it contains, from 0 to 1. It bills one token per word of the
 * query and of every document and counts its calls in `calls`.
 */
export function createFakeReranker(
  options: FakeRerankerOptions = {},
): Reranker & { readonly calls: number } {
  let calls = 0;
  return {
    model: fakeRerankModel,
    get calls() {
      return calls;
    },
    rerank(query, documents) {
      calls += 1;
      if (options.failing === true) {
        return Promise.reject(
          new ProviderUnavailableError("The fake reranker is failing.", options.failureStatus),
        );
      }
      const asked = [...new Set(words(query))];
      const scores = documents.map((document) => {
        const present = new Set(words(document));
        return asked.length === 0
          ? 0
          : asked.filter((word) => present.has(word)).length / asked.length;
      });
      const tokens = words(query).length + documents.reduce((sum, d) => sum + words(d).length, 0);
      return Promise.resolve({ scores, tokens });
    },
  };
}

/**
 * Wraps an embedder so query embeddings are kept in a JSON file and reused, by model, version,
 * dimension and text, across instances and processes: for paid eval runs on a low-limit key, which
 * ask the same questions run after run. Only the misses of a call go to the provider, in one call,
 * and only their tokens are billed. Document embeddings always pass through (the store keeps those).
 * The file holds hashes of the keys and the vectors, never a query's text; it is written whole
 * through a renamed temporary file, so a reader never sees half of it. A failure of the provider
 * passes through and caches nothing.
 */
export function createQueryCachingEmbedder(embedder: Embedder, file: string): Embedder {
  const keyOf = (text: string) =>
    createHash("sha256")
      .update(JSON.stringify([embedder.model, embedder.version, embedder.dimension, text]))
      .digest("hex");

  return {
    model: embedder.model,
    version: embedder.version,
    dimension: embedder.dimension,
    async embed(texts, input, signal) {
      if (input !== "query") return embedder.embed(texts, input, signal);
      const entries = await readCache(file);
      const keys = texts.map(keyOf);
      const missing = [...new Set(texts.filter((_, index) => !entries.has(keys[index] ?? "")))];
      let tokens = 0;
      if (missing.length > 0) {
        const fresh = await embedder.embed(missing, input, signal);
        tokens = fresh.tokens;
        for (const [index, text] of missing.entries()) {
          const vector = fresh.vectors[index];
          if (vector === undefined) {
            throw new ProviderUnavailableError("The embedding provider returned too few vectors.");
          }
          entries.set(keyOf(text), vector);
        }
        await writeCache(file, entries);
      }
      return {
        vectors: keys.map((key) => {
          const vector = entries.get(key);
          if (vector === undefined) throw new Error("A cached query embedding is missing.");
          return vector;
        }),
        tokens,
      };
    },
  };
}

const cacheFormat = 1;

async function readCache(file: string): Promise<Map<string, readonly number[]>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return new Map();
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("format" in parsed) ||
    parsed.format !== cacheFormat ||
    !("entries" in parsed) ||
    typeof parsed.entries !== "object" ||
    parsed.entries === null
  ) {
    throw new Error("The query embedding cache is not in the expected format; delete it.");
  }
  const entries = new Map<string, readonly number[]>();
  for (const [key, vector] of Object.entries(parsed.entries)) {
    if (Array.isArray(vector) && vector.every((value) => typeof value === "number")) {
      entries.set(key, vector);
    }
  }
  return entries;
}

async function writeCache(file: string, entries: ReadonlyMap<string, readonly number[]>) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify({ format: cacheFormat, entries: Object.fromEntries(entries) }),
  );
  await rename(temporary, file);
}

/** Lower-cased words without diacritics. */
function words(text: string): string[] {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** The 32-bit FNV-1a hash of a word. */
function fnv1a(word: string): number {
  let hash = 0x811c9dc5;
  for (const char of word) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export interface VoyageEmbedderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly dimension: number;
  readonly timeoutMs: number;
  /** How many times a rate-limited (429) call is tried again; 0, the default, never retries. */
  readonly retries?: number;
  /** The longest wait before one retry; a longer `Retry-After` gives up at once. */
  readonly maxRetryWaitMs?: number;
  /** The fetch to call; tests pass a fake. */
  readonly fetch?: typeof globalThis.fetch;
  /** Waits between retries; tests pass one that only records. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** The jitter source, from 0 to 1; tests pass a constant. */
  readonly random?: () => number;
}

/**
 * The Voyage AI embeddings adapter. Any failure (network, timeout, a non-2xx answer, a malformed
 * body or a vector of another dimension) becomes `ProviderUnavailableError`, carrying the HTTP
 * status when there was one; the key never appears in an error message. A rate-limited (429) call
 * is tried again up to `retries` times: after the `Retry-After` the provider asked for, or else
 * after an exponential backoff with jitter (1 s, 2 s, 4 s and so on), each wait capped at
 * `maxRetryWaitMs`. A `Retry-After` longer than that gives up at once. The timeout applies to each
 * attempt; a caller's abort ends the waiting too.
 */
export function createVoyageEmbedder(options: VoyageEmbedderOptions): Embedder {
  const { model, dimension } = options;
  const post = voyagePoster(VOYAGE_EMBEDDINGS, "embedding", options);

  async function embed(
    texts: readonly string[],
    input: EmbeddingInput,
    signal?: AbortSignal,
  ): Promise<Embedding> {
    const body = await post(
      { input: texts, model, input_type: input, output_dimension: dimension },
      signal,
    );
    const parsed = parseVoyage(body);
    if (parsed === null) throw post.unavailable("its answer was malformed");
    const vectors: number[][] = [];
    for (let index = 0; index < texts.length; index += 1) {
      const vector = parsed.vectors.get(index);
      if (vector?.length !== dimension)
        throw post.unavailable("a vector was missing or of another size");
      vectors.push(vector);
    }
    return { vectors, tokens: parsed.tokens };
  }

  return { model, version: VOYAGE_VERSION, dimension, embed };
}

/** What both Voyage adapters share: the key, the per-attempt timeout and the 429 retries. */
interface VoyageCallOptions {
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly retries?: number;
  readonly maxRetryWaitMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

interface VoyagePoster {
  /** Posts the body and returns the parsed JSON answer (`null` when it is not JSON). */
  (body: unknown, signal?: AbortSignal): Promise<unknown>;
  /** The error of this provider for a reason, never naming the key. */
  unavailable(reason: string, status?: number): ProviderUnavailableError;
}

/**
 * Posts JSON to a Voyage endpoint: each attempt within the timeout, a rate-limited (429) answer
 * tried again up to `retries` times after the `Retry-After` it asked for or else an exponential
 * backoff with jitter, each wait capped at `maxRetryWaitMs` (a longer `Retry-After` gives up at
 * once). Every failure is a `ProviderUnavailableError` naming the provider's role, with the HTTP
 * status when it answered one.
 */
function voyagePoster(
  url: string,
  role: "embedding" | "reranking",
  options: VoyageCallOptions,
): VoyagePoster {
  const { apiKey, timeoutMs } = options;
  const retries = options.retries ?? 0;
  const maxRetryWaitMs = options.maxRetryWaitMs ?? 0;
  const send = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? wait;
  const random = options.random ?? Math.random;
  const unavailable = (reason: string, status?: number) =>
    new ProviderUnavailableError(`The ${role} provider is unavailable: ${reason}.`, status);

  async function call(body: string, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      return await send(url, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body,
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw unavailable(timeout.aborted || timedOut ? "it did not answer in time" : "no answer");
    }
  }

  const post = async (payload: unknown, signal?: AbortSignal): Promise<unknown> => {
    const body = JSON.stringify(payload);
    let response = await call(body, signal);
    for (let attempt = 0; response.status === RATE_LIMITED && attempt < retries; attempt += 1) {
      const asked = retryAfterMs(response.headers.get("retry-after"));
      if (asked !== null && asked > maxRetryWaitMs) break;
      const backoff = BACKOFF_BASE_MS * 2 ** attempt * (0.5 + random() / 2);
      await response.body?.cancel();
      await sleep(asked ?? Math.min(maxRetryWaitMs, Math.round(backoff)));
      if (signal?.aborted === true) throw unavailable("the call was cancelled");
      response = await call(body, signal);
    }
    if (!response.ok) {
      throw unavailable(`it answered ${String(response.status)}`, response.status);
    }
    return response.json().catch(() => null);
  };
  return Object.assign(post, { unavailable });
}

const RATE_LIMITED = 429;
/** The first backoff without `Retry-After`; it doubles with every retry. */
const BACKOFF_BASE_MS = 1000;

/** The wait a `Retry-After` header asks for (seconds or an HTTP date), or `null`. */
function retryAfterMs(header: string | null): number | null {
  if (header === null || header.trim() === "") return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.round(seconds * 1000) : null;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const VOYAGE_EMBEDDINGS = "https://api.voyageai.com/v1/embeddings";
/** The Voyage API version whose vectors the index stores. */
const VOYAGE_VERSION = "v1";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The vectors by input index and the billed tokens of a Voyage answer, or `null`. */
function parseVoyage(body: unknown): { vectors: Map<number, number[]>; tokens: number } | null {
  if (!isRecord(body)) return null;
  const data = body["data"];
  const usage = body["usage"];
  if (!Array.isArray(data) || !isRecord(usage)) return null;
  const tokens = usage["total_tokens"];
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0) return null;
  const vectors = new Map<number, number[]>();
  for (const item of data as unknown[]) {
    if (!isRecord(item)) return null;
    const index = item["index"];
    const embedding = item["embedding"];
    if (typeof index !== "number" || !Array.isArray(embedding)) return null;
    const values = embedding as unknown[];
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
    vectors.set(index, values as number[]);
  }
  return { vectors, tokens };
}

export interface VoyageRerankerOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  /** How many times a rate-limited (429) call is tried again; 0, the default, never retries. */
  readonly retries?: number;
  /** The longest wait before one retry; a longer `Retry-After` gives up at once. */
  readonly maxRetryWaitMs?: number;
  /** The fetch to call; tests pass a fake. */
  readonly fetch?: typeof globalThis.fetch;
  /** Waits between retries; tests pass one that only records. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** The jitter source, from 0 to 1; tests pass a constant. */
  readonly random?: () => number;
}

/**
 * The Voyage AI reranking adapter: one call scores every document against the query, without
 * truncating the list (no `top_k`), and returns the scores in the documents' order. Failures,
 * retries and the timeout behave as in `createVoyageEmbedder`; a score missing or not a number is
 * a malformed answer. No documents need no call.
 */
export function createVoyageReranker(options: VoyageRerankerOptions): Reranker {
  const { model } = options;
  const post = voyagePoster(VOYAGE_RERANK, "reranking", options);
  return {
    model,
    async rerank(query, documents, signal) {
      if (documents.length === 0) return { scores: [], tokens: 0 };
      const body = await post({ query, documents, model, truncation: true }, signal);
      const parsed = parseVoyageRerank(body);
      if (parsed === null) throw post.unavailable("its answer was malformed");
      const scores: number[] = [];
      for (let index = 0; index < documents.length; index += 1) {
        const score = parsed.scores.get(index);
        if (score === undefined) throw post.unavailable("a score was missing");
        scores.push(score);
      }
      return { scores, tokens: parsed.tokens };
    },
  };
}

const VOYAGE_RERANK = "https://api.voyageai.com/v1/rerank";

/** The relevance scores by document index and the billed tokens of a Voyage answer, or `null`. */
function parseVoyageRerank(body: unknown): { scores: Map<number, number>; tokens: number } | null {
  if (!isRecord(body)) return null;
  const data = body["data"];
  const usage = body["usage"];
  if (!Array.isArray(data) || !isRecord(usage)) return null;
  const tokens = usage["total_tokens"];
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0) return null;
  const scores = new Map<number, number>();
  for (const item of data as unknown[]) {
    if (!isRecord(item)) return null;
    const index = item["index"];
    const score = item["relevance_score"];
    if (typeof index !== "number" || typeof score !== "number" || !Number.isFinite(score)) {
      return null;
    }
    scores.set(index, score);
  }
  return { scores, tokens };
}
