import { desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { isStillReferenced } from "./database-errors.js";
import { type Executor, now, WriteRefused } from "./relations.js";
import { media } from "./schema.js";
import type { MediaPersistence, MediaReferenceFailure } from "./types.js";

export const mediaColumns = {
  id: media.id,
  key: media.key,
  mediaType: media.mediaType,
  byteSize: media.byteSize,
  width: media.width,
  height: media.height,
  altText: media.altText,
  createdAt: media.createdAt,
  updatedAt: media.updatedAt,
};

/** What a reference may point at: an image (photo, logo, cover) or a PDF (the CV PDF). */
export type MediaKind = "image" | "pdf";

/** One media reference a write sets: the written field, the media id and the required kind. */
export interface MediaReference {
  field: string;
  id: string | null | undefined;
  kind: MediaKind;
}

/**
 * Checks the media a write attaches and locks it `FOR KEY SHARE` until the transaction ends, so
 * it cannot be deleted in between. An omitted or `null` reference is not checked. Refuses with
 * `unknown_media` or `unsuitable_media`, naming the field; the caller's transaction rolls back.
 */
export async function checkMediaReferences(tx: Executor, references: MediaReference[]) {
  for (const { field, id, kind } of references) {
    if (id === undefined || id === null) continue;
    const [row] = await tx
      .select({ mediaType: media.mediaType })
      .from(media)
      .where(eq(media.id, id))
      .for("key share");
    if (!row) {
      throw new WriteRefused<MediaReferenceFailure>({ ok: false, reason: "unknown_media", field });
    }
    if ((row.mediaType === "application/pdf") !== (kind === "pdf")) {
      throw new WriteRefused<MediaReferenceFailure>({
        ok: false,
        reason: "unsuitable_media",
        field,
      });
    }
  }
}

/** Runs a write; a media refusal rolls it back and becomes its failure. Other errors propagate. */
export async function refusingMedia<T>(
  write: () => Promise<T>,
): Promise<T | MediaReferenceFailure> {
  try {
    return await write();
  } catch (error) {
    if (!(error instanceof WriteRefused)) throw error;
    const failure: unknown = error.failure;
    if (isMediaReferenceFailure(failure)) return failure;
    throw error;
  }
}

function isMediaReferenceFailure(failure: unknown): failure is MediaReferenceFailure {
  const reason = (failure as { reason?: unknown } | null)?.reason;
  return reason === "unknown_media" || reason === "unsuitable_media";
}

/**
 * The metadata of uploaded files in `profile.media`. Keys are unique; the check constraints
 * refuse an empty file, an image without positive dimensions and a PDF with dimensions. Persons,
 * organizations and projects refer to media through foreign keys without a cascade, so a
 * referenced delete is refused by the database and returned as `referenced`.
 */
export function createMediaPersistence(db: NodePgDatabase): MediaPersistence {
  return {
    listMedia() {
      return db.select(mediaColumns).from(media).orderBy(desc(media.createdAt), desc(media.id));
    },
    async findMedia(id) {
      const [row] = await db.select(mediaColumns).from(media).where(eq(media.id, id));
      return row ?? null;
    },
    async findMediaByKey(key) {
      const [row] = await db.select(mediaColumns).from(media).where(eq(media.key, key));
      return row ?? null;
    },
    async createMedia(fields) {
      const [row] = await db.insert(media).values(fields).returning(mediaColumns);
      if (!row) throw new Error("The recorded media is missing.");
      return row;
    },
    async updateMedia(id, { altText }) {
      const [row] = await db
        .update(media)
        .set({ altText, updatedAt: now })
        .where(eq(media.id, id))
        .returning(mediaColumns);
      return row ?? null;
    },
    async deleteMedia(id) {
      try {
        const [row] = await db.delete(media).where(eq(media.id, id)).returning(mediaColumns);
        return row ? { ok: true, media: row } : { ok: false, reason: "not_found" };
      } catch (error) {
        if (isStillReferenced(error)) return { ok: false, reason: "referenced" };
        throw error;
      }
    },
  };
}
