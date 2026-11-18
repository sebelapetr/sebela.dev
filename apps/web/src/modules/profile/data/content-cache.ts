export interface ContentCacheOptions {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly now?: () => number;
  readonly maxAgeMs?: number;
  readonly maxEntries?: number;
  readonly maxBodyBytes?: number;
}

export interface ContentCache {
  readonly fetch: (request: Request) => Promise<Response>;
  invalidate(): void;
}

export function createContentCache(options: ContentCacheOptions): ContentCache {
  throw new Error(`createContentCache is not implemented (${Object.keys(options).join(", ")})`);
}
