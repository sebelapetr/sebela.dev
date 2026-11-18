import { isImageFileName } from "../../../media-source";

export interface ReadMediaFileOptions {
  /**
   * Where the server reads the stored files: `WEB_MEDIA_READ_BASE_URL`, or the media base itself.
   * Validated by the configuration, without a trailing slash.
   */
  readonly mediaReadBaseUrl: string;
  /** How the file is fetched; the global `fetch` by default. */
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** How long the read may take; 15 seconds by default. */
  readonly timeoutMs?: number;
  /** The largest file served; 50 MB by default, as Next's image optimizer accepts. */
  readonly maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 50_000_000;

/** The type each stored image's extension must be served with. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/** Served images load nothing and run nothing, even when opened directly. */
const FILE_POLICY = "default-src 'none'; sandbox";

/** A stored image may be kept briefly; its name changes when the image is replaced. */
const FILE_CACHE = "public, max-age=300";

/**
 * Serves the stored image `name` from the site's own media path: the file below the read address,
 * uncached, without credentials, without following a redirect and limited in time and size. The
 * answer carries the type the extension names (the storage must agree), `nosniff` and a policy that
 * loads nothing. A name that is not a stored image, or one the storage does not have, is a 404
 * read from nowhere; any other failure is an empty 502. Never throws.
 */
export async function readMediaFile(
  name: string,
  options: ReadMediaFileOptions,
): Promise<Response> {
  const type = isImageFileName(name) ? IMAGE_TYPES[name.slice(name.lastIndexOf(".") + 1)] : null;
  if (type === undefined || type === null) return failure(404);

  const fetchFile = options.fetch ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchFile(`${options.mediaReadBaseUrl}/${name}`, {
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal,
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return failure(404);
    }
    if (response.status !== 200 || mediaType(response.headers.get("Content-Type")) !== type) {
      await response.body?.cancel();
      return failure(502);
    }
    const bytes = await readCapped(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
    if (bytes === null) return failure(502);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": FILE_CACHE,
        "Content-Security-Policy": FILE_POLICY,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return failure(502);
  }
}

function failure(status: 404 | 502): Response {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function mediaType(contentType: string | null): string | undefined {
  return contentType?.split(";")[0]?.trim().toLowerCase();
}

/** The whole body, or null as soon as it grows past `maxBytes`. */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
