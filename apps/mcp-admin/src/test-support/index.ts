// Test support, excluded from the build: a configuration for in-process tests, a fake content API
// and an MCP SDK client that talks to the app without a socket. Every value here is fictional: the
// host names end in `.test` and the addresses come from the documentation ranges (RFC 5737).
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Hono } from "hono";

import { readMcpAdminConfig, type McpAdminConfig } from "../config.js";

/** The Host the in-process tests address the server by; listed in its allowed hosts. */
export const MCP_HOST = "mcp-admin.test";
/** Where the in-process tests' fake content API lives; never resolved, the fake is called directly. */
export const API_BASE = "http://content-api.test";
/** A client address on the connection, as the Node server would report it. */
export const CLIENT_ADDRESS = "203.0.113.7";

/** Key-shaped fictional credentials the fake API accepts. */
export const KEY_A = `sebela_${"a".repeat(16)}_${"A".repeat(43)}`;
export const KEY_B = `sebela_${"b".repeat(16)}_${"B".repeat(43)}`;
/** Key-shaped, but never valid. */
export const UNKNOWN_KEY = `sebela_${"0".repeat(16)}_${"Z".repeat(43)}`;

export const fictionalPerson = {
  name: "Ilsa Marrow",
  headline: "Fictional systems engineer",
  shortBio: "Ilsa is a **fictional** person.",
  longBio: "Ilsa Marrow exists only in this test.",
  location: "Port Avelin",
  email: "ilsa@marrow.example.test",
  links: [],
  availability: "Not available; this is a test.",
  careerStartedOn: "2015-04-01",
  servicesIntro: "None.",
  collaborationSteps: [],
  servicesNote: "None.",
  photo: null,
  cvPdf: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** Settings for the in-process tests, with every limit overridable. */
export function testConfig(overrides: Record<string, string> = {}): McpAdminConfig {
  return readMcpAdminConfig({
    MCP_ADMIN_HOST: MCP_HOST,
    MCP_ADMIN_PORT: "0",
    MCP_ADMIN_API_URL: API_BASE,
    MCP_ADMIN_ALLOWED_HOSTS: MCP_HOST,
    MCP_ADMIN_ALLOWED_ORIGINS: "",
    MCP_ADMIN_TRUSTED_PROXIES: "",
    MCP_ADMIN_BODY_LIMIT_BYTES: "65536",
    MCP_ADMIN_TIMEOUT_MS: "2000",
    MCP_ADMIN_MAX_CONCURRENT: "4",
    MCP_ADMIN_RATE_LIMIT_PREAUTH: "1000/60",
    MCP_ADMIN_RATE_LIMIT_KEY: "1000/60",
    MCP_ADMIN_RATE_LIMIT_MAX_TRACKED: "1000",
    ...overrides,
  });
}

export interface UpstreamCall {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly redirect: Request["redirect"];
}

export interface FakeApi {
  /** The upstream `fetch` the app is given. */
  readonly fetch: (request: Request) => Promise<Response>;
  /** Every request the app sent, in order. */
  readonly calls: UpstreamCall[];
  /** Replaces the answer of one path (`/v1/authentication`, `/v1/person`). */
  answer(path: string, handler: (request: Request) => Response | Promise<Response>): void;
  /** Removes a key from the accepted ones, like a revocation. */
  revoke(key: string): void;
}

/** A content API that accepts KEY_A and KEY_B and stores `fictionalPerson`. */
export function fakeApi(): FakeApi {
  const accepted = new Set([KEY_A, KEY_B]);
  const calls: UpstreamCall[] = [];
  const overrides = new Map<string, (request: Request) => Response | Promise<Response>>();
  const app = new Hono();
  app.get("/v1/authentication", (c) => {
    const presented = /^Bearer (\S+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    if (presented === undefined || !accepted.has(presented)) {
      return c.json(
        { error: { code: "unauthorized", message: "A valid API key is required." } },
        401,
        {
          "WWW-Authenticate": "Bearer",
        },
      );
    }
    return c.json({ status: "authenticated" });
  });
  app.get("/v1/person", (c) => c.json(fictionalPerson));
  return {
    calls,
    fetch: async (request) => {
      const url = new URL(request.url);
      calls.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.get("authorization"),
        redirect: request.redirect,
      });
      const override = overrides.get(url.pathname);
      if (override) return override(request);
      return app.fetch(request);
    },
    answer: (path, handler) => {
      overrides.set(path, handler);
    },
    revoke: (key) => {
      accepted.delete(key);
    },
  };
}

/** The Node binding of a request, as `@hono/node-server` sets it. */
export function connection(remoteAddress = CLIENT_ADDRESS) {
  return { incoming: { socket: { remoteAddress } } };
}

type AppFetch = (
  request: Request,
  env: ReturnType<typeof connection>,
) => Response | Promise<Response>;

/** Sends one raw HTTP request to the app in-process. */
export function send(
  fetch: AppFetch,
  path: string,
  init: RequestInit = {},
  remoteAddress = CLIENT_ADDRESS,
): Promise<Response> {
  return Promise.resolve(
    fetch(new Request(`http://${MCP_HOST}${path}`, init), connection(remoteAddress)),
  );
}

/** A JSON-RPC POST to `/mcp` with the headers the Streamable HTTP transport sends. */
export function rpc(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "fictional-test-client", version: "0.0.0" },
  },
};

/** The official SDK client, connected to the app in-process with `key` as its bearer token. */
export async function connectClient(fetch: AppFetch, key: string | null): Promise<Client> {
  const client = new Client({ name: "mcp-admin-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://${MCP_HOST}/mcp`), {
    requestInit: key === null ? {} : { headers: { Authorization: `Bearer ${key}` } },
    fetch: (url, init) => Promise.resolve(fetch(new Request(url, init), connection())),
  });
  await client.connect(transport);
  return client;
}

/** The text of a tool result's first content block. */
export function toolText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content[0]?.text ?? "";
}
