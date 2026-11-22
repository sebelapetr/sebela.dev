import { createHash, createHmac, randomBytes } from "node:crypto";

import {
  ChatAssistantMessageSchema,
  ChatGenerationResultSchema,
  ChatSourceSchema,
  chatGrantMaxLength,
  chatHistoryExchangeLimit,
  chatRetentionDaysDefault,
  chatReplayEvents,
  chatTerminalForGeneration,
  type ChatAssistantMessage,
  type ChatGenerationResult,
  type ChatMessage,
  type ChatOperation,
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
  ChatHistoryExchange,
  ChatObservation,
  ChatService,
  ChatServiceOptions,
} from "./types.js";

const dayMs = 24 * 60 * 60 * 1000;

/** How long a running generation reports `checking` before `answering`. */
const checkingMs = 5_000;

/** An opaque cookie value or grant: 32 random bytes, base64url. */
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const toExchange = (record: ChatExchangeRecord): ChatHistoryExchange => ({
  question: record.question,
  answer: record.answer,
  language: record.language === "en" || record.language === "cs" ? record.language : null,
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
});

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
  const fingerprint = (address: string) =>
    createHmac("sha256", config.fingerprintKey).update(address, "utf8").digest("hex");

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

    async conversation(caller, query) {
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
    },

    async submit(caller, submission, context) {
      const question = submission.question.trim();
      const questionHash = digest(question);
      const earlier = await persistence.findOperationByRequest(
        caller.identityId,
        submission.requestId,
      );
      if (earlier !== null) {
        return earlier.questionHash === questionHash
          ? { status: "existing", operation: toOperation(earlier) }
          : { status: "conflict" };
      }
      const active = await persistence.findActiveOperation(caller.identityId);
      if (active !== null) return { status: "busy", operation: toOperation(active) };
      if (!(await verifier.verify(submission.challengeToken, context.clientAddress))) {
        return { status: "challenge_failed" };
      }

      const at = now();
      const deadlineAt = new Date(at.getTime() + policy.deadlineMs);
      const grant = newToken();
      const result = await persistence.admit({
        identityId: caller.identityId,
        conversationId: caller.conversationId,
        requestId: submission.requestId,
        question,
        questionHash,
        challengeTokenHash: digest(submission.challengeToken),
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
      });
      switch (result.status) {
        case "duplicate":
          return result.sameQuestion
            ? { status: "existing", operation: toOperation(result.operation) }
            : { status: "conflict" };
        case "busy":
          return { status: "busy", operation: toOperation(result.operation) };
        case "challenge_reused":
          return { status: "challenge_failed" };
        case "quota_exceeded":
          return { status: "quota_exceeded", retryAt: result.retryAt };
        case "budget_exhausted":
          return { status: "budget_exhausted" };
        case "admitted": {
          const { operation } = result;
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
              history: history.map(toExchange),
              today: pragueDate(at),
              deadlineAt: operation.deadlineAt.toISOString(),
              contextRevision: operation.contextRevision,
              model: operation.model,
              pricingVersion: operation.pricingVersion,
              allowanceUsd: operation.allowanceMicroUsd / 1_000_000,
            },
          };
        }
      }
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
  operation: chatOff,
  observe: chatOff,
  claim: chatOff,
  reconcile: chatOff,
  dispatchRefused: chatOff,
  interruptOverdue: chatOff,
  deleteExpired: chatOff,
};
