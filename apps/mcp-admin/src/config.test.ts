import { describe, expect, it } from "vitest";

import { readMcpAdminConfig } from "./config.js";

const valid = {
  MCP_ADMIN_HOST: "mcp-admin.test",
  MCP_ADMIN_PORT: "0",
  MCP_ADMIN_API_URL: "http://content-api.test",
  MCP_ADMIN_ALLOWED_HOSTS: "mcp-admin.test, tunnel.test",
  MCP_ADMIN_ALLOWED_ORIGINS: "",
  MCP_ADMIN_TRUSTED_PROXIES: "",
  MCP_ADMIN_BODY_LIMIT_BYTES: "65536",
  MCP_ADMIN_TIMEOUT_MS: "15000",
  MCP_ADMIN_MAX_CONCURRENT: "8",
  MCP_ADMIN_RATE_LIMIT_PREAUTH: "30/60",
  MCP_ADMIN_RATE_LIMIT_KEY: "20/60",
  MCP_ADMIN_RATE_LIMIT_MAX_TRACKED: "1000",
};

describe("readMcpAdminConfig", () => {
  it("reads every setting", () => {
    expect(readMcpAdminConfig(valid)).toEqual({
      host: "mcp-admin.test",
      port: 0,
      apiUrl: "http://content-api.test",
      allowedHosts: ["mcp-admin.test", "tunnel.test"],
      allowedOrigins: [],
      trustedProxies: [],
      bodyLimitBytes: 65536,
      timeoutMs: 15000,
      maxConcurrent: 8,
      rateLimits: {
        preAuth: { max: 30, windowMs: 60_000 },
        key: { max: 20, windowMs: 60_000 },
        maxTracked: 1000,
      },
    });
  });

  it("names every missing setting and never repeats a value", () => {
    expect(() => readMcpAdminConfig({})).toThrow(/MCP_ADMIN_HOST.*MCP_ADMIN_API_URL/s);
    const secret = "http://user:hunter2@content-api.test";
    expect(() => readMcpAdminConfig({ ...valid, MCP_ADMIN_API_URL: secret })).toThrow(
      /MCP_ADMIN_API_URL/,
    );
    try {
      readMcpAdminConfig({ ...valid, MCP_ADMIN_API_URL: secret });
    } catch (error) {
      expect(String(error)).not.toContain("hunter2");
    }
  });

  it("accepts only a plain http or https API address", () => {
    for (const address of [
      "ftp://content-api.test",
      "http://content-api.test/?key=x",
      "http://content-api.test/#x",
      "not an address",
    ]) {
      expect(() => readMcpAdminConfig({ ...valid, MCP_ADMIN_API_URL: address })).toThrow(
        /MCP_ADMIN_API_URL/,
      );
    }
  });

  it("requires at least one allowed host and positive limits", () => {
    expect(() => readMcpAdminConfig({ ...valid, MCP_ADMIN_ALLOWED_HOSTS: " , " })).toThrow(
      /MCP_ADMIN_ALLOWED_HOSTS/,
    );
    expect(() => readMcpAdminConfig({ ...valid, MCP_ADMIN_MAX_CONCURRENT: "0" })).toThrow(
      /MCP_ADMIN_MAX_CONCURRENT/,
    );
    expect(() => readMcpAdminConfig({ ...valid, MCP_ADMIN_RATE_LIMIT_KEY: "20" })).toThrow(
      /MCP_ADMIN_RATE_LIMIT_KEY/,
    );
  });
});
