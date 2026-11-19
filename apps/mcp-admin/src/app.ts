/**
 * MCP Admin over HTTP: Hono supplies the HTTP surface and its protections, the official MCP SDK
 * supplies the protocol. The order of every request is fixed: log line, health, Host, Origin, the
 * authentication gate, the body limit, and only then the MCP handler with the verified caller.
 * MCP Admin keeps no API key of its own; each request carries its caller's key to the content API.
 */
import { serve } from "@hono/node-server";
import { originValidation } from "@modelcontextprotocol/hono";
import { createMcpHandler, validateHostHeader, type AuthInfo } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { McpAdminConfig } from "./config.js";
import { createContentApi } from "./modules/content/index.js";
import { createGate, type Caller, type GateEnv } from "./modules/gate/index.js";
import { createAdminServer } from "./modules/tools/index.js";

export type Logger = (line: string) => void;

export interface McpAdminApp {
  readonly app: Hono<GateEnv>;
  /** Ends in-flight MCP exchanges. */
  close(): Promise<void>;
}

export interface McpAdminOptions {
  readonly config: McpAdminConfig;
  /** How the content API is reached; the platform `fetch` when omitted. */
  readonly fetch?: (request: Request) => Promise<Response>;
  readonly log?: Logger;
  /** The clock of the rate budgets, in milliseconds. */
  readonly now?: () => number;
}

const errorBody = (code: string, message: string) => ({ error: { code, message } });

/** A path as it may be logged: a segment that could hold a key is replaced. */
function loggablePath(url: string): string {
  return new URL(url).pathname
    .split("/")
    .map((segment) => (/sebela_/i.test(segment) || segment.length > 64 ? "[redacted]" : segment))
    .join("/");
}

/** The verified caller travels to the per-request MCP server inside the SDK's `authInfo`. */
function toAuthInfo(caller: Caller): AuthInfo {
  return { token: caller.key, clientId: "api-key", scopes: [], extra: { signal: caller.signal } };
}

function fromAuthInfo(authInfo: AuthInfo | undefined): Caller {
  const signal = authInfo?.extra?.["signal"];
  if (authInfo === undefined || !(signal instanceof AbortSignal)) {
    throw new Error("An MCP request reached the handler without a verified caller.");
  }
  return { key: authInfo.token, signal };
}

export function createMcpAdminApp(options: McpAdminOptions): McpAdminApp {
  const { config } = options;
  const log = options.log ?? (() => undefined);
  const content = createContentApi({
    baseUrl: config.apiUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const mcp = createMcpHandler(
    ({ authInfo }) => {
      const caller = fromAuthInfo(authInfo);
      return createAdminServer(content.forCaller(caller.key, caller.signal));
    },
    { responseMode: "json", maxRequestBodySize: config.bodyLimitBytes },
  );

  const app = new Hono<GateEnv>();

  app.use("*", async (c, next) => {
    await next();
    log(`${c.req.method} ${loggablePath(c.req.url)} ${String(c.res.status)}`);
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.use("*", async (c, next) => {
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    if (!validateHostHeader(host, [...config.allowedHosts]).ok) {
      return c.json(errorBody("forbidden", "This host name is not served."), 403);
    }
    await next();
    return undefined;
  });
  app.use("*", originValidation([...config.allowedOrigins]));
  app.use("*", createGate({ config, content, now: options.now ?? Date.now }));
  app.use(
    "*",
    bodyLimit({
      maxSize: config.bodyLimitBytes,
      onError: (c) => c.json(errorBody("payload_too_large", "The request body is too large."), 413),
    }),
  );

  app.all("/mcp", (c) => mcp.fetch(c.req.raw, { authInfo: toAuthInfo(c.var.caller) }));

  app.notFound((c) => c.json(errorBody("not_found", "Not found."), 404));
  app.onError((_error, c) => c.json(errorBody("internal", "Something went wrong."), 500));

  return { app, close: () => mcp.close() };
}

/** Listens with the configured address and resolves once the socket is open. */
export function startMcpAdminServer(options: {
  config: McpAdminConfig;
  log?: Logger;
}): Promise<{ url: string; close(): Promise<void> }> {
  const admin = createMcpAdminApp(options);
  const host = options.config.host.includes(":") ? `[${options.config.host}]` : options.config.host;
  return new Promise((resolve) => {
    const server = serve(
      { fetch: admin.app.fetch, port: options.config.port, hostname: options.config.host },
      (info) => {
        resolve({
          url: `http://${host}:${String(info.port)}`,
          close: async () => {
            await admin.close();
            await new Promise<void>((done) => {
              server.close(() => {
                done();
              });
            });
          },
        });
      },
    );
  });
}
