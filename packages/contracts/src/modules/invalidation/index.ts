// The website invalidation notification: declared, not yet implemented.
import { z } from "zod";

const notImplemented = (input: unknown): never => {
  throw new Error(`Not implemented: ${typeof input}`);
};

export const contentDomains: readonly string[] = [];
export const contentChangeActions: readonly string[] = [];
export const invalidationMaxChanges = 0;
export const invalidationMaxBodyBytes = 0;
export const invalidationToleranceSeconds = 0;
export const invalidationSecretMinLength = 0;
export const invalidationHeaders = { timestamp: "", signature: "" };

export const ContentChangeSchema = z.never();
export const InvalidationNotificationSchema = z.object({
  eventId: z.string(),
  occurredAt: z.string(),
  changes: z.array(
    z.object({ domain: z.string(), record: z.string().nullable(), action: z.string() }),
  ),
});

export type InvalidationNotification = z.infer<typeof InvalidationNotificationSchema>;

export function encodeInvalidationNotification(notification: InvalidationNotification): Uint8Array {
  return notImplemented(notification);
}

export function signInvalidationNotification(request: {
  secret: string;
  body: Uint8Array;
  now: number;
}): Promise<{ timestamp: string; signature: string }> {
  return Promise.resolve(notImplemented(request));
}

export function verifyInvalidationNotification(request: {
  secret: string;
  body: Uint8Array;
  timestamp: string | null;
  signature: string | null;
  now: number;
}): Promise<{ ok: true; notification: InvalidationNotification } | { ok: false; reason: string }> {
  return Promise.resolve(notImplemented(request));
}
