// Starts the real chat path for the browser tests: the built website, the API's end-to-end server
// with the visitor chat on, the AI service with its fictional model (no provider, no cost), and a
// local stand-in for Cloudflare's Siteverify. The website relays with its token and trusts one
// proxy hop, as in production, so a test names a visitor's address in `X-Forwarded-For`. The browser loads a stand-in of Turnstile's script
// (`e2e/turnstile-fake.ts`). The same pattern as the AI service's C01 stack test
// (`apps/ai-service/tests/integration/test_chat_stack.py`); nothing here carries a port or host.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { test } from "@playwright/test";

import { fakeTurnstile } from "./turnstile-fake";
import {
  fixtureFolder,
  freePort,
  origin,
  required,
  start,
  startApi,
  startWebsite,
  type Fixture,
  type Started,
  type WebsiteOptions,
} from "./stack";

const run = promisify(execFile);

const serviceFolder = fileURLToPath(new URL("../../ai-service", import.meta.url));
const scratch = fileURLToPath(new URL("../../../.tmp", import.meta.url));

/**
 * The chat's seed: the agent evals' fictional profile, whose person ("Ilsa Marrow") the fictional
 * model's answers name and cite.
 */
const chatSeed = fileURLToPath(
  new URL("../../../packages/llm-agent/evals/datasets/fixtures/profile", import.meta.url),
);

/** The public site key the website renders the person check with; the stand-in accepts any. */
export const chatSiteKey = "e2e-chat-site-key";

/** How the fictional model behaves (`AI_SERVICE_FAKE_SCENARIO`). */
export type ChatScenario = "answer" | "slow" | "refuse" | "fail";

export interface ChatStackOptions {
  /** `answer` by default; `slow` waits for `openGate()` before it goes on. */
  readonly scenario?: ChatScenario;
  /** A daily spend limit below one question's allowance exhausts the budget. */
  readonly dailySpendLimitMicroUsd?: number;
  /**
   * The website's fixture instead of the chat's own fictional profile, for a page that must fit
   * its content; the fictional model still answers about the chat's person.
   */
  readonly fixture?: Fixture;
  /** The website's analytics settings (`WEB_ANALYTICS_*`), such as a local stand-in's; none by default. */
  readonly analytics?: WebsiteOptions["analytics"];
}

/** One call the fictional model received: its stage and how many earlier exchanges it was given. */
export interface ModelCall {
  readonly stage: string;
  readonly history: number;
}

