export interface ContentCacheOptions {
  /** How a missing entry is read: the API client's requests go here. */
  readonly fetch: (request: Request) => Promise<Response>;
  /** The clock, in milliseconds since the epoch; `Date.now` by default. */
  readonly now?: () => number;
  /**
   * The fallback revalidation interval: how long an entry is served before the next request reads
   * it again, whether or not an invalidation arrived; 60 seconds by default.
   */
  readonly maxAgeMs?: number;
  /** Most entries kept at once; the oldest is forgotten first. 256 by default. */
  readonly maxEntries?: number;
  /** Largest body kept, in bytes; a larger one is returned but not kept. 1 MiB by default. */
  readonly maxBodyBytes?: number;
  /** Where each stale answer is reported: the API path and the cause, nothing else. */
  readonly log?: (line: string) => void;
}

/**
 * The website's process-local cache of the API's public reads. `fetch` stands in for the API
 * client's own: it answers a GET from a kept entry or reads it and keeps a 200 answer.
 * `invalidate` forgets every entry, and no read that began before it is kept afterwards.
 */
export interface ContentCache {
  readonly fetch: (request: Request) => Promise<Response>;
  invalidate(): void;
}

interface Entry {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly [string, string][];
  readonly body: ArrayBuffer;
  readonly storedAt: number;
}

const DEFAULT_MAX_AGE_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
/** Statuses below 500 that mean "try again later", not an answer about the content. */
const UNAVAILABLE = new Set([408, 429]);
const TRANSFER_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding"]);

const toResponse = (entry: Entry) =>
  new Response(entry.body.slice(0), {
    status: entry.status,
    statusText: entry.statusText,
    headers: [...entry.headers],
  });

/**
 * Creates a content cache. Only GET answers with status 200 are kept, by request address; any
 * other status and every failed read pass through unkept, so a failure is never served as content.
 * Each entry is served at most `maxAgeMs`, so a dropped invalidation cannot keep content stale for
 * long; the next request after that reads the API again. When that read fails because the API is
 * unavailable (no answer, a timeout, a 5xx, 408 or 429), the expired copy is served and logged, and
 * stays expired, so every later request asks again until the API answers. Any other answer, such
 * as a 404, replaces the copy. An invalidation forgets every copy, so it is never served again.
 * A read that began before an invalidation is returned to its caller but not kept, so a slow read
 * of older data cannot overwrite the invalidation.
 */
export function createContentCache(options: ContentCacheOptions): ContentCache {
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const log = options.log ?? (() => undefined);
  const entries = new Map<string, Entry>();
  let generation = 0;

  return {
    async fetch(request) {
      if (request.method !== "GET") return options.fetch(request);
      const key = request.url;
      const kept = entries.get(key);
      if (kept !== undefined && now() - kept.storedAt < maxAgeMs) return toResponse(kept);

      /** The expired copy, if no invalidation or eviction has removed it meanwhile. */
      const stale = (cause: string) => {
        if (kept === undefined || entries.get(key) !== kept) return undefined;
        log(`Content cache served a stale copy of ${new URL(key).pathname}: ${cause}`);
        return toResponse(kept);
      };

      const startedIn = generation;
      let response: Response;
      try {
        response = await options.fetch(request);
      } catch (error) {
        const fallback = stale(error instanceof Error ? error.name : "error");
        if (fallback) return fallback;
        throw error;
      }
      if (response.status !== 200) {
        if (UNAVAILABLE.has(response.status) || response.status >= 500) {
          const fallback = stale(`status ${String(response.status)}`);
          if (fallback) {
            await response.body?.cancel().catch(() => undefined);
            return fallback;
          }
        } else if (kept !== undefined && entries.get(key) === kept) {
          // A definite answer, such as a 404 for a deleted record: the old copy is wrong now.
          entries.delete(key);
        }
        return response;
      }
      const body = await response.arrayBuffer();
      const entry: Entry = {
        status: response.status,
        statusText: response.statusText,
        // The body is kept decoded, so its transfer encoding and length no longer describe it.
        headers: [...response.headers].filter(([name]) => !TRANSFER_HEADERS.has(name)),
        body,
        storedAt: now(),
      };
      if (startedIn === generation && body.byteLength <= maxBodyBytes) {
        entries.delete(key);
        entries.set(key, entry);
        while (entries.size > maxEntries) {
          const oldest = entries.keys().next();
          if (oldest.done === true) break;
          entries.delete(oldest.value);
        }
      } else if (entries.get(key) === kept) {
        // Too large to keep: the older copy must not stand in for it later.
        entries.delete(key);
      }
      return toResponse(entry);
    },
    invalidate() {
      generation += 1;
      entries.clear();
    },
  };
}
