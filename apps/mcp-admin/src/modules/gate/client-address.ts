/** The Node binding `@hono/node-server` sets on every request. */
export interface NodeBindings {
  readonly incoming?: { readonly socket?: { readonly remoteAddress?: string } };
}

/**
 * The client a request is counted against: the connection's address, or, only when the connection
 * comes from a trusted proxy, the rightmost `X-Forwarded-For` entry that is not a trusted proxy.
 * Entries further left are written by the client and never believed.
 */
export function clientAddress(
  env: NodeBindings | undefined,
  forwardedFor: string | undefined,
  trustedProxies: readonly string[],
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
