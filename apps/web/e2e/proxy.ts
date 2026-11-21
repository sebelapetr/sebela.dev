// A proxy in front of the API that a browser test can take down: the website reads the API through
// it, so a test can show what visitors see while the API fails or stays silent, and how the pages
// recover once it answers again. It carries no port or host of its own (`stack.ts`).
import { once } from "node:events";
import { createServer, request, type ServerResponse } from "node:http";
import { urlToHttpOptions } from "node:url";

import { freePort, origin, required } from "./stack";

/**
 * How the proxy answers: `up` forwards every request on the target's origin, `down` answers 503
 * to everything and `silent` accepts every request and never answers, so the website's own timeout
 * ends the read.
 */
export type ProxyMode = "up" | "down" | "silent";

export interface Proxy {
  readonly url: string;
  mode: ProxyMode;
  close(): Promise<void>;
}

/** Starts a proxy to `target`, forwarding requests on its origin until the test changes its mode. */
export async function startProxy(target: string): Promise<Proxy> {
  const host = required("WEB_HOST");
  const port = await freePort(host);
  const state: { mode: ProxyMode } = { mode: "up" };
  const destination = new URL(target);
  const silent = new Set<ServerResponse>();
  const server = createServer((incoming, outgoing) => {
    if (state.mode === "down") {
      outgoing.writeHead(503).end();
      return;
    }
    if (state.mode === "silent") {
      silent.add(outgoing);
      outgoing.on("close", () => silent.delete(outgoing));
      return;
    }
    // The request target comes from the client: one such as `//other-host/x` or an absolute URL
    // resolves to another origin, which the proxy answers 502 without sending anything on.
    const resolved = URL.parse(incoming.url ?? "/", destination);
    if (resolved?.origin !== destination.origin) {
      outgoing.writeHead(502).end();
      return;
    }
    const forwarded = request(
      {
        ...urlToHttpOptions(destination),
        path: `${resolved.pathname}${resolved.search}`,
        method: incoming.method,
        headers: { ...incoming.headers, host: destination.host },
      },
      (answer) => {
        outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(outgoing);
      },
    );
    forwarded.on("error", () => outgoing.writeHead(502).end());
    incoming.pipe(forwarded);
  });
  server.listen(port, host);
  await once(server, "listening");
  return {
    url: origin(host, port),
    get mode() {
      return state.mode;
    },
    set mode(value: ProxyMode) {
      state.mode = value;
    },
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}
