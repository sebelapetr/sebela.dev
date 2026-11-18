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
  | "with-experience"
  | "with-photo"
  | "with-sparse-content"
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
export function apiCommand(fixture: Fixture) {
  return {
    command: `node --import tsx src/cli/e2e-server.ts ${JSON.stringify(fixtureFolder(fixture))}`,
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

async function start(
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
}

/**
 * Serves the API's end-to-end server for the fixture. It sends no invalidation notifications
 * unless `invalidation` names a receiver, whatever the checkout's environment says.
 */
export async function startApi(fixture: Fixture, options: ApiOptions = {}): Promise<StartedApi> {
  const host = required("API_HOST");
  const port = options.port ?? (await freePort(host));
  // Its own folder, chosen here, so a test can find this server's files while others run.
  await mkdir(scratch, { recursive: true });
  const storage = await mkdtemp(join(scratch, "e2e-storage-"));
  const started = await start(
    apiCommand(fixture),
    {
      API_PORT: String(port),
      API_WEB_INVALIDATION_URL: options.invalidation?.url ?? "",
      API_WEB_INVALIDATION_SECRET: options.invalidation?.secret ?? "",
      API_E2E_KEY_FILE: options.keyFile ?? "",
      API_E2E_STORAGE_ROOT: storage,
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
    },
    url,
    "/favicon.ico",
  );
}
