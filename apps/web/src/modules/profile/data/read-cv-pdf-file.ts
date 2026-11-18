import type { ApiClient, Media } from "@sebela/api-client";

/**
 * The current CV PDF's file: its bytes and whose CV it is, no PDF at all (none is attached or no
 * profile is published), or a PDF that cannot be delivered now.
 */
export type CvPdfFile =
  | {
      readonly status: "ready";
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly personName: string;
    }
  | { readonly status: "none" }
  | { readonly status: "unavailable" };

export interface ReadCvPdfFileOptions {
  /**
   * The API's base address. Besides any https address, the file is read over plain http only from
   * this origin, where the API serves the files of its local storage.
   */
  readonly apiBaseUrl: string;
  readonly mediaRead?: { readonly baseUrl: string; readonly readBaseUrl: string };
  /** How long the whole read may take, the CV and the file together; 15 seconds by default. */
  readonly timeoutMs?: number;
  /** How the file is fetched from its address; the global `fetch` by default. */
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** What every PDF file starts with. */
const PDF_SIGNATURE = "%PDF-";

/**
 * Reads the file of the CV PDF the API's public CV route currently names, from the address its
 * media gives, uncached and limited in time. That address is the API's file route with local storage
 * or the storage's CDN; the read goes only to an https address or the API's own origin, never
 * follows a redirect and sends no credentials. It is the manually uploaded file exactly as stored:
 * nothing is generated. The file counts as delivered only when it arrives whole, is served as a
 * PDF and starts like one; anything else — a missing file, an error page, a failed or slow read —
 * is unavailable, never a download.
 */
export async function readCvPdfFile(
  client: ApiClient,
  options: ReadCvPdfFileOptions,
): Promise<CvPdfFile> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const fetchFile = options.fetch ?? fetch;

  let personName: string;
  let pdf: Media | null;
  try {
    const { data, response } = await client.GET("/v1/cv", { cache: "no-store", signal });
    if (data === undefined) {
      return response.status === 404 ? { status: "none" } : { status: "unavailable" };
    }
    personName = data.person.name;
    pdf = data.cvPdf;
  } catch {
    return { status: "unavailable" };
  }
  if (pdf === null) return { status: "none" };
  if (pdf.url === null || !isReadableFileUrl(pdf.url, options.apiBaseUrl)) {
    return { status: "unavailable" };
  }

  try {
    const response = await fetchFile(pdf.url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal,
    });
    if (!response.ok || !isPdfType(response.headers.get("Content-Type"))) {
      await response.body?.cancel();
      return { status: "unavailable" };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!startsWithPdfSignature(bytes)) return { status: "unavailable" };
    return { status: "ready", bytes, personName };
  } catch {
    return { status: "unavailable" };
  }
}

/** Whether the file may be read from an address: any https address, or http on the API's origin. */
function isReadableFileUrl(value: string, apiBaseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && url.origin === new URL(apiBaseUrl).origin;
}

function isPdfType(contentType: string | null): boolean {
  return contentType?.split(";")[0]?.trim().toLowerCase() === "application/pdf";
}

function startsWithPdfSignature(bytes: Uint8Array): boolean {
  return (
    new TextDecoder("latin1").decode(bytes.subarray(0, PDF_SIGNATURE.length)) === PDF_SIGNATURE
  );
}
