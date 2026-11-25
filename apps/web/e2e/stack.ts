// Starts the processes the browser tests read: the API's end-to-end server on a temporary database
// filled from a fictional fixture, and the built website pointed at an API. Settings come from the
// environment (`.env.example`, then the checkout's own files); nothing here carries a port or host.
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webFolder = fileURLToPath(new URL("..", import.meta.url));
const apiFolder = fileURLToPath(new URL("../../api", import.meta.url));

/** The fictional seed folders of `e2e/fixtures/`. */
export type Fixture =
  | "with-bookshelf"
  | "with-diary"
  | "with-events"
  | "with-experience"
  | "with-long-content"
  | "with-photo"
  | "with-roadmap"
  | "with-sparse-content"
  | "with-statistics"
  | "with-supporting-content"
  | "with-unsafe-text"
  | "without-photo"
  | "without-profile";

export function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Set ${name} for the browser tests (documented in .env.example)`);
  }
  return value;
}

/** An address for a URL: IPv6 hosts in brackets. */
export function origin(host: string, port: number | string): string {
  return `http://${host.includes(":") ? `[${host}]` : host}:${String(port)}`;
}

/** The fixture's seed folder. */
export function fixtureFolder(fixture: Fixture): string {
  return fileURLToPath(new URL(`fixtures/${fixture}`, import.meta.url));
}

/**
 * The command that serves the API on its own temporary database seeded from the fixture. It starts
 * the file `apps/api` documents as this interface, not `serve:e2e`, whose build step would run
 * again for every server the tests start at the same time (`apps/api/AGENTS.md`).
 */
export function apiCommand(fixture: Fixture, seedFolder = fixtureFolder(fixture)) {
  return {
    command: `node --import tsx src/cli/e2e-server.ts ${JSON.stringify(seedFolder)}`,
    cwd: apiFolder,
  };
}

/** The command that serves the built website (`next start`). */
export function webCommand() {
  return { command: "node scripts/next.mjs start", cwd: webFolder };
}

/** A port the system has just reported free on the host. */
export async function freePort(host: string): Promise<number> {
  const server = createServer();
  server.listen(0, host);
  await once(server, "listening");
  const address = server.address();
  server.close();
  if (address === null || typeof address === "string") throw new Error("No free port");
  return address.port;
}

async function waitFor(url: string, child: ChildProcess, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The process for ${url} exited early`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`${url} did not answer in time`);
}

/** A process started by a test, and how to stop it. */
export interface Started {
  readonly url: string;
  stop(): Promise<void>;
}

/** A started end-to-end API, with the storage folder that holds its files and no other server's. */
export interface StartedApi extends Started {
  readonly storage: string;
}

/** The checkout's scratch folder, where every end-to-end API keeps its storage folder. */
const scratch = fileURLToPath(new URL("../../../.tmp", import.meta.url));

/** Starts a command and waits until `url` + `readyPath` answers; its process group stops it. */
export async function start(
  { command, cwd }: { command: string; cwd: string },
  env: Record<string, string>,
  url: string,
  readyPath: string,
): Promise<Started> {
  const child = spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  const stop = async () => {
    if (child.exitCode !== null || child.pid === undefined) return;
    process.kill(-child.pid, "SIGTERM");
    await once(child, "exit");
  };
  try {
    await waitFor(`${url}${readyPath}`, child);
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, stop };
}

/**
 * The media folder of the API's end-to-end server at `apiBaseUrl`: it keeps its files in the
 * `test` environment folder without a worktree folder.
 */
export function mediaBaseUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl}/v1/media/files/test`;
}

/** Where an end-to-end API sends its signed invalidation notifications, and with which secret. */
export interface Invalidation {
  readonly url: string;
  readonly secret: string;
}

