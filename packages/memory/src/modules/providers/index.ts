// Embedding providers behind the `Embedder` port: the Voyage AI adapter for deployment and paid
// evals, and a deterministic fake for every other test. Nothing outside this module knows a
// provider's wire format.
import type { Embedder } from "../ports/index.js";

/** The fake embedder's model name; the store keeps its vectors apart from any real model's. */
export const fakeEmbeddingModel = "fake-hashed-words";

export interface FakeEmbedderOptions {
  /** Vector length; the retrieval schema stores 1024. */
  readonly dimension?: number;
  /** Fails every call with `ProviderUnavailableError`, as a provider outage would. */
  readonly failing?: boolean;
}

/**
 * A deterministic embedder for tests: a normalized hashed bag of lower-cased, unaccented words, so
 * texts sharing words are similar and the same text always has the same vector. It bills one token
 * per word and counts its calls in `calls`.
 */
export function createFakeEmbedder(
  options: FakeEmbedderOptions = {},
): Embedder & { readonly calls: number } {
  throw new Error(`Not implemented: ${String(options.dimension)}`);
}

export interface VoyageEmbedderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly dimension: number;
  readonly timeoutMs: number;
  /** The fetch to call; tests pass a fake. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * The Voyage AI embeddings adapter. Any failure (network, timeout, a non-2xx answer, a malformed
 * body or a vector of another dimension) becomes `ProviderUnavailableError`; the key never appears
 * in an error message.
 */
export function createVoyageEmbedder(options: VoyageEmbedderOptions): Embedder {
  throw new Error(`Not implemented: ${options.model}`);
}
