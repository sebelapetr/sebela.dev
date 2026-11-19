// @ts-check

// Starts the processes an eval case-run or an end-to-end test talks to: the API's end-to-end
// server on a temporary database seeded from a fictional fixture, with named ephemeral API keys,
// and the built MCP Admin server pointed at it. Both listen on a port the system picks; nothing
// here carries a port, host or database name. Keys are read from a mode-0600 file in the
// checkout's `.tmp/`, handed to the caller only, and removed with the fixture.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const apiFolder = fileURLToPath(new URL("../../api/", import.meta.url));
const mcpFolder = fileURLToPath(new URL("../", import.meta.url));
const scratchRoot = fileURLToPath(new URL("../../../.tmp/", import.meta.url));

/** The fictional seed folders of `evals/fixtures/`. */
export function fixtureFolder(/** @type {"s01"} */ name) {
  return fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
}

/**
 * @typedef {object} RunningProcess
 * @property {string} url The base address it listens on.
 * @property {() => Promise<void>} stop Stops it and waits for its clean-up.
 *
 * @typedef {RunningProcess & {
 *   keys: Record<string, { id: string, key: string }>,
 *   database: string,
 * }} RunningApi The API, its keys by name and the name of its temporary database.
 */

/**
 * Serves the API on its own temporary database seeded from `seedFolder`, with one API key per name.
 *
 * @param {{ seedFolder: string, keyNames: readonly string[], env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<RunningApi>}
 */
export async function startApi({ seedFolder, keyNames, env = {} }) {
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(join(scratchRoot, "mcp-admin-fixture-"));
  const keysFile = join(scratch, "keys.json");
  /** @type {RunningProcess | undefined} */
  let process_;
  try {
    process_ = await startProcess({
      command: process.execPath,
      args: ["--import", "tsx", "src/cli/e2e-server.ts", seedFolder],
      cwd: apiFolder,
      env: {
        ...process.env,
        API_PORT: "0",
        API_WEB_INVALIDATION_URL: "",
        API_WEB_INVALIDATION_SECRET: "",
        API_E2E_KEY_FILE: "",
        API_E2E_KEYS_FILE: keysFile,
        API_E2E_KEY_NAMES: keyNames.join(","),
        API_E2E_STORAGE_ROOT: join(scratch, "storage"),
        ...env,
      },
      ready: /e2e API listening on (http:\/\/\S+)/,
    });
    /** @type {{ database: string, keys: { name: string, id: string, key: string }[] }} */
    const written = JSON.parse(await readFile(keysFile, "utf8"));
    const keys = Object.fromEntries(written.keys.map(({ name, id, key }) => [name, { id, key }]));
    const started = process_;
    return {
      url: started.url,
      keys,
      database: written.database,
      stop: async () => {
        await started.stop();
        await rm(scratch, { recursive: true, force: true });
      },
    };
  } catch (error) {
    // A started API (and its temporary database) must not outlive a failed start.
    await process_?.stop();
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Serves the built MCP Admin server (`pnpm --filter @sebela/mcp-admin build` first) for `apiUrl`.
 *
 * @param {{ apiUrl: string, env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<RunningProcess>}
 */
export function startMcp({ apiUrl, env = {} }) {
  return startProcess({
    command: process.execPath,
    args: ["dist/server.js"],
    cwd: mcpFolder,
    env: { ...process.env, MCP_ADMIN_PORT: "0", MCP_ADMIN_API_URL: apiUrl, ...env },
    ready: /MCP Admin listening on (http:\/\/\S+)/,
  });
}

/**
 * Revokes an API key on the fixture's database through the API's own key command.
 *
 * @param {RunningApi} api
 * @param {string} name
 */
export async function revokeKey(api, name) {
  const entry = api.keys[name];
  if (!entry) throw new Error(`No fixture key named ${name}`);
  await run(process.execPath, ["--import", "tsx", "src/cli/api-keys.ts", "revoke", entry.id], {
    cwd: apiFolder,
    env: { ...process.env, DATABASE_NAME: api.database },
  });
}

/**
 * Starts a process and resolves once a line of its output matches `ready`.
 *
 * @param {{ command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, ready: RegExp }} options
 * @returns {Promise<RunningProcess>}
 */
function startProcess({ command, args, cwd, env, ready }) {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  /** @type {Promise<void>} */
  const exited = new Promise((resolve) => child.once("exit", () => resolve()));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await exited;
    }
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void stop().then(() =>
        reject(new Error(`${args.join(" ")} did not start: ${errors.slice(-500)}`)),
      );
    }, 60_000);
    child.stderr.on("data", (chunk) => {
      errors += String(chunk);
    });
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      const match = ready.exec(output);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve({ url: match[1], stop });
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${args.join(" ")} exited with ${String(code)}: ${errors.slice(-500)}`));
    });
  });
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} options
 * @returns {Promise<void>}
 */
function run(command, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += String(chunk);
    });
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${args.join(" ")} exited with ${String(code)}: ${errors.slice(-500)}`));
    });
  });
}
