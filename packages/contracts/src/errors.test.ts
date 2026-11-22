import { describe, expect, it } from "vitest";

import { ErrorResponseSchema } from "./errors.js";

describe("ErrorResponseSchema", () => {
  it("accepts an error with a code and a message", () => {
    const body = { error: { code: "not_found", message: "No person exists yet." } };
    expect(ErrorResponseSchema.parse(body)).toEqual(body);
  });

  it("accepts a validation error naming the offending fields", () => {
    const body = {
      error: {
        code: "validation_failed",
        message: "The request is invalid.",
        fields: [{ path: "links.0.url", message: "Invalid URL" }],
      },
    };
    expect(ErrorResponseSchema.parse(body)).toEqual(body);
  });

  it.each(["provider_unavailable", "budget_exhausted"])(
    "accepts the retrieval failure %s, which is never a missing result",
    (code) => {
      const body = { error: { code, message: "Search is unavailable." } };
      expect(ErrorResponseSchema.safeParse(body).success).toBe(true);
    },
  );

  it.each([
    "forbidden",
    "chat_request_conflict",
    "chat_busy",
    "chat_challenge_failed",
    "chat_quota_exceeded",
    "chat_budget_exhausted",
  ])("accepts the visitor chat refusal %s", (code) => {
    const body = { error: { code, message: "The question was not accepted." } };
    expect(ErrorResponseSchema.safeParse(body).success).toBe(true);
  });

  it("rejects a code outside the documented list", () => {
    expect(
      ErrorResponseSchema.safeParse({ error: { code: "teapot", message: "I am a teapot." } })
        .success,
    ).toBe(false);
  });

  it("rejects a body without the error envelope", () => {
    expect(ErrorResponseSchema.safeParse({ code: "not_found", message: "x" }).success).toBe(false);
  });
});
