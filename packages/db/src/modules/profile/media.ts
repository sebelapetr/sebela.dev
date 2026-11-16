import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { MediaPersistence } from "./types.js";

const notYet = (operation: string) =>
  Promise.reject(new Error(`${operation} is not implemented yet.`));

/** Not implemented yet: the tests describe the media persistence first. */
export function createMediaPersistence(db: NodePgDatabase): MediaPersistence {
  const pending = (operation: string) => notYet(`${operation} on ${typeof db}`);
  return {
    listMedia: () => pending("listMedia"),
    findMedia: () => pending("findMedia"),
    findMediaByKey: () => pending("findMediaByKey"),
    createMedia: () => pending("createMedia"),
    updateMedia: () => pending("updateMedia"),
    deleteMedia: () => pending("deleteMedia"),
  };
}
