import { describe, expect, it } from "vitest";

import { createSiteverifyVerifier, readChatOptions, siteverifyUrl } from "./index.js";

// Fictional values and Cloudflare's published test secrets only; the real secret never appears.
const secret = "fictional-turnstile-secret";
const passingTestSecret = "1x0000000000000000000000000000000AA";
const now = new Date("2031-03-10T12:00:00.000Z");

interface Call {
  url: string;
  body: URLSearchParams;
}

/** A Siteverify stand-in that records the request and answers with `outcome`. */
function fakeFetch(outcome: Record<string, unknown> | Error, calls: Call[] = []): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body;
    calls.push({
      url,
      body:
        body instanceof URLSearchParams
          ? body
          : new URLSearchParams(typeof body === "string" ? body : ""),
    });
    if (outcome instanceof Error) return Promise.reject(outcome);
    return Promise.resolve(Response.json(outcome));
  };
}

const passing = {
  success: true,
  challenge_ts: "2031-03-10T11:58:00.000Z",
  hostname: "www.example.test",
  action: "chat",
  "error-codes": [],
};

const verifierWith = (
  outcome: Record<string, unknown> | Error,
  overrides: Partial<Parameters<typeof createSiteverifyVerifier>[0]> = {},
  calls: Call[] = [],
) =>
  createSiteverifyVerifier({
    secret,
    expectedHostname: "www.example.test",
    url: siteverifyUrl,
    production: false,
    timeoutMs: 1000,
    fetch: fakeFetch(outcome, calls),
    now: () => now,
    ...overrides,
  });

describe("Siteverify bot-challenge verifier", () => {
  it("posts the secret, token and client address and accepts a fresh chat challenge", async () => {
    const calls: Call[] = [];

    await expect(verifierWith(passing, {}, calls).verify("token-1", "192.0.2.7")).resolves.toBe(
      true,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(siteverifyUrl);
    expect(calls[0]?.body.get("secret")).toBe(secret);
    expect(calls[0]?.body.get("response")).toBe("token-1");
    expect(calls[0]?.body.get("remoteip")).toBe("192.0.2.7");
  });

  it("sends no client address when the visitor's is unknown", async () => {
    const calls: Call[] = [];

    await expect(verifierWith(passing, {}, calls).verify("token-1", null)).resolves.toBe(true);

    expect(calls[0]?.body.get("response")).toBe("token-1");
    expect(calls[0]?.body.has("remoteip")).toBe(false);
  });

  it.each([
    ["an unsuccessful check", { ...passing, success: false }],
    ["another hostname", { ...passing, hostname: "elsewhere.example.test" }],
    ["another action", { ...passing, action: "login" }],
    ["no action", { ...passing, action: undefined }],
    ["a challenge older than five minutes", { ...passing, challenge_ts: "2031-03-10T11:54:59Z" }],
    ["no challenge time", { ...passing, challenge_ts: undefined }],
    ["a malformed answer", { verdict: "yes" }],
  ])("refuses %s", async (_case, outcome) => {
    await expect(verifierWith(outcome).verify("token", "192.0.2.7")).resolves.toBe(false);
  });

  it("refuses when Siteverify cannot be reached or answers too late", async () => {
    await expect(verifierWith(new Error("offline")).verify("token", "192.0.2.7")).resolves.toBe(
      false,
    );
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    await expect(
      verifierWith(passing, { fetch: hanging, timeoutMs: 20 }).verify("token", "192.0.2.7"),
    ).resolves.toBe(false);
  });

  it("accepts a test secret's answer without hostname and action only outside production", async () => {
    const testAnswer = {
      success: true,
      challenge_ts: "2031-03-10T11:59:00.000Z",
      hostname: "example.com",
    };

    await expect(
      verifierWith(testAnswer, { secret: passingTestSecret }).verify("token", "192.0.2.7"),
    ).resolves.toBe(true);
    await expect(verifierWith(testAnswer).verify("token", "192.0.2.7")).resolves.toBe(false);
    expect(() => verifierWith(testAnswer, { secret: passingTestSecret, production: true })).toThrow(
      /test secret/i,
    );
  });
});

describe("chat configuration", () => {
  const complete = {
    API_CHAT_FINGERPRINT_KEY: "fictional-fingerprint-key-of-at-least-32-chars",
    API_CHAT_MODEL: "fictional-model",
    API_CHAT_EFFORT: "medium",
    API_CHAT_PRICING_VERSION: "fictional-pricing-1",
    API_TURNSTILE_SECRET_KEY: secret,
    API_TURNSTILE_EXPECTED_HOSTNAME: "www.example.test",
    STORAGE_ENVIRONMENT: "development",
  };

  it("is off when no chat setting is given", () => {
    expect(readChatOptions({ STORAGE_ENVIRONMENT: "development" })).toBeNull();
    expect(readChatOptions({ API_CHAT_RETENTION_DAYS: "" })).toBeNull();
  });

  it("keeps a conversation for 730 days unless configured otherwise", () => {
    expect(readChatOptions(complete)?.config).toEqual({
      fingerprintKey: complete.API_CHAT_FINGERPRINT_KEY,
      retentionDays: 730,
      model: "fictional-model",
      effort: "medium",
      pricingVersion: "fictional-pricing-1",
    });
    expect(
      readChatOptions({ ...complete, API_CHAT_RETENTION_DAYS: "30" })?.config.retentionDays,
    ).toBe(30);
  });

  it.each([
    ["API_TURNSTILE_SECRET_KEY", { API_TURNSTILE_SECRET_KEY: "" }],
    ["API_CHAT_FINGERPRINT_KEY", { API_CHAT_FINGERPRINT_KEY: "too-short" }],
    ["API_CHAT_RETENTION_DAYS", { API_CHAT_RETENTION_DAYS: "0" }],
    ["API_CHAT_RETENTION_DAYS", { API_CHAT_RETENTION_DAYS: "two years" }],
    ["API_CHAT_EFFORT", { API_CHAT_EFFORT: "" }],
    ["API_CHAT_EFFORT", { API_CHAT_EFFORT: "very much" }],
    ["API_TURNSTILE_EXPECTED_HOSTNAME", { API_TURNSTILE_EXPECTED_HOSTNAME: "https://x.test/" }],
    ["API_TURNSTILE_VERIFY_URL", { API_TURNSTILE_VERIFY_URL: "not a url" }],
  ])("names %s when it is missing or invalid", (name, change) => {
    expect(() => readChatOptions({ ...complete, ...change })).toThrow(name);
  });

  it("refuses a test secret and another verification address in production", () => {
    const production = { ...complete, STORAGE_ENVIRONMENT: "production" };

    expect(readChatOptions(production)).not.toBeNull();
    expect(() =>
      readChatOptions({ ...production, API_TURNSTILE_SECRET_KEY: passingTestSecret }),
    ).toThrow("API_TURNSTILE_SECRET_KEY");
    expect(() =>
      readChatOptions({
        ...production,
        API_TURNSTILE_VERIFY_URL: "https://siteverify.example.test/verify",
      }),
    ).toThrow("API_TURNSTILE_VERIFY_URL");
    expect(
      readChatOptions({
        ...complete,
        API_TURNSTILE_VERIFY_URL: "https://siteverify.example.test/verify",
      }),
    ).not.toBeNull();
  });
});
