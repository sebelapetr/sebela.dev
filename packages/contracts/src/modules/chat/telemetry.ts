/**
 * Telemetry of the visitor chat (#214): the AI service registers each trace it means to export
 * before it exports it, and the API answers whether the export is allowed.
 *
 * - A trace id is an OpenTelemetry trace id: 32 lowercase hexadecimal characters, never all zero.
 * - The AI service exports a registered trace only within `chatTelemetryExportHorizonMs` of the
 *   registration; after that it drops it. The API therefore never asks for a remote deletion
 *   before the horizon has passed, so a late export cannot recreate a deleted trace.
 * - A registered trace expires `chatTelemetryRetentionDays` after the registration; the API then
 *   deletes the remote copy.
 * - `refused` means the trace must not be exported: its conversation or operation was deleted,
 *   or its trace is already owed a remote deletion.
 */
import { z } from "zod";

import { chatGrantMaxLength } from "./conversation.js";

/** How long after its registration the AI service may still export a trace: 10 minutes. */
export const chatTelemetryExportHorizonMs = 10 * 60 * 1000;

/** How long an exported trace is kept before the API deletes the remote copy. */
export const chatTelemetryRetentionDays = 30;

/** Whether a registered trace may be exported. */
export const chatTelemetryExportDecisions = ["allowed", "refused"] as const;

export type ChatTelemetryExportDecision = (typeof chatTelemetryExportDecisions)[number];

const Instant = z.iso.datetime({ offset: true });

/** An OpenTelemetry trace id: 32 lowercase hexadecimal characters, never all zero. */
const TraceId = z
  .string()
  .regex(/^[0-9a-f]{32}$/)
  .refine((value) => !/^0+$/.test(value), "An all-zero trace id is invalid.");

/** The AI service's registration of one trace of an operation, under the operation's grant. */
export const ChatTelemetryRegistrationSchema = z
  .strictObject({
    grant: z.string().min(1).max(chatGrantMaxLength),
    traceId: TraceId,
  })
  .meta({ id: "ChatTelemetryRegistration" });

export type ChatTelemetryRegistration = z.infer<typeof ChatTelemetryRegistrationSchema>;

/** The API's answer to a registration: export it, or not; repeated registrations answer alike. */
export const ChatTelemetryRegisteredSchema = z
  .strictObject({
    traceId: TraceId,
    export: z.enum(chatTelemetryExportDecisions),
    expiresAt: Instant,
  })
  .meta({ id: "ChatTelemetryRegistered" });

export type ChatTelemetryRegistered = z.infer<typeof ChatTelemetryRegisteredSchema>;
