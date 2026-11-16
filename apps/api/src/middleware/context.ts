import type { ApiConfig } from "../config.js";

/** The Hono environment of the app: the Node connection and what middleware hands on. */
export interface ApiEnv {
  Bindings: {
    /** Set by `@hono/node-server`; the connection the request arrived on. */
    incoming?: { socket?: { remoteAddress?: string } };
  };
  Variables: {
    /** The verified API key of a private request. */
    keyId: string;
    /** The validated request body. */
    body: unknown;
    /** The validated path parameters. */
    params: unknown;
  };
}

/**
 * The client a request is counted against: the connection's address, or, only when the connection
 * comes from a trusted proxy, the rightmost `X-Forwarded-For` entry that is not a trusted proxy.
 * Entries further left are written by the client and never believed.
 */
export function clientAddress(
  env: ApiEnv["Bindings"] | undefined,
  forwardedFor: string | undefined,
  trustedProxies: ApiConfig["trustedProxies"],
): string {
  const connection = env?.incoming?.socket?.remoteAddress ?? "unknown";
  if (!forwardedFor || !trustedProxies.includes(connection)) return connection;
  const hops = forwardedFor
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index];
    if (hop !== undefined && !trustedProxies.includes(hop)) return hop;
  }
  return connection;
}
