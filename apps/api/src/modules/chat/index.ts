/**
 * The visitor chat over HTTP: the cookie-authorised visitor routes, the internal control routes the
 * AI service calls with its own token, and the supervised dispatch of admitted questions.
 */
import type { Hono } from "hono";

import type { ChatDispatch, ChatService } from "@sebela/services";

import type { ApiConfig } from "../../config.js";
import type { ApiEnv } from "../../middleware/context.js";
import type { RateLimits } from "../../middleware/limits.js";
import type { Logger } from "../../middleware/logging.js";
import type { RouteDocumentation } from "../../routing.js";

/** The first-party cookie that carries the visitor's opaque chat identity. */
export const chatCookieName = "sebela_chat";

/** Hands an admitted question to the AI service; never waits for the generation. */
export interface ChatDispatcher {
  dispatch(dispatch: ChatDispatch): void;
}

/** How often the event stream reads the stored state, signs of life and the grace after deadline. */
export interface ChatTiming {
  readonly pollMs: number;
  readonly progressMs: number;
  readonly graceMs: number;
}

export interface ChatRouteOptions {
  readonly chat: ChatService;
  readonly config: ApiConfig;
  readonly limits: RateLimits;
  /** `null` only when the chat is off. */
  readonly dispatcher: ChatDispatcher | null;
  /** Milliseconds since the epoch, for the stream's deadline. */
  readonly now: () => number;
  readonly timing?: Partial<ChatTiming>;
}

/** The documentation of every chat route, in registration order. */
export function chatRouteDocumentation(): RouteDocumentation[] {
  throw new Error(`Not implemented: ${chatCookieName}`);
}

/** Registers the visitor and control routes on `app`. */
export function registerChatRoutes(app: Hono<ApiEnv>, options: ChatRouteOptions): void {
  throw new Error(`Not implemented: ${String(app.routes.length)} ${String(options.now())}`);
}

export interface ChatSupervisorOptions {
  readonly chat: Pick<ChatService, "dispatchRefused" | "interruptOverdue">;
  readonly aiService: { readonly url: string; readonly token: string };
  readonly log: Logger;
  readonly fetch?: typeof globalThis.fetch;
  /** How long after its deadline an unreconciled operation is interrupted. */
  readonly graceMs?: number;
  readonly watchIntervalMs?: number;
  /** The timeout of one dispatch request. */
  readonly timeoutMs?: number;
}

export interface ChatSupervisor extends ChatDispatcher {
  /** Starts the deadline watcher. */
  start(): void;
  /** Stops the watcher and waits for the dispatches in flight. */
  close(): Promise<void>;
}

/** The in-process dispatcher and deadline watcher of the API. */
export function createChatSupervisor(options: ChatSupervisorOptions): ChatSupervisor {
  throw new Error(`Not implemented: ${options.aiService.url}`);
}
