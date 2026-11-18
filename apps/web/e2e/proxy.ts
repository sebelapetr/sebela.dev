// A proxy in front of the API that a browser test can take down: the website reads the API through
// it, so a test can show what visitors see while the API fails or stays silent, and how the pages
// recover once it answers again. It carries no port or host of its own (`stack.ts`).
import { once } from "node:events";
import { createServer, request, type ServerResponse } from "node:http";

import { freePort, origin, required } from "./stack";

/**
 * How the proxy answers: `up` forwards every request, `down` answers 503 to everything and `silent`
 * accepts every request and never answers, so the website's own timeout ends the read.
 */
export type ProxyMode = "up" | "down" | "silent";

export interface Proxy {
  readonly url: string;
  mode: ProxyMode;
  close(): Promise<void>;
}

/** Starts a proxy to `target`, forwarding every request until the test changes its mode. */
export async function startProxy(target: string): Promise<Proxy> {
  const host = required("WEB_HOST");
  const port = await freePort(host);
  const state: { mode: ProxyMode } = { mode: "up" };
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
    const forwarded = request(
      new URL(incoming.url ?? "/", target),
      { method: incoming.method, headers: { ...incoming.headers, host: new URL(target).host } },
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