export interface ChatStack {
  /** The website's origin. */
  readonly url: string;
  readonly apiUrl: string;
  /** The model calls so far. */
  calls(): Promise<readonly ModelCall[]>;
  /** The person-check tokens the API redeemed so far, in order. */
  redeemed(): readonly string[];
  /** The visitor address (`remoteip`) sent with each redeemed token, null for none, in order. */
  remoteAddresses(): readonly (string | null)[];
  /** Lets `slow` generations go on, the waiting ones and every later one. */
  openGate(): Promise<void>;
  /** Makes later `slow` generations wait again, until the gate is opened. */
  closeGate(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Siteverify for the website's host: a token starting `fail` is refused, any other passes for the
 * `chat` action. Records every token it is asked about and the visitor address sent with it.
 */
async function startSiteverify(
  host: string,
  hostname: string,
): Promise<Started & { readonly tokens: string[]; readonly addresses: (string | null)[] }> {
  const tokens: string[] = [];
  const addresses: (string | null)[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      const token = form.get("response") ?? "";
      tokens.push(token);
      addresses.push(form.get("remoteip"));
      const answer = token.startsWith("fail")
        ? { success: false, "error-codes": ["invalid-input-response"] }
        : { success: true, hostname, action: "chat", challenge_ts: new Date().toISOString() };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(answer));
    });
  });
  server.listen(0, host);
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No Siteverify address");
  return {
    url: origin(host, address.port),
    tokens,
    addresses,
    stop: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

/** The agent's model and pricing version, which the API records with each answer's spend. */
async function agentVersions(): Promise<{ readonly model: string; readonly pricing: string }> {
  const { stdout } = await run(
    "uv",
    [
      "run",
      "--locked",
      "python",
      "-c",
      "import json; from llm_agent import versions; v = versions(); " +
        "print(json.dumps({'model': v.main_model, 'pricing': v.pricing}))",
    ],
    { cwd: serviceFolder },
  );
  return JSON.parse(stdout) as { model: string; pricing: string };
}

const token = () => randomBytes(32).toString("base64url");

/** Starts the stack; stop it after the tests (it drops its database and removes its files). */
export async function startChatStack(options: ChatStackOptions = {}): Promise<ChatStack> {
  const webHost = required("WEB_HOST");
  const apiHost = required("API_HOST");
  const serviceHost = required("AI_SERVICE_HOST");
  const webPort = await freePort(webHost);
  const webUrl = origin(webHost, webPort);
  const apiPort = await freePort(apiHost);
  const apiUrl = origin(apiHost, apiPort);
  const servicePort = await freePort(serviceHost);
  const serviceUrl = origin(serviceHost, servicePort);

  await mkdir(scratch, { recursive: true });
  const folder = await mkdtemp(join(scratch, "e2e-chat-"));
  const callsFile = join(folder, "calls.jsonl");
  const gateFile = join(folder, "gate");
  const serviceToken = token();
  const controlToken = token();
  const relayToken = token();

  const started: Started[] = [];
  const stop = async () => {
    for (const child of started.reverse()) await child.stop();
    await rm(folder, { recursive: true, force: true });
  };
  try {
    const siteverify = await startSiteverify(apiHost, webHost);
    started.push(siteverify);
    const versions = await agentVersions();
    started.push(
      await startApi("with-photo", {
        port: apiPort,
        seedFolder: options.fixture === undefined ? chatSeed : fixtureFolder(options.fixture),
        env: {
          API_CHAT_ALLOWED_ORIGINS: webUrl,
          API_CHAT_COOKIE_SECURE: "false",
          API_CHAT_FINGERPRINT_KEY: token(),
          API_CHAT_RETENTION_DAYS: "",
          API_CHAT_MODEL: versions.model,
          API_CHAT_PRICING_VERSION: versions.pricing,
          API_CHAT_RELAY_TOKEN: relayToken,
          // Not a Turnstile test secret, so the host name and action checks run as in production.
          API_TURNSTILE_SECRET_KEY: token(),
          API_TURNSTILE_EXPECTED_HOSTNAME: webHost,
          API_TURNSTILE_VERIFY_URL: `${siteverify.url}/siteverify`,
          API_AI_SERVICE_URL: serviceUrl,
          API_AI_SERVICE_TOKEN: serviceToken,
          API_AI_CONTROL_TOKEN: controlToken,
          API_E2E_CHAT_DAILY_SPEND_LIMIT_MICRO_USD:
            options.dailySpendLimitMicroUsd === undefined
              ? ""
              : String(options.dailySpendLimitMicroUsd),
        },
      }),
    );
    // The service reads its settings from the environment only: none of the checkout's own.
    const hidden = Object.fromEntries(
      Object.keys(process.env)
        .filter((name) => /^(AI_SERVICE_|LLM_AGENT_|ANTHROPIC_)/.test(name))
        .map((name) => [name, ""]),
    );
    started.push(
      await start(
        { command: "uv run --locked python -m ai_service", cwd: serviceFolder },
        {
          ...hidden,
          AI_SERVICE_HOST: serviceHost,
          LLM_AGENT_PORT: String(servicePort),
          AI_SERVICE_API_URL: apiUrl,
          AI_SERVICE_TOKEN: serviceToken,
          AI_SERVICE_CONTROL_TOKEN: controlToken,
          AI_SERVICE_MODEL: "fake",
          AI_SERVICE_FAKE_SCENARIO: options.scenario ?? "answer",
          AI_SERVICE_FAKE_CALLS_FILE: callsFile,
          AI_SERVICE_FAKE_GATE_FILE: gateFile,
        },
        serviceUrl,
        "/health",
      ),
    );
    started.push(
      await startWebsite(apiUrl, {
        port: webPort,
        chatSiteKey,
        chatRelayToken: relayToken,
        trustedProxyHops: 1,
        ...(options.analytics === undefined ? {} : { analytics: options.analytics }),
      }),
    );
    return {
      url: webUrl,
      apiUrl,
      async calls() {
        let text: string;
        try {
          text = await readFile(callsFile, "utf8");
        } catch {
          return [];
        }
        return text
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => JSON.parse(line) as ModelCall);
      },
      redeemed: () => [...siteverify.tokens],
      remoteAddresses: () => [...siteverify.addresses],
      openGate: () => writeFile(gateFile, "open"),
      closeGate: () => rm(gateFile, { force: true }),
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

/**
 * Serves one chat stack to the tests of the enclosing block and the Turnstile stand-in to each
 * test's page. Every page of a test is one visitor; the block's tests name no address, so they
 * share the unknown one, whose allowance (20 questions a minute) the block stays below.
 */
export function serveChatStack(options: ChatStackOptions = {}): () => ChatStack {
  let stack: ChatStack | undefined;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    stack = await startChatStack(options);
  });
  test.afterAll(async () => {
    await stack?.stop();
  });
  test.beforeEach(async ({ page }) => {
    await fakeTurnstile(page);
  });
  return () => {
    if (stack === undefined) throw new Error("chat stack not started");
    return stack;
  };
}