export interface ApiOptions {
  /** The port to listen on; a free one by default. */
  readonly port?: number;
  /** Signed invalidation notifications after content writes; none by default. */
  readonly invalidation?: Invalidation;
  /** An absolute file the server writes a new API key to, for tests that write content. */
  readonly keyFile?: string;
  /** Another seed folder than the fixture's, such as the chat's (`e2e/chat-stack.ts`). */
  readonly seedFolder?: string;
  /** More settings, such as the visitor chat's; they win over the defaults here. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * The visitor chat's settings, all empty: the chat is off (its routes answer 503 `unavailable`)
 * whatever the checkout's environment says, unless a test turns it on (`e2e/chat-stack.ts`).
 */
export const chatOff: Readonly<Record<string, string>> = {
  API_CHAT_ALLOWED_ORIGINS: "",
  API_CHAT_COOKIE_SECURE: "",
  API_CHAT_FINGERPRINT_KEY: "",
  API_CHAT_RETENTION_DAYS: "",
  API_CHAT_MODEL: "",
  API_CHAT_EFFORT: "",
  API_CHAT_PRICING_VERSION: "",
  API_CHAT_RELAY_TOKEN: "",
  API_TURNSTILE_SECRET_KEY: "",
  API_TURNSTILE_EXPECTED_HOSTNAME: "",
  API_TURNSTILE_VERIFY_URL: "",
  API_AI_SERVICE_URL: "",
  API_AI_SERVICE_TOKEN: "",
  API_AI_CONTROL_TOKEN: "",
  API_E2E_CHAT_DAILY_SPEND_LIMIT_MICRO_USD: "",
};

/**
 * Serves the API's end-to-end server for the fixture. It sends no invalidation notifications
 * unless `invalidation` names a receiver, and its chat is off unless `env` turns it on, whatever
 * the checkout's environment says.
 */
export async function startApi(fixture: Fixture, options: ApiOptions = {}): Promise<StartedApi> {
  const host = required("API_HOST");
  const port = options.port ?? (await freePort(host));
  // Its own folder, chosen here, so a test can find this server's files while others run.
  await mkdir(scratch, { recursive: true });
  const storage = await mkdtemp(join(scratch, "e2e-storage-"));
  const started = await start(
    apiCommand(fixture, options.seedFolder),
    {
      ...chatOff,
      API_PORT: String(port),
      API_WEB_INVALIDATION_URL: options.invalidation?.url ?? "",
      API_WEB_INVALIDATION_SECRET: options.invalidation?.secret ?? "",
      API_E2E_KEY_FILE: options.keyFile ?? "",
      API_E2E_STORAGE_ROOT: storage,
      ...options.env,
    },
    origin(host, port),
    "/health",
  );
  return { ...started, storage };
}

export interface WebsiteOptions {
  /** The canonical origin; the website's own address by default. */
  readonly siteOrigin?: string;
  /** The port to listen on; a free one by default. */
  readonly port?: number;
  /** The secret that verifies invalidation notifications; none by default. */
  readonly invalidationSecret?: string;
  /** The content cache's fallback revalidation interval in seconds; the default (60) otherwise. */
  readonly contentRevalidateSeconds?: number;
  /** The analytics settings (`WEB_ANALYTICS_*`), such as a local stand-in's; none by default. */
  readonly analytics?: { readonly scriptUrl: string; readonly websiteId: string };
  /**
   * Whether search engines may index the site (`WEB_INDEXING`). On by default, so the tests see
   * the metadata of the launched site; `false` leaves it unset, as in a worktree or a production
   * stack not yet launched.
   */
  readonly indexing?: boolean;
  /** The public site key of the chat's person check (`WEB_TURNSTILE_SITE_KEY`); none by default. */
  readonly chatSiteKey?: string;
  /** The chat relay's token (`WEB_CHAT_RELAY_TOKEN`), the API's `API_CHAT_RELAY_TOKEN`; none by default. */
  readonly chatRelayToken?: string;
  /**
   * How many proxies in front of the website append to `X-Forwarded-For`
   * (`WEB_TRUSTED_PROXY_HOPS`); none by default, so the relay names no visitor address.
   */
  readonly trustedProxyHops?: number;
}

/** Serves the built website, reading the API at `apiBaseUrl`. */
export async function startWebsite(
  apiBaseUrl: string,
  {
    siteOrigin,
    port: chosenPort,
    invalidationSecret,
    contentRevalidateSeconds,
    analytics,
    indexing = true,
    chatSiteKey,
    chatRelayToken,
    trustedProxyHops,
  }: WebsiteOptions = {},
): Promise<Started> {
  const host = required("WEB_HOST");
  const port = chosenPort ?? (await freePort(host));
  const url = origin(host, port);
  return start(
    webCommand(),
    {
      WEB_PORT: String(port),
      WEB_API_BASE_URL: apiBaseUrl,
      WEB_SITE_ORIGIN: siteOrigin ?? url,
      WEB_MEDIA_BASE_URL: mediaBaseUrl(apiBaseUrl),
      WEB_MEDIA_READ_BASE_URL: "",
      WEB_INVALIDATION_SECRET: invalidationSecret ?? "",
      WEB_CONTENT_REVALIDATE_SECONDS:
        contentRevalidateSeconds === undefined ? "" : String(contentRevalidateSeconds),
      WEB_ANALYTICS_SCRIPT_URL: analytics?.scriptUrl ?? "",
      WEB_ANALYTICS_WEBSITE_ID: analytics?.websiteId ?? "",
      WEB_INDEXING: indexing ? "on" : "",
      WEB_TURNSTILE_SITE_KEY: chatSiteKey ?? "",
      WEB_CHAT_RELAY_TOKEN: chatRelayToken ?? "",
      WEB_TRUSTED_PROXY_HOPS: trustedProxyHops === undefined ? "" : String(trustedProxyHops),
    },
    url,
    "/favicon.ico",
  );
}
