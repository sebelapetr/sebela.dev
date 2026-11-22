import { chatRetentionDaysDefault } from "@sebela/contracts";
import { z } from "zod";

import type { ChallengeVerifier, ChatOptions } from "./types.js";

/** Cloudflare's Siteverify endpoint, the only verification address production accepts. */
export const siteverifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The action the website's chat widget names; any other action is refused. */
const chatAction = "chat";

/** The oldest challenge accepted, as Cloudflare documents a token's lifetime. */
const challengeMaxAgeMs = 300_000;

/** How far ahead of this server's clock a challenge time may be. */
const clockSkewMs = 60_000;

const defaultTimeoutMs = 5_000;

/**
 * Cloudflare's published test secrets (always passes, always fails, token already spent). They
 * answer with hostname `example.com` and no action, so outside production those two checks are
 * skipped for them; production refuses them.
 */
const testSecret = /^[123]x0+AA$/;

const SiteverifyAnswerSchema = z.object({
  success: z.boolean(),
  challenge_ts: z.string().optional(),
  hostname: z.string().optional(),
  action: z.string().optional(),
});

export interface SiteverifyOptions {
  readonly secret: string;
  readonly expectedHostname: string;
  readonly url: string;
  /** Production refuses Cloudflare's test secrets and any address but Siteverify's. */
  readonly production: boolean;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

/**
 * Verifies a Turnstile token with Siteverify: success, the expected hostname, the `chat` action
 * and a challenge at most five minutes old. Any failure — a refusal, a malformed answer, a network
 * error or the timeout — is `false`. Throws at creation for a production bypass.
 */
export function createSiteverifyVerifier(options: SiteverifyOptions): ChallengeVerifier {
  const isTestSecret = testSecret.test(options.secret);
  if (options.production && isTestSecret) {
    throw new Error("Production refuses a Turnstile test secret.");
  }
  if (options.production && options.url !== siteverifyUrl) {
    throw new Error("Production verifies Turnstile tokens with Cloudflare's Siteverify only.");
  }
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;

  return {
    async verify(token, remoteAddress) {
      try {
        const response = await fetcher(options.url, {
          method: "POST",
          body: new URLSearchParams({
            secret: options.secret,
            response: token,
            remoteip: remoteAddress,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return false;
        const answer = SiteverifyAnswerSchema.safeParse(await response.json());
        if (!answer.success || !answer.data.success) return false;
        const issuedAt = Date.parse(answer.data.challenge_ts ?? "");
        const age = now().getTime() - issuedAt;
        if (Number.isNaN(issuedAt) || age > challengeMaxAgeMs || age < -clockSkewMs) return false;
        if (isTestSecret) return true;
        return (
          answer.data.hostname === options.expectedHostname && answer.data.action === chatAction
        );
      } catch {
        return false;
      }
    },
  };
}

const chatSettings = [
  "API_CHAT_FINGERPRINT_KEY",
  "API_CHAT_RETENTION_DAYS",
  "API_CHAT_MODEL",
  "API_CHAT_PRICING_VERSION",
  "API_TURNSTILE_SECRET_KEY",
  "API_TURNSTILE_EXPECTED_HOSTNAME",
  "API_TURNSTILE_VERIFY_URL",
] as const;

const hostnamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const labelPattern = /^[\x21-\x7e]{1,100}$/;

function verifyAddress(value: string): string | null {
  if (value === "") return siteverifyUrl;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The chat's settings: the fingerprint key (at least 32 characters), the retention in days
 * (default 730), the bound model and pricing version, and the Turnstile secret, expected hostname
 * and verification address (default Siteverify). `STORAGE_ENVIRONMENT=production` refuses test
 * secrets and another verification address. `null` when no chat setting is given — the chat is
 * off; a partial or invalid set throws, naming the settings.
 */
export function readChatOptions(
  env: Readonly<Record<string, string | undefined>>,
): ChatOptions | null {
  const value = (name: (typeof chatSettings)[number]) => env[name]?.trim() ?? "";
  if (chatSettings.every((name) => value(name) === "")) return null;

  const production = env["STORAGE_ENVIRONMENT"]?.trim() === "production";
  const invalid: string[] = [];
  const fingerprintKey = value("API_CHAT_FINGERPRINT_KEY");
  if (fingerprintKey.length < 32) invalid.push("API_CHAT_FINGERPRINT_KEY");
  const retention = value("API_CHAT_RETENTION_DAYS");
  const retentionDays = retention === "" ? chatRetentionDaysDefault : Number(retention);
  if (!/^\d*$/.test(retention) || !Number.isSafeInteger(retentionDays) || retentionDays < 1) {
    invalid.push("API_CHAT_RETENTION_DAYS");
  }
  const model = value("API_CHAT_MODEL");
  if (!labelPattern.test(model)) invalid.push("API_CHAT_MODEL");
  const pricingVersion = value("API_CHAT_PRICING_VERSION");
  if (!labelPattern.test(pricingVersion)) invalid.push("API_CHAT_PRICING_VERSION");
  const secret = value("API_TURNSTILE_SECRET_KEY");
  if (secret === "" || (production && testSecret.test(secret))) {
    invalid.push("API_TURNSTILE_SECRET_KEY");
  }
  const expectedHostname = value("API_TURNSTILE_EXPECTED_HOSTNAME");
  if (!hostnamePattern.test(expectedHostname)) invalid.push("API_TURNSTILE_EXPECTED_HOSTNAME");
  const url = verifyAddress(value("API_TURNSTILE_VERIFY_URL"));
  if (url === null || (production && url !== siteverifyUrl)) {
    invalid.push("API_TURNSTILE_VERIFY_URL");
  }
  if (invalid.length > 0 || url === null) {
    throw new Error(
      `Invalid chat configuration: set ${invalid.join(", ")} (documented in .env.example)`,
    );
  }
  return {
    config: { fingerprintKey, retentionDays, model, pricingVersion },
    verifier: createSiteverifyVerifier({ secret, expectedHostname, url, production }),
  };
}
