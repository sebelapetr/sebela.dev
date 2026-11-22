import { createHash, createHmac, randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import {
  ChatAssistantMessageSchema,
  ChatGenerationResultSchema,
  ChatSourceSchema,
  chatGrantMaxLength,
  chatConversationPageLimit,
  chatHistoryExchangeLimit,
  chatRetentionDaysDefault,
  chatReplayEvents,
  chatTerminalForGeneration,
  type ChatAssistantMessage,
  type ChatConversation,
  type ChatConversationQuery,
  type ChatGenerationResult,
  type ChatMessage,
  type ChatOperation,
  type ChatOperationStatus,
  type ChatProgressStage,
} from "@sebela/contracts";
import type {
  ChatExchangeRecord,
  ChatMessageRecord,
  ChatOperationRecord,
  ChatPersistence,
  ChatResultRecord,
} from "@sebela/db";

import { admissionExpiry, chatPolicy, pragueDate, quotaRules, spendWindows } from "./policy.js";
import type {
  ChatCaller,
  ChatHistoryExchange,
  ChatObservation,
  ChatRetryOutcome,
  ChatService,
  ChatServiceOptions,
  ChatSubmitResult,
} from "./types.js";

const dayMs = 24 * 60 * 60 * 1000;

/**
 * How long a deleted operation's tombstone outlives the clear: far beyond any generation deadline,
 * so a late result or callback is refused and only its measured cost settled.
 */
const tombstoneMs = dayMs;

/** An attempt a retry recovers instead of generating again: still active, or already answered. */
const recoverable = new Set<ChatOperationStatus>(["accepted", "running", "completed"]);

/** How long a running generation reports `checking` before `answering`. */
const checkingMs = 5_000;

/** An opaque cookie value or grant: 32 random bytes, base64url. */
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What an unknown visitor address is fingerprinted as; never a valid address itself. */
const unknownAddressBucket = "unknown";

const newToken = () => randomBytes(32).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const toOperation = (record: ChatOperationRecord): ChatOperation => ({
  operationId: record.id,
  requestId: record.requestId,
  status: record.status,
  deadlineAt: record.deadlineAt.toISOString(),
  assistantMessageId: record.assistantMessageId,
});

/** A stored answer in the contract's shape; the schema guards that nothing else leaves. */
const toAssistant = (record: ChatMessageRecord): ChatAssistantMessage =>
  ChatAssistantMessageSchema.parse({
    id: record.id,
    role: "assistant",
    requestId: record.requestId,
    status: record.status,
    outcome: record.outcome,
    error:
      record.errorCode === null
        ? null
        : { code: record.errorCode, retryable: record.errorRetryable ?? false },
    text: record.text,
    blocks: record.blocks,
    sources: record.sources,
    related: record.related,
    createdAt: record.createdAt.toISOString(),
  });

const toMessage = (record: ChatMessageRecord): ChatMessage =>
  record.role === "user"
    ? {
        id: record.id,
        role: "user",
        requestId: record.requestId,
        text: record.text ?? "",
        createdAt: record.createdAt.toISOString(),
      }
    : toAssistant(record);

/**
 * A stored answered exchange as the AI service accepts it for context, or `null` when it lacks a
 * language, a question or an answer the AI service's schema requires; those are left out.
 */
function toExchange(record: ChatExchangeRecord): ChatHistoryExchange | null {
  const { language, question, answer } = record;
  if ((language !== "en" && language !== "cs") || question === "" || answer === "") return null;
  return {
    question,
    answer,
    language,
    sources: record.sources.flatMap((source) => {
      const parsed = ChatSourceSchema.safeParse(source);
      return parsed.success
        ? [
            {
              kind: parsed.data.record.kind,
              recordId: parsed.data.record.id,
              title: parsed.data.title,
            },
          ]
        : [];
    }),
  };
}

const nothing = { text: null, language: null, blocks: [], sources: [], related: [] };

/** The approved result as stored: an answer, or an error with none of the content. */
function resultRecord(result: ChatGenerationResult): ChatResultRecord {
  const terminal = chatTerminalForGeneration(result.outcome, result.reason);
  const shown =
    terminal.type === "complete"
      ? {
          status: "completed" as const,
          outcome: terminal.outcome,
          errorCode: null,
          errorRetryable: null,
          text: result.text,
          language: result.language,
          blocks: result.blocks,
          sources: result.sources,
          related: result.related,
        }
      : {
          status: "failed" as const,
          outcome: null,
          errorCode: terminal.code,
          errorRetryable: terminal.retryable,
          ...nothing,
        };
  const { usage } = result;
  return {
    ...shown,
    resultOutcome: result.outcome,
    resultReason: result.reason,
    costMicroUsd: usage.costUncertain ? null : Math.round(usage.costUsd * 1_000_000),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    modelAttempts: usage.modelAttempts,
    latencyMs: result.latencyMs,
    versions: result.versions,
    advancesRevision: terminal.type === "complete" && terminal.outcome === "answered",
  };
}

/** A result outside the contract: a non-retryable internal failure, its cost unknown. */
const invalidResult: ChatResultRecord = {
  status: "failed",
  outcome: null,
  errorCode: "internal",
  errorRetryable: false,
  ...nothing,
  resultOutcome: "invalid_result",
  resultReason: null,
  costMicroUsd: null,
  inputTokens: 0,
  outputTokens: 0,
  modelAttempts: 0,
  latencyMs: 0,
  versions: {},
  advancesRevision: false,
};

/** The grant of a result body that failed the contract, when it carries one. */
function grantOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("grant" in body)) return null;
  const { grant } = body;
  return typeof grant === "string" && grant.length > 0 && grant.length <= chatGrantMaxLength
    ? grant
    : null;
}

