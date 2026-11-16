import type { MediaReferenceFailure } from "@sebela/db";

import { DomainError } from "../../errors.js";

/** A refused media reference as a `validation_failed` naming the written field. */
export function mediaRefused(failure: MediaReferenceFailure): DomainError {
  const message =
    failure.reason === "unknown_media"
      ? "There is no such media; upload it first."
      : "This media is of the wrong kind for the field: use an image, or a PDF for the CV.";
  return new DomainError("validation_failed", message, [{ path: failure.field, message }]);
}

/** Whether a refused write is about a media reference. */
export function isMediaRefusal(failure: { reason: string }): failure is MediaReferenceFailure {
  return failure.reason === "unknown_media" || failure.reason === "unsuitable_media";
}
