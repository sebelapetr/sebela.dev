export interface ContentCacheOptions {
  /** How a missing entry is read: the API client's requests go here. */
  readonly fetch: (request: Request) => Promise<Response>;
  /** The clock, in milliseconds since the epoch; `Date.now` by default. */
  readonly now?: () => number;
  /** How long an entry is served before it is read again; 60 seconds by default. */
  readonly maxAgeMs?: number;
  /** Most entries kept at once; the oldest is forgotten first. 256 by default. */
  readonly maxEntries?: number;
  /** Largest body kept, in bytes; a larger one is returned but not kept. 1 MiB by default. */
  readonly maxBodyBytes?: number;
  /** Where a stale answer is reported. */
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
 * Each entry lives at most `maxAgeMs`, so a dropped invalidation cannot keep content stale for long.
 * A read that began before an invalidation is returned to its caller but not kept, so a slow read
 * of older data cannot overwrite the invalidation.
 */
export function createContentCache(options: ContentCacheOptions): ContentCache {
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const entries = new Map<string, Entry>();
  let generation = 0;

  return {
    async fetch(request) {
      if (request.method !== "GET") return options.fetch(request);
      const key = request.url;
      const kept = entries.get(key);
      if (kept !== undefined) {
        if (now() - kept.storedAt < maxAgeMs) return toResponse(kept);
        entries.delete(key);
      }

      const startedIn = generation;
      const response = await options.fetch(request);
      if (response.status !== 200) return response;
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
      }
      return toResponse(entry);
    },
    invalidate() {
      generation += 1;
      entries.clear();
    },
  };
}
