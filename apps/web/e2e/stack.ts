// Starts the processes the browser tests read: the API's end-to-end server on a temporary database
// filled from a fictional fixture, and the built website pointed at an API. Settings come from the
// environment (`.env.example`, then the checkout's own files); nothing here carries a port or host.
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const webFolder = fileURLToPath(new URL("..", import.meta.url));
const apiFolder = fileURLToPath(new URL("../../api", import.meta.url));

/** The fictional seed folders of `e2e/fixtures/`. */
export type Fixture = "with-photo" | "without-photo";

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

/** The command that serves the API on its own temporary database seeded from the fixture. */
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

/** Serves the API's end-to-end server for the fixture on the given port, or a free one. */
export async function startApi(fixture: Fixture, port?: number): Promise<Started> {
  const host = required("API_HOST");
  port ??= await freePort(host);
  return start(apiCommand(fixture), { API_PORT: String(port) }, origin(host, port), "/health");
}

/** Serves the built website on a free port, reading the API at `apiBaseUrl`. */
export async function startWebsite(apiBaseUrl: string): Promise<Started> {
  const host = required("WEB_HOST");
  const port = await freePort(host);
  return start(
    webCommand(),
    { WEB_PORT: String(port), WEB_API_BASE_URL: apiBaseUrl },
    origin(host, port),
    "/favicon.ico",
  );
}
