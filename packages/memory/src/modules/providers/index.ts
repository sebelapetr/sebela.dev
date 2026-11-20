// Embedding providers behind the `Embedder` port: the Voyage AI adapter for deployment and paid
// evals, and a deterministic fake for every other test. Nothing outside this module knows a
// provider's wire format.
import {
  ProviderUnavailableError,
  type Embedder,
  type Embedding,
  type EmbeddingInput,
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
  const { apiKey, model, dimension, timeoutMs } = options;
  const retries = options.retries ?? 0;
  const maxRetryWaitMs = options.maxRetryWaitMs ?? 0;
  const send = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? wait;
  const random = options.random ?? Math.random;
  const unavailable = (reason: string, status?: number) =>
    new ProviderUnavailableError(`The embedding provider is unavailable: ${reason}.`, status);

  async function call(
    texts: readonly string[],
    input: EmbeddingInput,
    signal?: AbortSignal,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      return await send(VOYAGE_EMBEDDINGS, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          input: texts,
          model,
          input_type: input,
          output_dimension: dimension,
        }),
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw unavailable(timeout.aborted || timedOut ? "it did not answer in time" : "no answer");
    }
  }

  async function embed(
    texts: readonly string[],
    input: EmbeddingInput,
    signal?: AbortSignal,
  ): Promise<Embedding> {
    let response = await call(texts, input, signal);
    for (let attempt = 0; response.status === RATE_LIMITED && attempt < retries; attempt += 1) {
      const asked = retryAfterMs(response.headers.get("retry-after"));
      if (asked !== null && asked > maxRetryWaitMs) break;
      const backoff = BACKOFF_BASE_MS * 2 ** attempt * (0.5 + random() / 2);
      await response.body?.cancel();
      await sleep(asked ?? Math.min(maxRetryWaitMs, Math.round(backoff)));
      if (signal?.aborted === true) throw unavailable("the call was cancelled");
      response = await call(texts, input, signal);
    }
    if (!response.ok) {
      throw unavailable(`it answered ${String(response.status)}`, response.status);
    }
    const body: unknown = await response.json().catch(() => null);
    const parsed = parseVoyage(body);
    if (parsed === null) throw unavailable("its answer was malformed");
    const vectors: number[][] = [];
    for (let index = 0; index < texts.length; index += 1) {
      const vector = parsed.vectors.get(index);
      if (vector?.length !== dimension)
        throw unavailable("a vector was missing or of another size");
      vectors.push(vector);
    }
    return { vectors, tokens: parsed.tokens };
  }

  return { model, version: VOYAGE_VERSION, dimension, embed };
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
