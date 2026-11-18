// A local stand-in for an Umami analytics service, so the browser tests never reach a live
// account. It serves a tracker script that follows Umami's documented tracker contract — the
// `data-website-id`, `data-auto-track`, `data-exclude-search`, `data-exclude-hash` and
// `data-before-send` attributes, `umami.track(...)`, and the automatic full-address page views
// (including on `history.pushState`) that Umami sends unless `data-auto-track="false"` — and
// collects what reaches `/api/send`. A sending failure can be switched on.
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { freePort, origin, required } from "./stack";

const trackerScript = String.raw`(() => {
  const script = document.currentScript;
  const attr = (name) => script.getAttribute("data-" + name);
  const website = attr("website-id");
  const host = new URL(script.src).origin;
  const excludeSearch = attr("exclude-search") === "true";
  const excludeHash = attr("exclude-hash") === "true";
  const beforeSend = attr("before-send");
  const address = (href) => {
    const url = new URL(href, location.href);
    if (excludeSearch) url.search = "";
    if (excludeHash) url.hash = "";
    return url.toString();
  };
  let currentUrl = address(location.href);
  let currentRef = document.referrer;
  const payload = () => ({
    website,
    screen: screen.width + "x" + screen.height,
    language: navigator.language,
    title: document.title,
    hostname: location.hostname,
    url: currentUrl,
    referrer: currentRef,
  });
  const send = async (body, type = "event") => {
    const callback = beforeSend && window[beforeSend];
    if (typeof callback === "function") body = await Promise.resolve(callback(type, body));
    if (!body) return;
    try {
      await fetch(host + "/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payload: body }),
        credentials: "omit",
      });
    } catch {}
  };
  const track = (name, data) =>
    typeof name === "function" ? send(name(payload()))
    : typeof name === "string" ? send({ ...payload(), name, data })
    : typeof name === "object" ? send({ ...name })
    : send(payload());
  window.umami = { track, identify: () => undefined };
  if (attr("auto-track") !== "false") {
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function (...args) {
        original.apply(this, args);
        if (args[2]) {
          currentRef = currentUrl;
          currentUrl = address(args[2]);
          track();
        }
      };
    }
    track();
  }
})();
`;

/** One request that reached the stand-in's collector. */
export interface ReceivedEvent {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** The raw body, to check that nothing private appears anywhere in it. */
  readonly body: string;
}

export interface AnalyticsStub {
  /** The tracker script's address, for `WEB_ANALYTICS_SCRIPT_URL`. */
  readonly scriptUrl: string;
  readonly origin: string;
  /** Everything the collector received, in order. */
  events(): readonly ReceivedEvent[];
  /** How many times the tracker script was requested. */
  scriptRequests(): number;
  stop(): Promise<void>;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Starts the stand-in on the website's host; with `failSend`, its collector answers 500. */
export async function startAnalyticsStub({
  failSend = false,
}: { readonly failSend?: boolean } = {}): Promise<AnalyticsStub> {
  const host = required("WEB_HOST");
  const port = await freePort(host);
  const received: ReceivedEvent[] = [];
  let scripts = 0;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      if (request.method === "GET" && request.url === "/script.js") {
        scripts += 1;
        response.writeHead(200, { "Content-Type": "text/javascript", ...cors });
        response.end(trackerScript);
        return;
      }
      if (request.method === "OPTIONS" && request.url === "/api/send") {
        response.writeHead(204, cors);
        response.end();
        return;
      }
      if (request.method === "POST" && request.url === "/api/send") {
        const body = await readBody(request);
        const parsed = JSON.parse(body) as ReceivedEvent;
        received.push({ type: parsed.type, payload: parsed.payload, body });
        response.writeHead(failSend ? 500 : 200, { "Content-Type": "application/json", ...cors });
        response.end(failSend ? "{}" : '{"ok":true}');
        return;
      }
      response.writeHead(404, cors);
      response.end();
    })();
  });
  server.listen(port, host);
  await once(server, "listening");
  const stubOrigin = origin(host, port);
  return {
    scriptUrl: `${stubOrigin}/script.js`,
    origin: stubOrigin,
    events: () => [...received],
    scriptRequests: () => scripts,
    stop: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}
