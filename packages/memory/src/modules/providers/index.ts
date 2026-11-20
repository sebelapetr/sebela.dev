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
        return Promise.reject(new ProviderUnavailableError("The fake provider is failing."));
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
 * body or a vector of another dimension) becomes `ProviderUnavailableError`; the key never appears
 * in an error message.
 */
export function createVoyageEmbedder(options: VoyageEmbedderOptions): Embedder {
  const { apiKey, model, dimension, timeoutMs } = options;
  const send = options.fetch ?? globalThis.fetch;
  const unavailable = (reason: string) =>
    new ProviderUnavailableError(`The embedding provider is unavailable: ${reason}.`);

  async function embed(
    texts: readonly string[],
    input: EmbeddingInput,
    signal?: AbortSignal,
  ): Promise<Embedding> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await send(VOYAGE_EMBEDDINGS, {
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
    if (!response.ok) throw unavailable(`it answered ${String(response.status)}`);
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
