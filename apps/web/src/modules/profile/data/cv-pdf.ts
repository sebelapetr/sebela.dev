import type { ApiClient, Media } from "@sebela/api-client";

import type { ReadInit } from "./image";

/** The current, manually uploaded CV PDF, as far as a page needs to know it. */
export interface CvPdf {
  /** The calendar day (`YYYY-MM-DD`, UTC) the current file was uploaded. */
  readonly updatedOn: string;
}

const notImplemented = (): never => {
  throw new Error("Not implemented.");
};

export const toCvPdf: (media: Media | null) => CvPdf | null = notImplemented;

export const readCvPdf: (client: ApiClient, id: string, init: ReadInit) => Promise<CvPdf | null> =
  notImplemented;
