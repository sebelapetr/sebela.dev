import { describe, expect, it } from "vitest";

import { readApiConfig } from "./config.js";

// Values are taken from the environment the test passes in, never from code defaults. The port is
// the documented one (.env.example), loaded by the Vitest configuration.
const listenOn = process.env["API_PORT"];
const env = {
  API_HOST: "api.test",
  API_PORT: listenOn,
  API_BODY_LIMIT_BYTES: "196608",
  API_TRUSTED_PROXIES: "",
  API_RATE_LIMIT_HEALTH: "120/60",
  API_RATE_LIMIT_PUBLIC: "300/60",
  API_RATE_LIMIT_PRIVATE: "60/60",
  API_RATE_LIMIT_KEY: "30/10",
  API_RATE_LIMIT_UPLOAD: "10/60",
  MEDIA_MAX_BYTES: "10485760",
  API_RATE_LIMIT_MAX_TRACKED: "5000",
  API_WEB_INVALIDATION_URL: "",
  API_WEB_INVALIDATION_SECRET: "",
};

// A disposable fixture secret and a fictional destination.
const SECRET = "fixture-invalidation-secret-0123456789";
const DESTINATION = "https://web.example.test/api/invalidate";

describe("readApiConfig", () => {
  it("reads every setting from the environment", () => {
    expect(readApiConfig(env)).toEqual({
      host: "api.test",
      port: Number(listenOn),
      bodyLimitBytes: 196_608,
      uploadLimitBytes: 10_485_760,
      trustedProxies: [],
      rateLimits: {
        health: { max: 120, windowMs: 60_000 },
        public: { max: 300, windowMs: 60_000 },
        private: { max: 60, windowMs: 60_000 },
        key: { max: 30, windowMs: 10_000 },
        upload: { max: 10, windowMs: 60_000 },
        maxTrackedCallers: 5000,
      },
      websiteInvalidation: null,
      chat: null,
    });
  });

  it("reads a comma-separated list of trusted proxy addresses", () => {
    const config = readApiConfig({ ...env, API_TRUSTED_PROXIES: " 198.51.100.1, 198.51.100.2 " });

    expect(config.trustedProxies).toEqual(["198.51.100.1", "198.51.100.2"]);
  });

  it("names every missing or invalid variable without echoing values", () => {
    const attempt = () =>
      readApiConfig({ ...env, API_PORT: undefined, API_RATE_LIMIT_KEY: "secret-ish/0" });

    expect(attempt).toThrow(/API_PORT/);
    expect(attempt).toThrow(/API_RATE_LIMIT_KEY/);
    expect(attempt).not.toThrow(/secret-ish/);
  });

  it("refuses a missing or non-positive upload limit", () => {
    expect(() => readApiConfig({ ...env, MEDIA_MAX_BYTES: undefined })).toThrow(/MEDIA_MAX_BYTES/);
    expect(() => readApiConfig({ ...env, MEDIA_MAX_BYTES: "0" })).toThrow(/MEDIA_MAX_BYTES/);
    expect(() => readApiConfig({ ...env, API_RATE_LIMIT_UPLOAD: "1" })).toThrow(
      /API_RATE_LIMIT_UPLOAD/,
    );
  });

  it("refuses a budget without a positive limit and window", () => {
    expect(() => readApiConfig({ ...env, API_RATE_LIMIT_PUBLIC: "0/60" })).toThrow(
      /API_RATE_LIMIT_PUBLIC/,
    );
    expect(() => readApiConfig({ ...env, API_RATE_LIMIT_PUBLIC: "10" })).toThrow(
      /API_RATE_LIMIT_PUBLIC/,
    );
  });

  describe("website invalidation", () => {
    const configured = {
      ...env,
      API_WEB_INVALIDATION_URL: DESTINATION,
      API_WEB_INVALIDATION_SECRET: SECRET,
    };

    it("reads the destination and the signing secret together", () => {
      expect(readApiConfig(configured).websiteInvalidation).toEqual({
        url: DESTINATION,
        secret: SECRET,
      });
    });

    it("is off when both are empty, and both must be present", () => {
      expect(readApiConfig(env).websiteInvalidation).toBeNull();
      expect(() => readApiConfig({ ...env, API_WEB_INVALIDATION_URL: undefined })).toThrow(
        /API_WEB_INVALIDATION_URL/,
      );
      expect(() => readApiConfig({ ...env, API_WEB_INVALIDATION_SECRET: undefined })).toThrow(
        /API_WEB_INVALIDATION_SECRET/,
      );
    });

    it("refuses one without the other, naming the missing one", () => {
      expect(() => readApiConfig({ ...configured, API_WEB_INVALIDATION_SECRET: "" })).toThrow(
        /API_WEB_INVALIDATION_SECRET/,
      );
      expect(() => readApiConfig({ ...configured, API_WEB_INVALIDATION_URL: "" })).toThrow(
        /API_WEB_INVALIDATION_URL/,
      );
    });

    it("refuses a destination that is not a plain http or https address", () => {
      for (const url of [
        "web.example.test/api/invalidate",
        "ftp://web.example.test/api/invalidate",
        "https://user:pass@web.example.test/api/invalidate",
        `${DESTINATION}?secret=${SECRET}`,
        `${DESTINATION}#fragment`,
      ]) {
        const attempt = () => readApiConfig({ ...configured, API_WEB_INVALIDATION_URL: url });
        expect(attempt, url).toThrow(/API_WEB_INVALIDATION_URL/);
        expect(attempt, url).not.toThrow(new RegExp(SECRET));
      }
    });

    it("refuses a short secret without echoing it", () => {
      const attempt = () =>
        readApiConfig({ ...configured, API_WEB_INVALIDATION_SECRET: "short-fixture-secret" });

      expect(attempt).toThrow(/API_WEB_INVALIDATION_SECRET/);
      expect(attempt).not.toThrow(/short-fixture-secret/);
    });
  });

  describe("visitor chat", () => {
    // Disposable fixture tokens and fictional addresses.
    const AI_TOKEN = "fixture-ai-service-token-0123456789abcdef";
    const CONTROL_TOKEN = "fixture-control-token-0123456789abcdefgh";
    const RELAY_TOKEN = "fixture-chat-relay-token-0123456789abcdef";
    const configured = {
      ...env,
      API_CHAT_ALLOWED_ORIGINS: "https://www.example.test, https://example.test",
      API_CHAT_COOKIE_SECURE: "true",
      API_AI_SERVICE_URL: "https://ai.example.test",
      API_AI_SERVICE_TOKEN: AI_TOKEN,
      API_AI_CONTROL_TOKEN: CONTROL_TOKEN,
      API_CHAT_RELAY_TOKEN: RELAY_TOKEN,
    };

    it("reads the origins, the cookie flag, the AI service, the control and relay tokens together", () => {
      expect(readApiConfig(configured).chat).toEqual({
        allowedOrigins: ["https://www.example.test", "https://example.test"],
        cookieSecure: true,
        aiService: { url: "https://ai.example.test", token: AI_TOKEN },
        controlToken: CONTROL_TOKEN,
        relayToken: RELAY_TOKEN,
      });
      expect(readApiConfig({ ...configured, API_CHAT_COOKIE_SECURE: "false" }).chat).toMatchObject({
        cookieSecure: false,
      });
    });

    it("is off when no chat setting is given or every one is empty", () => {
      expect(readApiConfig(env).chat).toBeNull();
      expect(
        readApiConfig({
          ...env,
          API_CHAT_ALLOWED_ORIGINS: "",
          API_CHAT_COOKIE_SECURE: "",
          API_AI_SERVICE_URL: "",
          API_AI_SERVICE_TOKEN: "",
          API_AI_CONTROL_TOKEN: "",
          API_CHAT_RELAY_TOKEN: "",
        }).chat,
      ).toBeNull();
    });

    it("needs the relay token with the other chat settings, and switches on with it alone", () => {
      const missing = () => readApiConfig({ ...configured, API_CHAT_RELAY_TOKEN: "" });
      expect(missing).toThrow(/API_CHAT_RELAY_TOKEN/);

      const alone = () => readApiConfig({ ...env, API_CHAT_RELAY_TOKEN: RELAY_TOKEN });
      expect(alone).toThrow(/API_AI_SERVICE_URL/);
      expect(alone).not.toThrow(/API_CHAT_RELAY_TOKEN/);
    });

    it("refuses a partial set, naming each missing setting", () => {
      const attempt = () =>
        readApiConfig({ ...configured, API_AI_SERVICE_URL: "", API_CHAT_COOKIE_SECURE: "" });

      expect(attempt).toThrow(/API_AI_SERVICE_URL/);
      expect(attempt).toThrow(/API_CHAT_COOKIE_SECURE/);
      expect(attempt).not.toThrow(/API_AI_CONTROL_TOKEN/);
    });

    it("refuses an origin that is not exactly a web origin", () => {
      for (const origins of [
        "https://www.example.test/",
        "https://www.example.test/chat",
        "www.example.test",
        "ftp://www.example.test",
        "https://user@www.example.test",
        " , ",
      ]) {
        expect(
          () => readApiConfig({ ...configured, API_CHAT_ALLOWED_ORIGINS: origins }),
          origins,
        ).toThrow(/API_CHAT_ALLOWED_ORIGINS/);
      }
    });

    it("refuses a cookie flag other than true or false", () => {
      expect(() => readApiConfig({ ...configured, API_CHAT_COOKIE_SECURE: "yes" })).toThrow(
        /API_CHAT_COOKIE_SECURE/,
      );
    });

    it("refuses an AI service address that is not a plain web address", () => {
      expect(() =>
        readApiConfig({ ...configured, API_AI_SERVICE_URL: "https://ai.example.test/?key=x" }),
      ).toThrow(/API_AI_SERVICE_URL/);
    });

    it("refuses short or shared tokens without echoing them", () => {
      const short = () =>
        readApiConfig({ ...configured, API_AI_SERVICE_TOKEN: "short-fixture-token" });
      expect(short).toThrow(/API_AI_SERVICE_TOKEN/);
      expect(short).not.toThrow(/short-fixture-token/);

      const shared = () => readApiConfig({ ...configured, API_AI_CONTROL_TOKEN: AI_TOKEN });
      expect(shared).toThrow(/API_AI_CONTROL_TOKEN/);
      expect(shared).not.toThrow(new RegExp(AI_TOKEN));

      const shortRelay = () =>
        readApiConfig({ ...configured, API_CHAT_RELAY_TOKEN: "short-fixture-relay" });
      expect(shortRelay).toThrow(/API_CHAT_RELAY_TOKEN/);
      expect(shortRelay).not.toThrow(/short-fixture-relay/);
      for (const reused of [AI_TOKEN, CONTROL_TOKEN]) {
        expect(() => readApiConfig({ ...configured, API_CHAT_RELAY_TOKEN: reused })).toThrow(
          /API_CHAT_RELAY_TOKEN/,
        );
      }
    });
  });
});
