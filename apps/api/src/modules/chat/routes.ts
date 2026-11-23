import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import type { Context, Hono, MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { getCookie } from "hono/cookie";
import { z } from "zod";

import {
  ChatCompactionResponseSchema,
  ChatCompactionResultSchema,
  ChatCompactionSubmissionSchema,
  ChatConversationClearedSchema,
  ChatConversationClearSchema,
  ChatConversationQuerySchema,
  ChatConversationSchema,
  ChatGenerationResultSchema,
  ChatGrantClaimedSchema,
  ChatGrantClaimSchema,
  ChatMessageSubmissionSchema,
  ChatOperationSchema,
  ChatRetrySubmissionSchema,
  ChatUsageSchema,
  type ChatCompactionSubmission,
  type ChatConversationClear,
  type ChatGrantClaim,
  type ChatMessageSubmission,
  type ChatRetrySubmission,
} from "@sebela/contracts";
import type {
  ChatCaller,
  ChatCompactionDispatch,
  ChatDispatch,
  ChatReconcileOutcome,
  ChatService,
  ChatSubmitResult,
} from "@sebela/services";

import type { ApiConfig, ChatHttpConfig } from "../../config.js";
import { refuseCredentialsInUrl } from "../../middleware/authentication.js";
import type { ApiEnv } from "../../middleware/context.js";
import { ApiError } from "../../middleware/errors.js";
import { jsonBody } from "../../middleware/json-body.js";
import type { RateLimits } from "../../middleware/limits.js";
import { pathParams } from "../../middleware/path-params.js";
import type { RouteDocumentation } from "../../routing.js";
import { chatEventStream, defaultChatTiming, lastEventIdOf, type ChatTiming } from "./stream.js";

/** The first-party cookie that carries the visitor's opaque chat identity. */
export const chatCookieName = "sebela_chat";

/** Hands an admitted question or compaction to the AI service; never waits for the run. */
export interface ChatDispatcher {
  dispatch(dispatch: ChatDispatch | ChatCompactionDispatch): void;
  /** Tells the AI service to stop a claimed generation; never waits and never fails the caller. */
  cancel(operationId: string): void;
}

export interface ChatRouteOptions {
  readonly chat: ChatService;
  readonly config: ApiConfig;
  readonly limits: RateLimits;
  /** `null` only when the chat is off. */
  readonly dispatcher: ChatDispatcher | null;
  /** Milliseconds since the epoch, for the stream's deadline and `Retry-After`. */
  readonly now: () => number;
  readonly timing?: Partial<ChatTiming>;
}

const OperationParamsSchema = z.object({ operationId: z.uuid() });
const StreamHeadersSchema = z.object({
  "last-event-id": z.string().optional().meta({
    description: "The last chat event ID the client received; later events follow.",
  }),
});
/** The header that carries the website relay's token on every visitor route; never logged. */
export const chatRelayHeader = "x-sebela-chat-relay";
/** The visitor's address as the website relay derived it; believed only with the relay token. */
export const chatClientHeader = "x-sebela-chat-client";

const relayRefusal = "`forbidden`: the request does not come through the website's chat relay";
const unavailableRefusal = "`unavailable`: the chat is off or its database cannot be reached.";

const cookie = {
  name: chatCookieName,
  description:
    "The visitor's opaque chat identity. A missing, unknown or forged value gets a fresh identity.",
};

const visitorRoutes = {
  conversation: {
    operationId: "getChatConversation",
    method: "GET",
    path: "/v1/chat/conversation",
    access: "public",
    summary: "Read the visitor's chat conversation",
    description:
      "The caller's one conversation, newest messages first in pages, with its active operation. " +
      "The caller is the chat cookie; a request without one gets a new identity. Never cached.",
    query: ChatConversationQuerySchema,
    cookie,
    response: { status: 200, description: "The conversation.", schema: ChatConversationSchema },
    errors: [],
    refusals: { 403: `${relayRefusal}.`, 503: unavailableRefusal },
  },
  ask: {
    operationId: "askChat",
    method: "POST",
    path: "/v1/chat/conversation/messages",
    access: "public",
    summary: "Ask the chat a question",
    description:
      "The one public write: the caller asks one question of their own conversation behind the " +
      "bot challenge, the per-visitor quotas and the global spend budget. The request is sent by " +
      "the website's server from an allowed origin; the visitor's address for the quotas and the " +
      "challenge is the one the website's relay names, if any. Admission returns at once; the answer is " +
      "generated detached from the request and read from the operation's events.",
    sameOrigin: true,
    cookie,
    body: ChatMessageSubmissionSchema,
    response: {
      status: 202,
      description: "The question is admitted.",
      also: { status: 200, description: "The same request again: its existing operation." },
      schema: ChatOperationSchema,
    },
    errors: [],
    refusals: {
      403:
        `${relayRefusal}, has no allowed origin or is not JSON; ` +
        "`chat_challenge_failed`: the bot challenge failed.",
      409:
        "`chat_request_conflict`: the request ID was used for another question; " +
        "`chat_busy`: the conversation already has a question in progress.",
      429: "`chat_quota_exceeded`: the visitor's question quota is spent.",
      503: `\`chat_budget_exhausted\`: the chat's spend budget is spent; ${unavailableRefusal}`,
    },
  },
  compact: {
    operationId: "compactChatConversation",
    method: "POST",
    path: "/v1/chat/conversation/compact",
    access: "public",
    summary: "Compact the visitor's working context",
    description:
      "The visitor's `/compact`: summarizes the caller's current working context (the previous " +
      "summary and the exchanges since it) so later questions carry less history. It is no " +
      "message, appends nothing and changes no visible history. A context of fewer than three " +
      "exchanges is a local no-op before any challenge, quota or spend. Otherwise the bot " +
      "challenge, the quotas and the spend budget apply as to a question, and it holds the " +
      "conversation as a question does; its progress is read from the operation, from any tab. " +
      "The same request ID again is recovered before any challenge. Never retried automatically.",
    sameOrigin: true,
    cookie,
    body: ChatCompactionSubmissionSchema,
    response: {
      status: 202,
      description: "The compaction is admitted: its operation.",
      also: {
        status: 200,
        description: "The same request again (its operation), or a local no-op.",
      },
      schema: ChatCompactionResponseSchema,
    },
    errors: [],
    refusals: {
      403:
        `${relayRefusal}, has no allowed origin or is not JSON; ` +
        "`chat_challenge_failed`: the bot challenge failed.",
      409:
        "`chat_request_conflict`: the request ID was used for a question; " +
        "`chat_busy`: the conversation already has a question or compaction in progress.",
      429: "`chat_quota_exceeded`: the visitor's question quota is spent.",
      503: `\`chat_budget_exhausted\`: the chat's spend budget is spent; ${unavailableRefusal}`,
    },
  },
  operation: {
    operationId: "getChatOperation",
    method: "GET",
    path: "/v1/chat/operations/:operationId",
    access: "public",
    summary: "Read a chat operation",
    description: "One of the caller's operations and its status. Never cached.",
    params: OperationParamsSchema,
    cookie,
    response: { status: 200, description: "The operation.", schema: ChatOperationSchema },
    errors: ["not_found"],
    refusals: { 403: `${relayRefusal}.`, 503: unavailableRefusal },
  },
  events: {
    operationId: "streamChatOperation",
    method: "GET",
    path: "/v1/chat/operations/:operationId/events",
    access: "public",
    summary: "Stream a chat operation's events",
    description:
      "Server-sent events of one of the caller's operations. Each `chat` event carries a " +
      "`ChatStreamEvent` with its event ID; a reconnect with `Last-Event-ID` continues after it " +
      "with the same IDs. While the operation runs, a `progress` event without an ID carries a " +
      "`ChatProgress` at least every five seconds. The stream ends at the terminal event, or after " +
      "the deadline and a short grace with a retryable `timeout` error.",
    params: OperationParamsSchema,
    headers: StreamHeadersSchema,
    cookie,
    response: {
      status: 200,
      description: "The event stream.",
      mediaType: "text/event-stream",
    },
    errors: ["not_found"],
    refusals: { 403: `${relayRefusal}.`, 503: unavailableRefusal },
  },
  usage: {
    operationId: "getChatUsage",
    method: "GET",
    path: "/v1/chat/usage",
    access: "public",
    summary: "Read the visitor's chat usage and limits",
    description:
      "The caller's own meters (questions in the rolling two hours and the UTC day), the " +
      "restriction a new question would meet now and when it may pass again, the effective main " +
      "model and effort, the active operation and the conversation's last measured main-call " +
      "input against its cap. Reading consumes nothing and admits nothing; the meters are " +
      "informative, admission decides alone. Never another visitor's counts or the site's spend. " +
      "Never cached.",
    cookie,
    response: { status: 200, description: "The usage snapshot.", schema: ChatUsageSchema },
    errors: [],
    refusals: { 403: `${relayRefusal}.`, 503: unavailableRefusal },
  },
  stop: {
    operationId: "stopChatOperation",
    method: "POST",
    path: "/v1/chat/operations/:operationId/stop",
    access: "public",
    summary: "Stop a chat operation",
    description:
      "Stops one of the caller's operations from any tab, without a new bot challenge: an active " +
      "operation ends as a retryable `cancelled` error, and a generation that claimed its grant " +
      "is told to stop. Its reserved cost stays until the generation reports what it spent. An " +
      "operation that already ended is returned as it is.",
    sameOrigin: true,
    params: OperationParamsSchema,
    cookie,
    response: {
      status: 200,
      description: "The operation, cancelled or as it ended.",
      schema: ChatOperationSchema,
    },
    errors: ["not_found"],
    refusals: {
      403: `${relayRefusal} or has no allowed origin.`,
      503: unavailableRefusal,
    },
  },
  retry: {
    operationId: "retryChatOperation",
    method: "POST",
    path: "/v1/chat/operations/:operationId/retry",
    access: "public",
    summary: "Retry a failed chat answer",
    description:
      "Asks the question of one of the caller's failed attempts again as a new attempt of the " +
      "same request, keyed by its own retry ID, and replaces only the failed answer. The same " +
      "retry ID again, or an attempt of that request that is active or answered, is recovered " +
      "before any challenge, quota or spend. Otherwise the bot challenge, the quotas and the " +
      "spend budget apply as to a question.",
    sameOrigin: true,
    params: OperationParamsSchema,
    cookie,
    body: ChatRetrySubmissionSchema,
    response: {
      status: 202,
      description: "The retry is admitted.",
      also: { status: 200, description: "The retry or the attempt recovered: its operation." },
      schema: ChatOperationSchema,
    },
    errors: ["not_found"],
    refusals: {
      403:
        `${relayRefusal}, has no allowed origin or is not JSON; ` +
        "`chat_challenge_failed`: the bot challenge failed.",
      409:
        "`chat_request_conflict`: the retry ID was used for another attempt; " +
        "`chat_busy`: the conversation already has a question in progress; " +
        "`chat_not_retryable`: the attempt did not end with a retryable failure of the latest " +
        "question.",
      429: "`chat_quota_exceeded`: the visitor's question quota is spent.",
      503: `\`chat_budget_exhausted\`: the chat's spend budget is spent; ${unavailableRefusal}`,
    },
  },
  clear: {
    operationId: "clearChatConversation",
    method: "DELETE",
    path: "/v1/chat/conversation",
    access: "public",
    summary: "Clear the visitor's chat conversation",
    description:
      "Deletes the caller's conversation when the body names it, as the visitor confirmed: " +
      "active work is cancelled, messages are deleted, late results are refused and a fresh empty " +
      "conversation of the same identity starts. Quotas and spend stay. Any other conversation ID " +
      "clears nothing and returns the caller's conversation unchanged; a URL is never a delete " +
      "credential. `telemetryDeletion` is `pending` while exported telemetry still awaits deletion.",
    sameOrigin: true,
    cookie,
    body: ChatConversationClearSchema,
    response: {
      status: 200,
      description: "Whether the conversation was cleared, and the caller's conversation now.",
      schema: ChatConversationClearedSchema,
    },
    errors: [],
    refusals: {
      403: `${relayRefusal}, has no allowed origin or is not JSON.`,
      503: unavailableRefusal,
    },
  },
} satisfies Record<string, RouteDocumentation>;

const controlRoutes = {
  claim: {
    operationId: "claimChatGrant",
    method: "POST",
    path: "/v1/internal/chat/grants/claim",
    access: "private",
    authorization: "control",
    summary: "Claim a chat generation grant",
    description:
      "Internal: the AI service claims an operation's one-use grant before it spends anything, " +
      "and learns what the generation is bound to.",
    body: ChatGrantClaimSchema,
    response: { status: 200, description: "The grant is claimed.", schema: ChatGrantClaimedSchema },
    errors: [],
    refusals: {
      403: "`forbidden`: the grant is not the operation's.",
      409: "`conflict`: the grant was claimed already, or the operation is over.",
    },
  },
  result: {
    operationId: "reportChatResult",
    method: "POST",
    path: "/v1/internal/chat/operations/:operationId/result",
    access: "private",
    authorization: "control",
    summary: "Report a chat generation result",
    description:
      "Internal: the AI service reports the one result of a claimed operation. A result that " +
      "fails the contract is stored as an internal failure, never as an answer; a repeat changes " +
      "nothing and answers the stored operation.",
    params: OperationParamsSchema,
    body: ChatGenerationResultSchema,
    response: {
      status: 200,
      description: "The operation as reconciled.",
      schema: ChatOperationSchema,
    },
    errors: [],
    refusals: {
      403: "`forbidden`: the grant is not the operation's, or the operation is a compaction.",
      409: "`conflict`: the operation's grant has not been claimed, or its conversation was cleared.",
    },
  },
  compaction: {
    operationId: "reportChatCompaction",
    method: "POST",
    path: "/v1/internal/chat/operations/:operationId/compaction",
    access: "private",
    authorization: "control",
    summary: "Report a chat compaction result",
    description:
      "Internal: the AI service reports the one result of a claimed compaction. A valid summary " +
      "is installed only at the operation's context revision; a stale, failed or invalid result " +
      "keeps the working context unchanged. A result that fails the contract is stored as a " +
      "failure; a repeat changes nothing and answers the stored operation.",
    params: OperationParamsSchema,
    body: ChatCompactionResultSchema,
    response: {
      status: 200,
      description: "The operation as reconciled.",
      schema: ChatOperationSchema,
    },
    errors: [],
    refusals: {
      403: "`forbidden`: the grant is not the operation's, or the operation is an answer.",
      409: "`conflict`: the operation's grant has not been claimed, or its conversation was cleared.",
    },
  },
} satisfies Record<string, RouteDocumentation>;

/** The documentation of every chat route, in registration order. */
export function chatRouteDocumentation(): RouteDocumentation[] {
  return [...Object.values(visitorRoutes), ...Object.values(controlRoutes)];
}

const digest = (value: string) => createHash("sha256").update(value).digest();
const BEARER = /^Bearer +(\S+)$/i;
const isJson = (c: Context) =>
  c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/json";

const validationFailed = (message: string, issues: readonly z.core.$ZodIssue[]) =>
  new ApiError(
    400,
    "validation_failed",
    message,
    issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
  );

/**
 * Registers the visitor and control routes on `app`. Visitor routes answer `unavailable` while the
 * chat is off and `forbidden` without the website relay's token, compared in constant time; every
 * visitor answer is `no-store`, and carries a new cookie when one was issued.
 * Control routes accept only the control token, compared in constant time.
 */
export function registerChatRoutes(app: Hono<ApiEnv>, options: ChatRouteOptions): void {
  const { chat, config, limits, now } = options;
  const http: ChatHttpConfig | null = config.chat;
  const timing: ChatTiming = { ...defaultChatTiming, ...options.timing };
  const dispatcher = options.dispatcher;
  if (http !== null && dispatcher === null) {
    throw new Error("The chat is configured without a dispatcher.");
  }
  const controlDigest = http === null ? null : digest(http.controlToken);
  const relayDigest = http === null ? null : digest(http.relayToken);

  const available: MiddlewareHandler<ApiEnv> = async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (http === null) {
      throw new ApiError(503, "unavailable", "The chat is not available.");
    }
    await next();
  };

  const fromRelay = (c: Context<ApiEnv>) => {
    const presented = c.req.header(chatRelayHeader);
    return (
      relayDigest !== null &&
      presented !== undefined &&
      timingSafeEqual(digest(presented), relayDigest)
    );
  };

  /** The visitor's address as the relay named it: one IP literal, or null when it named none. */
  const namedAddress = (c: Context<ApiEnv>) => {
    const named = c.req.header(chatClientHeader) ?? "";
    return isIP(named) === 0 ? null : named;
  };

  /**
   * Whom a visitor request is counted against: with the relay token, the visitor the relay names
   * (relayed requests naming none share one bucket), never the website's own connection; without
   * it, the connection, as every other public route.
   */
  const relayedVisitor = (c: Context<ApiEnv>) =>
    fromRelay(c) ? `chat-visitor:${namedAddress(c) ?? "unknown"}` : null;

  /** Only the website's chat relay reaches the visitor routes; checked before any state change. */
  const relayed: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (!fromRelay(c)) {
      throw new ApiError(403, "forbidden", "Ask through the website.");
    }
    await next();
  };

  /** A browser write: from an allowed origin, and JSON when it carries a body. */
  const sameOrigin =
    (withBody: boolean): MiddlewareHandler<ApiEnv> =>
    async (c, next) => {
      const origin = c.req.header("origin");
      if (
        origin === undefined ||
        !http?.allowedOrigins.includes(origin) ||
        (withBody && !isJson(c))
      ) {
        throw new ApiError(403, "forbidden", "Ask from the website.");
      }
      await next();
    };

  const visitor = (route: RouteDocumentation): MiddlewareHandler<ApiEnv> =>
    every(
      limits.perClient("public", relayedVisitor),
      refuseCredentialsInUrl,
      available,
      relayed,
      ...(route.sameOrigin ? [sameOrigin(route.body !== undefined)] : []),
      ...(route.body ? jsonBody(route.body, config.bodyLimitBytes) : []),
      ...(route.params ? [pathParams(route.params)] : []),
    );

  /** Resolves the caller from the cookie; a new identity's cookie is set on every answer. */
  const open = async (
    c: Context<ApiEnv>,
  ): Promise<{ caller: ChatCaller; setCookie: string | null }> => {
    const opened = await chat.open(getCookie(c, chatCookieName) ?? null);
    if (opened.cookie === null) return { caller: opened.caller, setCookie: null };
    // Built by hand: Hono refuses a Max-Age over 400 days, and the retention may be longer.
    const maxAge = String(chat.retentionDays * 86_400);
    const secure = http?.cookieSecure === true ? "; Secure" : "";
    const setCookie = `${chatCookieName}=${opened.cookie}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
    c.header("Set-Cookie", setCookie);
    return { caller: opened.caller, setCookie };
  };
  const callerOf = async (c: Context<ApiEnv>) => (await open(c)).caller;

  const operationIdOf = (c: Context<ApiEnv>) =>
    (c.get("params") as z.infer<typeof OperationParamsSchema>).operationId;

  app.get(visitorRoutes.conversation.path, visitor(visitorRoutes.conversation), async (c) => {
    const query = ChatConversationQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      throw validationFailed("Some query parameters are invalid.", query.error.issues);
    }
    const caller = await callerOf(c);
    return c.json(await chat.conversation(caller, query.data), 200);
  });

  /** The answer to an admission of a question or a retry: dispatched, recovered or refused. */
  const admission = (c: Context<ApiEnv>, result: ChatSubmitResult) => {
    switch (result.status) {
      case "admitted":
        dispatcher?.dispatch(result.dispatch);
        return c.json(result.operation, 202);
      case "existing":
        return c.json(result.operation, 200);
      case "conflict":
        throw new ApiError(
          409,
          "chat_request_conflict",
          "This request ID was used for another question.",
        );
      case "busy":
        throw new ApiError(409, "chat_busy", "A question is already in progress.");
      case "challenge_failed":
        throw new ApiError(403, "chat_challenge_failed", "The bot challenge failed.");
      case "quota_exceeded": {
        const seconds = Math.max(1, Math.ceil((result.retryAt.getTime() - now()) / 1000));
        throw new ApiError(
          429,
          "chat_quota_exceeded",
          "Too many questions; retry later.",
          undefined,
          { "Retry-After": String(seconds) },
        );
      }
      case "budget_exhausted":
        throw new ApiError(503, "chat_budget_exhausted", "The chat cannot answer more today.");
    }
  };

  app.post(visitorRoutes.ask.path, visitor(visitorRoutes.ask), async (c) => {
    const caller = await callerOf(c);
    const submission = c.get("body") as ChatMessageSubmission;
    // Behind the relay token, so the website named it; anything but one IP literal is unknown.
    const result = await chat.submit(caller, submission, { clientAddress: namedAddress(c) });
    return admission(c, result);
  });

  app.post(visitorRoutes.compact.path, visitor(visitorRoutes.compact), async (c) => {
    const caller = await callerOf(c);
    const submission = c.get("body") as ChatCompactionSubmission;
    const result = await chat.compact(caller, submission, { clientAddress: namedAddress(c) });
    switch (result.status) {
      case "started":
        dispatcher?.dispatch(result.dispatch);
        return c.json({ status: "started" as const, operation: result.operation }, 202);
      case "existing":
        return c.json({ status: "started" as const, operation: result.operation }, 200);
      case "noop":
        return c.json(result, 200);
      default:
        return admission(c, result);
    }
  });

  app.post(visitorRoutes.retry.path, visitor(visitorRoutes.retry), async (c) => {
    const caller = await callerOf(c);
    const submission = c.get("body") as ChatRetrySubmission;
    const result = await chat.retry(caller, operationIdOf(c), submission, {
      clientAddress: namedAddress(c),
    });
    switch (result.status) {
      case "not_found":
        throw new ApiError(404, "not_found", "There is no such operation.");
      case "not_retryable":
        throw new ApiError(409, "chat_not_retryable", "This answer cannot be retried.");
      default:
        return admission(c, result);
    }
  });

  app.post(visitorRoutes.stop.path, visitor(visitorRoutes.stop), async (c) => {
    const caller = await callerOf(c);
    const outcome = await chat.stop(caller, operationIdOf(c));
    if (outcome === null) throw new ApiError(404, "not_found", "There is no such operation.");
    if (outcome.status === "stopped" && outcome.running)
      dispatcher?.cancel(outcome.operation.operationId);
    return c.json(outcome.operation, 200);
  });

  app.delete(visitorRoutes.clear.path, visitor(visitorRoutes.clear), async (c) => {
    const caller = await callerOf(c);
    const outcome = await chat.clear(caller, c.get("body") as ChatConversationClear);
    for (const operationId of outcome.cancelled) dispatcher?.cancel(operationId);
    return c.json(outcome.cleared, 200);
  });

  app.get(visitorRoutes.operation.path, visitor(visitorRoutes.operation), async (c) => {
    const caller = await callerOf(c);
    const operation = await chat.operation(caller, operationIdOf(c));
    if (operation === null) throw new ApiError(404, "not_found", "There is no such operation.");
    return c.json(operation, 200);
  });

  app.get(visitorRoutes.events.path, visitor(visitorRoutes.events), async (c) => {
    const { caller, setCookie } = await open(c);
    const first = await chat.observe(caller, operationIdOf(c));
    if (first === null) throw new ApiError(404, "not_found", "There is no such operation.");
    return chatEventStream({
      chat,
      caller,
      first,
      lastEventId: lastEventIdOf(c.req.header("last-event-id")),
      now,
      timing,
      headers: setCookie === null ? {} : { "set-cookie": setCookie },
    });
  });

  app.get(visitorRoutes.usage.path, visitor(visitorRoutes.usage), async (c) => {
    const caller = await callerOf(c);
    return c.json(await chat.usage(caller, { clientAddress: namedAddress(c) }), 200);
  });

  const controlToken: MiddlewareHandler<ApiEnv> = async (c, next) => {
    const presented = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
    if (
      controlDigest === null ||
      presented === undefined ||
      !timingSafeEqual(digest(presented), controlDigest)
    ) {
      throw new ApiError(401, "unauthorized", "A valid control token is required.", undefined, {
        "WWW-Authenticate": "Bearer",
      });
    }
    await next();
  };

  const control = (route: RouteDocumentation, body: z.ZodType): MiddlewareHandler<ApiEnv> =>
    every(
      limits.perClient("private"),
      refuseCredentialsInUrl,
      controlToken,
      ...(route.params ? [pathParams(route.params)] : []),
      ...jsonBody(body, config.bodyLimitBytes),
    );

  app.post(
    controlRoutes.claim.path,
    control(controlRoutes.claim, ChatGrantClaimSchema),
    async (c) => {
      const outcome = await chat.claim(c.get("body") as ChatGrantClaim);
      switch (outcome.status) {
        case "claimed":
          return c.json(outcome.claimed, 200);
        case "refused":
          throw new ApiError(409, "conflict", "The grant cannot be claimed.");
        case "wrong_grant":
          throw new ApiError(403, "forbidden", "The grant is not the operation's.");
      }
    },
  );

  /** The answer to a reported result of either kind. */
  const reconciled = (c: Context<ApiEnv>, outcome: ChatReconcileOutcome) => {
    switch (outcome.status) {
      case "reconciled":
      case "already":
        return c.json(outcome.operation, 200);
      case "wrong_grant":
        throw new ApiError(403, "forbidden", "The grant is not the operation's.");
      case "not_claimed":
        throw new ApiError(409, "conflict", "The operation's grant has not been claimed.");
      case "deleted":
        throw new ApiError(409, "conflict", "The operation's conversation was cleared.");
      case "invalid":
        throw new ApiError(400, "validation_failed", "The result names no grant.");
    }
  };

  app.post(controlRoutes.result.path, control(controlRoutes.result, z.unknown()), async (c) =>
    reconciled(c, await chat.reconcile(operationIdOf(c), c.get("body"))),
  );

  app.post(
    controlRoutes.compaction.path,
    control(controlRoutes.compaction, z.unknown()),
    async (c) => reconciled(c, await chat.reconcileCompaction(operationIdOf(c), c.get("body"))),
  );
}
