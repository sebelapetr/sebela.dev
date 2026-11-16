import type { CvPersistence } from "@sebela/db";

import type { CvService } from "./types.js";

/** The public address of a stored media key, or `null` when the storage cannot address it. */
export type MediaAddress = (key: string) => string | null;

export function createCvService(persistence: CvPersistence, mediaAddress: MediaAddress): CvService {
  return {
    getCv: () =>
      Promise.reject(
        new Error(`Not implemented yet: ${typeof persistence.readCv} ${typeof mediaAddress}`),
      ),
  };
}
