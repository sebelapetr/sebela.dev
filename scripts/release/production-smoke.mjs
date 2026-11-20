// Production smoke check of the public edge (docs/release-workflow.md, "Deployment"): the pages
// respond over HTTPS, the website's health route is green, and the edge refuses the API's private
// routes, admin MCP and the website's internal routes even when the request carries a key. Plain
// Node without dependencies; tested in production-smoke.test.mjs. Run after every deployment by
// the release workflow, and by the owner at any time:
//
//   SMOKE_BASE_URL=https://sebela.dev [SMOKE_API_KEY=<key>] node scripts/release/production-smoke.mjs
//
// The workflow holds no application secret, so there it sends a made-up key: the edge must refuse
// these routes by path, whatever the key. The owner can repeat the check with a real API key.

import path from "node:path";

/** Public pages that must answer 200 with HTML. */
export const PAGES = ["/", "/experience", "/cv", "/services", "/ai-roadmap"];

/** Requests the public edge must refuse even with a valid key. */
export const REFUSED = [
  { method: "GET", path: "/v1/audit/changes" },
  { method: "PATCH", path: "/v1/person" },
  { method: "GET", path: "/v1/authentication" },
  { method: "POST", path: "/mcp" },
  { method: "GET", path: "/mcp" },
  { method: "POST", path: "/internal/invalidation" },
];

/** Answers that show the edge did not hand the request to a private route. */
const REFUSAL = new Set([403, 404, 405]);

async function request(baseUrl, { method = "GET", path: pathname, headers = {}, body }, timeoutMs) {
  return fetch(new URL(pathname, baseUrl), {
    method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function attempt(name, check) {
  try {
    const detail = await check();
    return { name, ok: detail === null, detail: detail ?? "ok" };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Runs every check against `baseUrl` and returns one result per check ({ name, ok, detail }),
 * never throwing. Private routes are asked with `Authorization: Bearer <apiKey>`.
 */
export async function smoke({ baseUrl, apiKey, timeoutMs = 15_000 }) {
  const checks = [];
  for (const page of PAGES) {
    checks.push(
      attempt(`page ${page}`, async () => {
        const response = await request(baseUrl, { path: page }, timeoutMs);
        await response.arrayBuffer();
        if (response.status !== 200) return `answered ${response.status}`;
        const type = response.headers.get("content-type") ?? "";
        return type.startsWith("text/html") ? null : `answered ${type || "no content type"}`;
      }),
    );
  }
  checks.push(
    attempt("health", async () => {
      const response = await request(baseUrl, { path: "/health" }, timeoutMs);
      const text = await response.text();
      if (response.status !== 200) return `answered ${response.status}: ${text.slice(0, 200)}`;
      const body = JSON.parse(text);
      const green = body?.status === "ok" && body?.api === "ok" && body?.postgres === "ok";
      return green ? null : `not green: ${text.slice(0, 200)}`;
    }),
  );
  for (const route of REFUSED) {
    checks.push(
      attempt(`refuses ${route.method} ${route.path}`, async () => {
        const write = route.method !== "GET";
        const response = await request(
          baseUrl,
          {
            ...route,
            headers: {
              authorization: `Bearer ${apiKey}`,
              ...(write ? { "content-type": "application/json" } : {}),
            },
            body: write ? "{}" : undefined,
          },
          timeoutMs,
        );
        await response.arrayBuffer();
        return REFUSAL.has(response.status) ? null : `answered ${response.status}`;
      }),
    );
  }
  return Promise.all(checks);
}

async function main() {
  const baseUrl = process.env.SMOKE_BASE_URL ?? "";
  if (!baseUrl.startsWith("https://")) {
    throw new Error("Set SMOKE_BASE_URL to the site's https:// address.");
  }
  const apiKey = process.env.SMOKE_API_KEY || "smoke-check-made-up-key";
  const results = await smoke({ baseUrl, apiKey });
  for (const { name, ok, detail } of results) {
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${detail}`}\n`);
  }
  if (results.some(({ ok }) => !ok)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error) => {
    process.stderr.write(`smoke: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
