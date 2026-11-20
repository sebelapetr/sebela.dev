// Maintenance adapter: uploads one file from disk over the authenticated `POST /v1/media` route, so
// a photo or a CV PDF never passes through a model's tool call as base64 (issue #201). Unlike
// `api-keys` and `seed` it goes over HTTP with the owner's key, exactly like any other client, so
// it works against a local API or one reached through an SSH tunnel.
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { checkMediaUpload, DomainError, readMediaLimits } from "@sebela/services";

export interface CommandOutput {
  out(text: string): void;
  err(text: string): void;
}

/** What the command reads from outside: the environment, the start directory and the network. */
export interface MediaCommandContext {
  /**
   * `SEBELA_ADMIN_API_KEY` (the owner's key), `API_HOST` and `API_PORT` (the API's address) and
   * the upload limits `MEDIA_MAX_BYTES` and `MEDIA_MAX_IMAGE_DIMENSION`.
   */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The directory a relative file path is read from. */
  readonly cwd: string;
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const KEY_VARIABLE = "SEBELA_ADMIN_API_KEY";

const USAGE = `Usage: media upload <file> [--alt <text>]

  Uploads one PNG, JPEG, WebP or PDF file over the authenticated media route and prints the stored
  media id, to attach as the profile photo, an organization logo or the CV. The key is read from
  ${KEY_VARIABLE}; the API's address from API_HOST and API_PORT.
`;

interface UploadArguments {
  readonly file: string;
  readonly altText: string | null;
}

function parse(args: readonly string[]): UploadArguments | null {
  const [command, ...rest] = args;
  if (command !== "upload") return null;
  let file: string | null = null;
  let altText: string | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index] ?? "";
    if (argument === "--alt") {
      const value = rest[index + 1];
      if (value === undefined || altText !== null) return null;
      altText = value;
      index += 1;
    } else if (file === null && argument !== "") {
      file = argument;
    } else {
      return null;
    }
  }
  return file === null ? null : { file, altText };
}

/** The API's address from `API_HOST` and `API_PORT`, or the names of the missing variables. */
function apiAddress(env: MediaCommandContext["env"]): string | { missing: string[] } {
  const host = env["API_HOST"]?.trim() ?? "";
  const port = env["API_PORT"]?.trim() ?? "";
  const missing = [...(host ? [] : ["API_HOST"]), ...(port ? [] : ["API_PORT"])];
  if (missing.length > 0) return { missing };
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}/v1/media`;
}

/** The refusal an API error body names, or the HTTP status alone when the body has none. */
async function refusalOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    const { code, message } = body.error ?? {};
    if (typeof code === "string" && typeof message === "string") {
      return `${String(response.status)} ${code}: ${message}`;
    }
  } catch {
    // Not a JSON error body; the status says enough.
  }
  return `${String(response.status)} ${response.statusText}`.trim();
}

/**
 * Runs one media maintenance command (`upload <file> [--alt <text>]`) and returns the exit code: 0
 * when the API stored the file (its media id is the last line printed), 1 for an expected failure
 * (missing setting, unreadable or refused file, API refusal, unreachable API), 2 for bad usage.
 * The file is checked against the configured limits first, so a file the route would refuse is not
 * sent; the API still decides. The key is never printed.
 */
export async function runMediaCommand(
  args: readonly string[],
  context: MediaCommandContext,
  output: CommandOutput,
): Promise<number> {
  const parsed = parse(args);
  if (parsed === null) {
    output.err(USAGE);
    return 2;
  }
  const key = context.env[KEY_VARIABLE]?.trim() ?? "";
  if (!key) {
    output.err(`Set ${KEY_VARIABLE} to the owner's API key (\`api-keys create <name>\`).\n`);
    return 1;
  }
  const url = apiAddress(context.env);
  if (typeof url !== "string") {
    output.err(`Set ${url.missing.join(" and ")} to the API's address.\n`);
    return 1;
  }

  const path = resolve(context.cwd, parsed.file);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    const reason = error instanceof Error && "code" in error ? String(error.code) : "unreadable";
    output.err(`Cannot read ${path} (${reason}).\n`);
    return 1;
  }

  const filename = basename(path);
  let mediaType: string;
  try {
    const limits = readMediaLimits(context.env);
    mediaType = checkMediaUpload({ bytes, filename, declaredType: "" }, limits);
  } catch (error) {
    if (error instanceof DomainError) {
      output.err(`Refused ${filename} (${error.code}): ${error.message}\n`);
      return 1;
    }
    output.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mediaType }), filename);
  if (parsed.altText !== null) form.append("altText", parsed.altText);
  let response: Response;
  try {
    response = await context.fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
  } catch {
    output.err(`Could not reach the API at ${url}. Is it running, or the tunnel open?\n`);
    return 1;
  }
  if (response.status !== 201) {
    output.err(`The API refused ${filename}: ${await refusalOf(response)}\n`);
    return 1;
  }
  const media = (await response.json()) as { id: string; mediaType: string; byteSize: number };
  output.out(
    `Stored ${filename} (${media.mediaType}, ${String(media.byteSize)} bytes) as media:\n${media.id}\n`,
  );
  return 0;
}

async function main() {
  process.exitCode = await runMediaCommand(
    process.argv.slice(2),
    {
      env: process.env,
      // pnpm starts the script in apps/api; a relative path names a file where the owner ran it.
      cwd: process.env["INIT_CWD"] ?? process.cwd(),
      fetch: (input, init) => fetch(input, init),
    },
    {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
