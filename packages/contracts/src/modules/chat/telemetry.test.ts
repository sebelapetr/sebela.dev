import { describe, expect, it } from "vitest";

import {
  ChatTelemetryRegisteredSchema,
  ChatTelemetryRegistrationSchema,
  chatTelemetryExportDecisions,
  chatTelemetryExportHorizonMs,
  chatTelemetryRetentionDays,
} from "./index.js";

// Fictional identifiers only.
const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";

describe("ChatTelemetryRegistrationSchema", () => {
  it("accepts a grant and an OpenTelemetry trace id", () => {
    const registration = { grant: "fictional-grant", traceId };

    expect(ChatTelemetryRegistrationSchema.parse(registration)).toEqual(registration);
  });

  it.each([
    ["an upper-case id", traceId.toUpperCase()],
    ["a short id", traceId.slice(1)],
    ["a long id", `${traceId}0`],
    ["a non-hexadecimal id", `${traceId.slice(1)}g`],
    ["the invalid all-zero id", "0".repeat(32)],
  ])("refuses %s", (_name, id) => {
    expect(
      ChatTelemetryRegistrationSchema.safeParse({ grant: "fictional-grant", traceId: id }).success,
    ).toBe(false);
  });

  it("refuses an empty or oversized grant and any other field", () => {
    for (const body of [
      { grant: "", traceId },
      { grant: "g".repeat(201), traceId },
      { grant: "fictional-grant", traceId, conversationId: "c" },
    ]) {
      expect(ChatTelemetryRegistrationSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("ChatTelemetryRegisteredSchema", () => {
  it("answers whether the export is allowed and when the trace expires", () => {
    for (const decision of chatTelemetryExportDecisions) {
      const registered = { traceId, export: decision, expiresAt: "2031-04-09T12:00:00.000Z" };
      expect(ChatTelemetryRegisteredSchema.parse(registered)).toEqual(registered);
    }
    expect(
      ChatTelemetryRegisteredSchema.safeParse({
        traceId: "not-a-trace",
        export: "allowed",
        expiresAt: "2031-04-09T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("names the export horizon and the retention", () => {
    expect(chatTelemetryExportDecisions).toEqual(["allowed", "refused"]);
    expect(chatTelemetryExportHorizonMs).toBe(600_000);
    expect(chatTelemetryRetentionDays).toBe(30);
  });
});
