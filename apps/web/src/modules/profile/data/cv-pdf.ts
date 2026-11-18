import type { ApiClient, Media } from "@sebela/api-client";

import { isWebUrl, type ReadInit } from "./image";

/**
 * The current, manually uploaded CV PDF, as far as a page needs to know it. The file is maintained
 * apart from the profile: it is never generated, and a profile edit does not change it.
 */
export interface CvPdf {
  /** The calendar day (`YYYY-MM-DD`, UTC) the current file was uploaded. */
  readonly updatedOn: string;
}

/**
 * The PDF a page can offer, or null when there is none to offer: no media, not a PDF, or a file
 * without a web address. A media record's file never changes, so the day the record was created
 * is the day the current PDF was uploaded; its `updatedAt` moves with metadata edits (alternative
 * text) and the person's `updatedAt` with profile edits, so neither dates the PDF.
 */
export function toCvPdf(media: Media | null): CvPdf | null {
  if (media?.mediaType !== "application/pdf") return null;
  if (media.url === null || !isWebUrl(media.url)) return null;
  return { updatedOn: new Date(media.createdAt).toISOString().slice(0, 10) };
}

/**
 * Reads the CV PDF's media from the public media route, or null when it cannot be offered or the
 * read failed, was refused or timed out. Never throws, so a missing PDF never takes the page down.
 */
export async function readCvPdf(
  client: ApiClient,
  id: string,
  init: ReadInit,
): Promise<CvPdf | null> {
  try {
    const { data } = await client.GET("/v1/media/{id}", { params: { path: { id } }, ...init });
    return data === undefined ? null : toCvPdf(data);
  } catch {
    return null;
  }
}
