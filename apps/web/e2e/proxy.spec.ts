// The proxy the resilience tests put in front of the API (`proxy.ts`) stays on its target: a
// request target that resolves to another origin never leaves the proxy. Both servers here are
// local listeners on free ports of WEB_HOST that record the requests they receive.
import { once } from "node:events";
import { createServer, request, type IncomingMessage } from "node:http";
import { urlToHttpOptions } from "node:url";

import { expect, test } from "@playwright/test";

import { startProxy, type Proxy } from "./proxy";
import { freePort, origin, required } from "./stack";

interface Recorder {
  readonly url: string;
  readonly hits: { url: string; host: string | undefined }[];
  close(): Promise<void>;
}

async function startRecorder(): Promise<Recorder> {
  const host = required("WEB_HOST");
  const port = await freePort(host);
  const hits: Recorder["hits"] = [];
  const server = createServer((incoming, outgoing) => {
    hits.push({ url: incoming.url ?? "", host: incoming.headers.host });
    outgoing.writeHead(200, { "content-type": "text/plain" }).end("reached");
  });
  server.listen(port, host);
  await once(server, "listening");
  return {
    url: origin(host, port),
    hits,
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

/** Sends `path` to the proxy as the request target, exactly as written (no URL normalisation). */
async function send(proxy: Proxy, path: string): Promise<{ status: number; body: string }> {
  const sent = request({ ...urlToHttpOptions(new URL(proxy.url)), path, method: "GET" });
  sent.end();
  const [answer] = (await once(sent, "response")) as [IncomingMessage];
  let body = "";
  for await (const chunk of answer) body += String(chunk);
  return { status: answer.statusCode ?? 0, body };
}

test.describe("the browser tests' API proxy", () => {
  let target: Recorder;
  let other: Recorder;
  let proxy: Proxy;

  test.beforeEach(async () => {
    target = await startRecorder();
    other = await startRecorder();
    proxy = await startProxy(target.url);
  });

  test.afterEach(async () => {
    await proxy.close();
    await other.close();
    await target.close();
  });

  test("forwards a path and query to its target", async () => {
    const answer = await send(proxy, "/v1/profile?locale=en");

    expect(answer).toEqual({ status: 200, body: "reached" });
    expect(target.hits).toEqual([{ url: "/v1/profile?locale=en", host: new URL(target.url).host }]);
    expect(other.hits).toEqual([]);
  });

  for (const [name, path] of [
    ["a scheme-relative target", (to: string) => `//${new URL(to).host}/x`],
    ["an absolute target", (to: string) => `${to}/x`],
  ] as const) {
    test(`answers 502 to ${name} on another origin and sends nothing on`, async () => {
      const answer = await send(proxy, path(other.url));

      expect(answer.status).toBe(502);
      expect(other.hits).toEqual([]);
      expect(target.hits).toEqual([]);
    });
  }
});