function stageOf(operation: ChatOperationRecord, elapsedMs: number): ChatProgressStage {
  if (operation.status === "accepted") return "queued";
  if (operation.status === "running") return elapsedMs < checkingMs ? "checking" : "answering";
  return "finishing";
}

/**
 * The visitor chat over its persistence. Every visitor operation is scoped by the caller the
 * cookie resolved; an identifier from a URL only narrows within it.
 */
export function createChatService(
  persistence: ChatPersistence,
  options: ChatServiceOptions,
): ChatService {
  const { config, verifier } = options;
  const policy = options.policy ?? chatPolicy;
  const now = options.now ?? (() => new Date());
  /** Every visitor whose address is unknown shares one fingerprint, and so the strict quota. */
  const fingerprint = (address: string | null) =>
    createHmac("sha256", config.fingerprintKey)
      .update(address ?? unknownAddressBucket, "utf8")
      .digest("hex");

  /** The gates' inputs for one admission at the current time, with a fresh grant. */
  const gates = (challengeTokenHash: string, context: { clientAddress: string | null }) => {
    const at = now();
    const deadlineAt = new Date(at.getTime() + policy.deadlineMs);
    const grant = newToken();
    return {
      grant,
      input: {
        challengeTokenHash,
        fingerprint: fingerprint(context.clientAddress),
        at,
        deadlineAt,
        grantVerifier: digest(grant),
        model: config.model,
        pricingVersion: config.pricingVersion,
        allowanceMicroUsd: policy.allowanceMicroUsd,
        quotas: quotaRules(at),
        admissionExpiresAt: admissionExpiry(at),
        spend: spendWindows(at, deadlineAt, policy),
      },
    };
  };

  /** An admitted operation with everything the AI service needs to answer it. */
  const admitted = async (
    caller: ChatCaller,
    operation: ChatOperationRecord,
    question: string,
    grant: string,
    at: Date,
  ): Promise<ChatSubmitResult> => {
    const history = await persistence.recentExchanges(
      caller.conversationId,
      chatHistoryExchangeLimit,
    );
    return {
      status: "admitted",
      operation: toOperation(operation),
      dispatch: {
        operationId: operation.id,
        grant,
        question,
        history: history.flatMap((record) => toExchange(record) ?? []),
        today: pragueDate(at),
        deadlineAt: operation.deadlineAt.toISOString(),
        contextRevision: operation.contextRevision,
        model: operation.model,
        pricingVersion: operation.pricingVersion,
        allowanceUsd: operation.allowanceMicroUsd / 1_000_000,
      },
    };
  };

  /** A gate refusal as the caller sees it. */
  const refused = (
    result:
      | { status: "busy"; operation: ChatOperationRecord }
      | { status: "challenge_reused" }
      | { status: "quota_exceeded"; retryAt: Date }
      | { status: "budget_exhausted" },
  ): ChatSubmitResult => {
    switch (result.status) {
      case "busy":
        return { status: "busy", operation: toOperation(result.operation) };
      case "challenge_reused":
        return { status: "challenge_failed" };
      case "quota_exceeded":
        return { status: "quota_exceeded", retryAt: result.retryAt };
      case "budget_exhausted":
        return { status: "budget_exhausted" };
    }
  };

  const admit = async (
    caller: ChatCaller,
    question: string,
    questionHash: string,
    challengeTokenHash: string,
    context: { clientAddress: string | null },
    requestId: string,
  ): Promise<ChatSubmitResult> => {
    const { grant, input } = gates(challengeTokenHash, context);
    const result = await persistence.admit({
      ...input,
      identityId: caller.identityId,
      conversationId: caller.conversationId,
      requestId,
      question,
      questionHash,
    });
    switch (result.status) {
      case "duplicate":
        return result.sameQuestion
          ? { status: "existing", operation: toOperation(result.operation) }
          : { status: "conflict" };
      case "admitted":
        return admitted(caller, result.operation, question, grant, input.at);
      default:
        return refused(result);
    }
  };

  const admitRetry = async (
    caller: ChatCaller,
    operationId: string,
    retryId: string,
    challengeTokenHash: string,
    context: { clientAddress: string | null },
  ): Promise<ChatRetryOutcome> => {
    const { grant, input } = gates(challengeTokenHash, context);
    const result = await persistence.retry({
      ...input,
      identityId: caller.identityId,
      conversationId: caller.conversationId,
      operationId,
      retryId,
    });
    switch (result.status) {
      case "duplicate":
        return result.sameTarget
          ? { status: "existing", operation: toOperation(result.operation) }
          : { status: "conflict" };
      case "recovered":
        return { status: "existing", operation: toOperation(result.operation) };
      case "not_found":
      case "not_retryable":
        return { status: result.status };
      case "admitted":
        return admitted(caller, result.operation, result.question, grant, input.at);
      default:
        return refused(result);
    }
  };

  /**
   * Redeems a single-use challenge token once for the request `key` names: concurrent equal
   * calls wait, bounded, while one claims the key and verifies; `recovered` reads what an earlier
   * call already created, and `admitWith` runs the gates once the token passed.
   */
  const redeemOnce = async <T>(
    claim: { identityId: string; requestId: string; questionHash: string; token: string },
    context: { clientAddress: string | null },
    recovered: () => Promise<T | null>,
    admitWith: (challengeTokenHash: string) => Promise<T>,
    refusal: { conflict: T; challengeFailed: T },
  ): Promise<T> => {
    const held = {
      identityId: claim.identityId,
      requestId: claim.requestId,
      questionHash: claim.questionHash,
      challengeTokenHash: digest(claim.token),
    };
    const verifyAndAdmit = async (): Promise<T> =>
      (await verifier.verify(claim.token, context.clientAddress))
        ? admitWith(held.challengeTokenHash)
        : refusal.challengeFailed;
    const polls = Math.ceil(policy.requestClaimMs / policy.requestClaimPollMs);
    for (let poll = 0; ; poll += 1) {
      const at = now();
      const state = await persistence.claimRequest({
        ...held,
        at,
        expiresAt: new Date(at.getTime() + policy.requestClaimMs),
      });
      if (state.status === "claimed") {
        const passed = await verifier.verify(claim.token, context.clientAddress);
        await persistence.settleRequestClaim(held, passed ? "verified" : "failed");
        return passed ? admitWith(held.challengeTokenHash) : refusal.challengeFailed;
      }
      if (!state.sameQuestion) return refusal.conflict;
      // Another token cannot be redeemed twice by this claim; it is verified on its own.
      if (!state.sameToken) return verifyAndAdmit();
      if (state.state === "failed") return refusal.challengeFailed;
      // The token passed for this very request: admitting again recovers its operation.
      if (state.state === "verified") return admitWith(held.challengeTokenHash);
      if (poll >= polls) return refusal.challengeFailed;
      await sleep(policy.requestClaimPollMs);
      const settled = await recovered();
      if (settled !== null) return settled;
    }
  };

  const cancelled = { code: "cancelled" as const, retryable: true };

  const readConversation = async (
    caller: ChatCaller,
    query: ChatConversationQuery,
  ): Promise<ChatConversation> => {
    const page = await persistence.listMessages(caller.conversationId, {
      ...(query.before === undefined ? {} : { before: query.before }),
      limit: query.limit,
    });
    const active = await persistence.findActiveOperation(caller.identityId);
    const messages = page.messages.map(toMessage);
    return {
      conversationId: caller.conversationId,
      messages,
      nextCursor: page.hasMore ? (messages[0]?.id ?? null) : null,
      activeOperation: active === null ? null : toOperation(active),
      retentionDays: config.retentionDays,
    };
  };

  return {
    retentionDays: config.retentionDays,

    async open(cookie) {
      const at = now();
      if (cookie !== null && tokenPattern.test(cookie)) {
        const known = await persistence.resolveIdentity(digest(cookie), at);
        if (known !== null) {
          return {
            caller: { identityId: known.identityId, conversationId: known.conversation.id },
            cookie: null,
          };
        }
      }
      const issued = newToken();
      const created = await persistence.createIdentity(digest(issued), at);
      return {
        caller: { identityId: created.identityId, conversationId: created.conversation.id },
        cookie: issued,
      };
    },

    conversation: readConversation,

    async submit(caller, submission, context) {
      const question = submission.question.trim();
      const questionHash = digest(question);
      const recovered = async (): Promise<ChatSubmitResult | null> => {
        const earlier = await persistence.findOperationByRequest(
          caller.identityId,
          submission.requestId,
        );
        if (earlier === null) return null;
        return earlier.questionHash === questionHash
          ? { status: "existing", operation: toOperation(earlier) }
          : { status: "conflict" };
      };
      const known = await recovered();
      if (known !== null) return known;
      const active = await persistence.findActiveOperation(caller.identityId);
      if (active !== null) return { status: "busy", operation: toOperation(active) };

      // Concurrent equal submissions redeem the single-use token once.
      return redeemOnce<ChatSubmitResult>(
        {
          identityId: caller.identityId,
          requestId: submission.requestId,
          questionHash,
          token: submission.challengeToken,
        },
        context,
        recovered,
        (challengeTokenHash) =>
          admit(caller, question, questionHash, challengeTokenHash, context, submission.requestId),
        { conflict: { status: "conflict" }, challengeFailed: { status: "challenge_failed" } },
      );
    },

    async retry(caller, operationId, submission, context) {
      if (!uuidPattern.test(operationId)) return { status: "not_found" };
      const { retryId } = submission;
      // A used retry id, or an attempt that is active or completed, is recovered before any
      // challenge, quota or spend: a retry never starts paid work twice.
      const recovered = async (): Promise<ChatRetryOutcome | null> => {
        const used = await persistence.findOperationByAttempt(caller.identityId, retryId);
        if (used === null) return null;
        return used.retryOf === operationId
          ? { status: "existing", operation: toOperation(used) }
          : { status: "conflict" };
      };
      const known = await recovered();
      if (known !== null) return known;
      const target = await persistence.findOperation(caller.identityId, operationId);
      if (target?.operation.conversationId !== caller.conversationId)
        return { status: "not_found" };
      const latest = await persistence.findOperationByRequest(
        caller.identityId,
        target.operation.requestId,
      );
      if (latest !== null && recoverable.has(latest.status)) {
        return { status: "existing", operation: toOperation(latest) };
      }
      if (latest?.id !== operationId || target.assistant.errorRetryable !== true) {
        return { status: "not_retryable" };
      }
      const active = await persistence.findActiveOperation(caller.identityId);
      if (active !== null) return { status: "busy", operation: toOperation(active) };

      return redeemOnce<ChatRetryOutcome>(
        {
          identityId: caller.identityId,
          requestId: retryId,
          // The claim binds the retry id to its target, as a submission's to its question.
          questionHash: digest(`retry:${operationId}`),
          token: submission.challengeToken,
        },
        context,
        recovered,
        (challengeTokenHash) =>
          admitRetry(caller, operationId, retryId, challengeTokenHash, context),
        { conflict: { status: "conflict" }, challengeFailed: { status: "challenge_failed" } },
      );
    },

    async stop(caller, operationId) {
      if (!uuidPattern.test(operationId)) return null;
      const result = await persistence.stop(caller.identityId, operationId, now(), cancelled);
      if (result === null) return null;
      return result.status === "stopped"
        ? { status: "stopped", operation: toOperation(result.operation), running: result.claimed }
        : { status: "finished", operation: toOperation(result.operation) };
    },

    async clear(caller, request) {
      const at = now();
      const result = uuidPattern.test(request.conversationId)
        ? await persistence.clear({
            identityId: caller.identityId,
            conversationId: request.conversationId,
            at,
            error: cancelled,
            tombstoneExpiresAt: new Date(at.getTime() + tombstoneMs),
          })
        : ({ status: "mismatch" } as const);
      if (result.status === "mismatch") {
        return {
          cancelled: [],
          cleared: {
            cleared: false,
            conversation: await readConversation(caller, { limit: chatConversationPageLimit }),
            telemetryDeletion: "none",
          },
        };
      }
      return {
        cancelled: result.cancelled,
        cleared: {
          cleared: true,
          conversation: {
            conversationId: result.conversation.id,
            messages: [],
            nextCursor: null,
            activeOperation: null,
            retentionDays: config.retentionDays,
          },
          telemetryDeletion: result.telemetryPending > 0 ? "pending" : "none",
        },
      };
    },

    async operation(caller, operationId) {
      if (!uuidPattern.test(operationId)) return null;
      const found = await persistence.findOperation(caller.identityId, operationId);
      return found === null ? null : toOperation(found.operation);
    },

    async observe(caller, operationId): Promise<ChatObservation | null> {
      if (!uuidPattern.test(operationId)) return null;
      const found = await persistence.findOperation(caller.identityId, operationId);
      if (found === null) return null;
      const assistant = toAssistant(found.assistant);
      const elapsedMs = Math.max(0, now().getTime() - found.operation.admittedAt.getTime());
      return {
        operation: toOperation(found.operation),
        assistant,
        events: chatReplayEvents(found.operation.requestId, assistant),
        stage: stageOf(found.operation, elapsedMs),
        elapsedMs,
        terminal: found.operation.status !== "accepted" && found.operation.status !== "running",
      };
    },

    async claim(claim) {
      if (!uuidPattern.test(claim.operationId)) return { status: "wrong_grant" };
      const result = await persistence.claimGrant(claim.operationId, digest(claim.grant), now());
      if (result.status !== "claimed") return { status: result.status };
      const { operation } = result;
      return {
        status: "claimed",
        claimed: {
          claimed: true,
          deadlineAt: operation.deadlineAt.toISOString(),
          allowanceUsd: operation.allowanceMicroUsd / 1_000_000,
          model: operation.model,
          pricingVersion: operation.pricingVersion,
          contextRevision: operation.contextRevision,
        },
      };
    },

    async reconcile(operationId, body) {
      const parsed = ChatGenerationResultSchema.safeParse(body);
      const grant = parsed.success ? parsed.data.grant : grantOf(body);
      if (grant === null) return { status: "invalid" };
      if (!uuidPattern.test(operationId)) return { status: "wrong_grant" };
      const result = await persistence.reconcile(
        operationId,
        digest(grant),
        now(),
        parsed.success ? resultRecord(parsed.data) : invalidResult,
      );
      if (result.status === "reconciled" || result.status === "already") {
        return { status: result.status, operation: toOperation(result.operation) };
      }
      return { status: result.status };
    },

    dispatchRefused(operationId) {
      return persistence.failUnclaimed(operationId, now(), {
        code: "unavailable",
        retryable: true,
      });
    },

    interruptOverdue(graceMs) {
      const at = now();
      return persistence.interruptOverdue(new Date(at.getTime() - graceMs), at, {
        code: "timeout",
        retryable: true,
      });
    },

    deleteExpired(limit) {
      const at = now();
      return persistence.deleteInactive(
        new Date(at.getTime() - config.retentionDays * dayMs),
        at,
        limit,
      );
    },
  };
}

const chatOff = (): never => {
  throw new Error("Visitor chat is not configured.");
};

/** The chat of a process without chat settings: every operation throws. */
export const unconfiguredChat: ChatService = {
  retentionDays: chatRetentionDaysDefault,
  open: chatOff,
  conversation: chatOff,
  submit: chatOff,
  retry: chatOff,
  stop: chatOff,
  clear: chatOff,
  operation: chatOff,
  observe: chatOff,
  claim: chatOff,
  reconcile: chatOff,
  dispatchRefused: chatOff,
  interruptOverdue: chatOff,
  deleteExpired: chatOff,
};
