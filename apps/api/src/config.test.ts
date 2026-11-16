import { describe, expect, it } from "vitest";

import { readApiConfig } from "./config.js";

// Values are taken from the environment the test passes in, never from code defaults. The port is
// the documented one (.env.example), loaded by the Vitest configuration.
const listenOn = process.env["API_PORT"];
const env = {
  API_HOST: "api.test",
  API_PORT: listenOn,
  API_BODY_LIMIT_BYTES: "65536",
  API_TRUSTED_PROXIES: "",
  API_RATE_LIMIT_HEALTH: "120/60",
  API_RATE_LIMIT_PUBLIC: "300/60",
  API_RATE_LIMIT_PRIVATE: "60/60",
  API_RATE_LIMIT_KEY: "30/10",
  API_RATE_LIMIT_MAX_TRACKED: "5000",
};

describe("readApiConfig", () => {
  it("reads every setting from the environment", () => {
    expect(readApiConfig(env)).toEqual({
      host: "api.test",
      port: Number(listenOn),
      bodyLimitBytes: 65536,
      trustedProxies: [],
      rateLimits: {
        health: { max: 120, windowMs: 60_000 },
        public: { max: 300, windowMs: 60_000 },
        private: { max: 60, windowMs: 60_000 },
        key: { max: 30, windowMs: 10_000 },
        maxTrackedCallers: 5000,
      },
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

  it("refuses a budget without a positive limit and window", () => {
    expect(() => readApiConfig({ ...env, API_RATE_LIMIT_PUBLIC: "0/60" })).toThrow(
      /API_RATE_LIMIT_PUBLIC/,
    );
    expect(() => readApiConfig({ ...env, API_RATE_LIMIT_PUBLIC: "10" })).toThrow(
      /API_RATE_LIMIT_PUBLIC/,
    );
  });
});
