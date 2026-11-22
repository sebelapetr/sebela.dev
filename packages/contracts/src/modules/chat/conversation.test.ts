import { describe, expect, it } from "vitest";

import {
  ChatAssistantMessageSchema,
  ChatConversationClearSchema,
  ChatConversationClearedSchema,
  ChatConversationQuerySchema,
  ChatConversationSchema,
  ChatGenerationResultSchema,
  ChatGrantClaimSchema,
  ChatGrantClaimedSchema,
  ChatMessageSchema,
  ChatMessageSubmissionSchema,
  ChatOperationSchema,
  ChatProgressSchema,
  ChatRetrySubmissionSchema,
  chatAssistantStatuses,
  chatConversationPageLimit,
  chatErrorCodes,
  chatOperationStatuses,
  chatReplayEvents,
  chatTerminalForGeneration,
  validateChatStream,
} from "./index.js";

// Fictional identifiers and content only.
const requestId = "5f1d2a33-1c4b-4b8e-8d3f-2b9e6a7c4d21";
const operationId = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c21";
const messageId = "c2e4f6a8-0b1d-4c3e-9f5a-7b9d1f3e5a70";
const userMessageId = "d3f5a7b9-1c2e-4d4f-8a6b-8c0e2a4f6b81";
const conversationId = "0b9c3c1e-6f0a-4d5e-9a51-3a0c1f2b7d10";
const createdAt = "2026-11-22T10:00:00.000Z";

const source = {
  record: { kind: "experience", id: "harbor-logistics" },
  title: "Platform engineer at Harbor Logistics",
  href: "/experience#experience-harbor-logistics",
} as const;

const contactCard = {
  type: "ContactCard",
  email: "alex@example.com",
  links: [],
} as const;

const answered = {
  id: messageId,
  role: "assistant",
  requestId,
  status: "completed",
  outcome: "answered",
  error: null,
  text: "Alex led the platform team at Harbor Logistics.",
  blocks: [],
  sources: [source],
  related: [{ label: "Experience", href: "/experience" }],
  model: "fictional-model",
  effort: "medium",
  createdAt,
} as const;

const pending = {
  ...answered,
  status: "pending",
  outcome: null,
  text: null,
  sources: [],
  related: [],
} as const;

describe("ChatMessageSubmissionSchema", () => {
  const valid = { requestId, question: "  What does Alex do?  ", challengeToken: "token" };

  it("accepts a request id, a trimmed question and the challenge token", () => {
    expect(ChatMessageSubmissionSchema.parse(valid)).toEqual({
      ...valid,
      question: "What does Alex do?",
    });
  });

  it.each([
    ["a missing challenge token", { requestId, question: "Hi" }],
    ["an empty challenge token", { ...valid, challengeToken: "" }],
    ["a challenge token over 2048 characters", { ...valid, challengeToken: "x".repeat(2049) }],
    ["a question over 1000 characters", { ...valid, question: "x".repeat(1001) }],
    ["a blank question", { ...valid, question: "   " }],
    ["a request id that is not a UUID", { ...valid, requestId: "r1" }],
    ["a supplied visitor id", { ...valid, visitorId: conversationId }],
    ["a supplied conversation id", { ...valid, conversationId }],
  ])("rejects %s", (_name, body) => {
    expect(ChatMessageSubmissionSchema.safeParse(body).success).toBe(false);
  });
});

describe("ChatConversationQuerySchema", () => {
  it("defaults the page to the page limit and has no cursor", () => {
    expect(ChatConversationQuerySchema.parse({})).toEqual({ limit: chatConversationPageLimit });
  });

  it("reads a cursor and a limit from query strings", () => {
    expect(ChatConversationQuerySchema.parse({ before: messageId, limit: "5" })).toEqual({
      before: messageId,
      limit: 5,
    });
  });

  it.each([{ limit: "0" }, { limit: "21" }, { limit: "two" }, { before: "not-a-cursor" }])(
    "rejects %o",
    (query) => {
      expect(ChatConversationQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});

describe("ChatOperationSchema", () => {
  it("describes an operation without any credential or visitor identifier", () => {
    const operation = {
      operationId,
      requestId,
      status: "accepted",
      deadlineAt: createdAt,
      assistantMessageId: messageId,
    };
    expect(ChatOperationSchema.parse(operation)).toEqual(operation);
    expect(ChatOperationSchema.safeParse({ ...operation, status: "paused" }).success).toBe(false);
  });
});

describe("ChatMessageSchema", () => {
  it("accepts a user message and an assistant message", () => {
    const user = { id: userMessageId, role: "user", requestId, text: "Hi", createdAt };
    expect(ChatMessageSchema.parse(user)).toEqual(user);
    expect(ChatMessageSchema.parse(answered)).toEqual(answered);
  });

  it("names the model and effort an answer was generated with, or none before admission", () => {
    expect(
      ChatAssistantMessageSchema.parse({ ...answered, model: null, effort: null }),
    ).toMatchObject({ model: null, effort: null });
    const withoutModel: Record<string, unknown> = { ...answered };
    delete withoutModel["model"];
    expect(ChatAssistantMessageSchema.safeParse(withoutModel).success).toBe(false);
  });

  it("refuses an unsafe source address in a stored answer", () => {
    const unsafe = { ...answered, sources: [{ ...source, href: "javascript:alert(1)" }] };
    expect(ChatAssistantMessageSchema.safeParse(unsafe).success).toBe(false);
  });

  it("accepts a failed answer with its error", () => {
    const failed = {
      ...pending,
      status: "interrupted",
      error: { code: "timeout", retryable: true },
    };
    expect(ChatAssistantMessageSchema.parse(failed)).toEqual(failed);
  });
});

describe("ChatConversationSchema", () => {
  it("accepts a page with its cursor, the active operation and the retention period", () => {
    const conversation = {
      conversationId,
      messages: [{ id: userMessageId, role: "user", requestId, text: "Hi", createdAt }, pending],
      nextCursor: userMessageId,
      activeOperation: {
        operationId,
        requestId,
        status: "running",
        deadlineAt: createdAt,
        assistantMessageId: messageId,
      },
      retentionDays: 730,
    };
    expect(ChatConversationSchema.parse(conversation)).toEqual(conversation);
  });

  it("refuses a page longer than the page limit", () => {
    const user = { id: userMessageId, role: "user", requestId, text: "Hi", createdAt };
    const conversation = {
      conversationId,
      messages: Array.from({ length: chatConversationPageLimit + 1 }, () => user),
      nextCursor: null,
      activeOperation: null,
      retentionDays: 730,
    };
    expect(ChatConversationSchema.safeParse(conversation).success).toBe(false);
  });
});

describe("ChatProgressSchema", () => {
  it("carries a stage and the elapsed time, never text", () => {
    const progress = { type: "progress", requestId, stage: "answering", elapsedMs: 2000 };
    expect(ChatProgressSchema.parse(progress)).toEqual(progress);
    expect(ChatProgressSchema.safeParse({ ...progress, text: "draft" }).success).toBe(false);
  });
});

describe("internal generation control", () => {
  it("claims a grant for one operation", () => {
    const claim = { operationId, grant: "g".repeat(43) };
    expect(ChatGrantClaimSchema.parse(claim)).toEqual(claim);
    expect(ChatGrantClaimSchema.safeParse({ ...claim, grant: "g".repeat(201) }).success).toBe(
      false,
    );
  });

  it("answers a claim with the bound deadline, allowance, model, effort and pricing", () => {
    const claimed = {
      claimed: true,
      deadlineAt: createdAt,
      allowanceUsd: 0.02,
      model: "fake",
      effort: "medium",
      pricingVersion: "2026-11",
      contextRevision: 3,
    };
    expect(ChatGrantClaimedSchema.parse(claimed)).toEqual(claimed);
    const withoutEffort: Record<string, unknown> = { ...claimed };
    delete withoutEffort["effort"];
    expect(ChatGrantClaimedSchema.safeParse(withoutEffort).success).toBe(false);
  });

  const result = {
    grant: "g".repeat(43),
    outcome: "answered",
    reason: null,
    language: "en",
    text: "Alex led the platform team.",
    blocks: [contactCard],
    sources: [source],
    related: [],
    usage: {
      costUsd: 0.004,
      costUncertain: false,
      inputTokens: 1200,
      outputTokens: 150,
      modelAttempts: 3,
    },
    versions: { prompt: "chat-v1" },
    latencyMs: 4200,
  };

  it("accepts a generation result in the contract's block and source shapes", () => {
    expect(ChatGenerationResultSchema.parse(result)).toEqual(result);
  });

  it("accepts the last main call's context measurement against its input cap", () => {
    const measured = {
      ...result,
      context: { estimatedInputTokens: 6400, reportedInputTokens: 6512, capTokens: 16000 },
    };
    expect(ChatGenerationResultSchema.parse(measured)).toEqual(measured);
    const unreported = { ...result, context: { ...measured.context, reportedInputTokens: null } };
    expect(ChatGenerationResultSchema.parse(unreported)).toEqual(unreported);
    expect(ChatGenerationResultSchema.parse({ ...result, context: null })).toMatchObject({
      context: null,
    });
  });

  it.each([
    ["an unknown outcome", { ...result, outcome: "draft" }],
    [
      "a context without a cap",
      { ...result, context: { estimatedInputTokens: 1, reportedInputTokens: null, capTokens: 0 } },
    ],
    [
      "a context with lifetime totals",
      {
        ...result,
        context: {
          estimatedInputTokens: 1,
          reportedInputTokens: null,
          capTokens: 16000,
          lifetimeTokens: 90000,
        },
      },
    ],
    ["an unsafe related link", { ...result, related: [{ label: "x", href: "ftp://x.example" }] }],
    ["more than eight sources", { ...result, sources: Array.from({ length: 9 }, () => source) }],
    ["a negative cost", { ...result, usage: { ...result.usage, costUsd: -1 } }],
    ["an unknown language", { ...result, language: "de" }],
    ["an extra field", { ...result, draft: "unapproved" }],
  ])("refuses %s", (_name, body) => {
    expect(ChatGenerationResultSchema.safeParse(body).success).toBe(false);
  });
});

describe("chatTerminalForGeneration", () => {
  it.each(["answered", "insufficient_evidence", "refused", "unavailable"] as const)(
    "completes %s with the same outcome",
    (outcome) => {
      expect(chatTerminalForGeneration(outcome, null)).toEqual({ type: "complete", outcome });
    },
  );

  it("reports the deadline as a retryable timeout", () => {
    expect(chatTerminalForGeneration("limit_reached", "deadline")).toEqual({
      type: "error",
      code: "timeout",
      retryable: true,
    });
  });

  it.each(["cost_allowance", "context_too_large", "tool_calls", null])(
    "completes another limit (%s) as unavailable",
    (reason) => {
      expect(chatTerminalForGeneration("limit_reached", reason)).toEqual({
        type: "complete",
        outcome: "unavailable",
      });
    },
  );

  it("reports a cancelled generation as unavailable infrastructure", () => {
    expect(chatTerminalForGeneration("cancelled", null)).toEqual({
      type: "error",
      code: "unavailable",
      retryable: true,
    });
  });
});

describe("chatReplayEvents", () => {
  it("replays a stored answer as a valid, complete stream starting at event 0", () => {
    const message = ChatAssistantMessageSchema.parse({ ...answered, blocks: [contactCard] });
    const events = chatReplayEvents(requestId, message);
    expect(events.map((event) => [event.eventId, event.type])).toEqual([
      [0, "start"],
      [1, "text_delta"],
      [2, "block"],
      [3, "sources"],
      [4, "related"],
      [5, "complete"],
    ]);
    const validation = validateChatStream(requestId, events);
    expect(validation.status).toBe("complete");
  });

  it("is deterministic, so a reconnect replays identical ids", () => {
    const message = ChatAssistantMessageSchema.parse(answered);
    expect(chatReplayEvents(requestId, message)).toEqual(chatReplayEvents(requestId, message));
  });

  it("splits a long answer into deltas the stream accepts", () => {
    const message = ChatAssistantMessageSchema.parse({ ...answered, text: "a".repeat(9000) });
    const events = chatReplayEvents(requestId, message);
    const deltas = events.filter((event) => event.type === "text_delta");
    expect(deltas).toHaveLength(3);
    expect(validateChatStream(requestId, events).status).toBe("complete");
  });

  it("only starts a pending answer", () => {
    const message = ChatAssistantMessageSchema.parse(pending);
    const events = chatReplayEvents(requestId, message);
    expect(events).toEqual([{ requestId, messageId, eventId: 0, type: "start" }]);
    expect(validateChatStream(requestId, events).status).toBe("interrupted");
  });

  it("ends an interrupted answer with its error and no text", () => {
    const message = ChatAssistantMessageSchema.parse({
      ...pending,
      status: "interrupted",
      error: { code: "timeout", retryable: true },
    });
    const events = chatReplayEvents(requestId, message);
    expect(events.at(-1)).toEqual({
      requestId,
      messageId,
      eventId: 1,
      type: "error",
      code: "timeout",
      retryable: true,
    });
    expect(validateChatStream(requestId, events).status).toBe("complete");
  });
});

describe("the conversation lifecycle", () => {
  it("knows a cancelled operation, answer and error", () => {
    expect(chatOperationStatuses).toContain("cancelled");
    expect(chatAssistantStatuses).toContain("cancelled");
    expect(chatErrorCodes).toContain("cancelled");
  });

  it("replays a stopped answer as a retryable cancellation without text", () => {
    const message = ChatAssistantMessageSchema.parse({
      ...pending,
      status: "cancelled",
      error: { code: "cancelled", retryable: true },
    });
    const events = chatReplayEvents(requestId, message);
    expect(events.map((event) => event.type)).toEqual(["start", "error"]);
    expect(events.at(-1)).toMatchObject({ code: "cancelled", retryable: true });
    expect(validateChatStream(requestId, events).status).toBe("complete");
  });

  const retry = { retryId: operationId, challengeToken: "token" };

  it("retries with its own request id and a fresh challenge token", () => {
    expect(ChatRetrySubmissionSchema.parse(retry)).toEqual(retry);
  });

  it.each([
    ["a missing challenge token", { retryId: operationId }],
    ["a retry id that is not a UUID", { ...retry, retryId: "r1" }],
    ["a new question", { ...retry, question: "Something else?" }],
    ["a supplied conversation id", { ...retry, conversationId }],
  ])("refuses a retry with %s", (_name, body) => {
    expect(ChatRetrySubmissionSchema.safeParse(body).success).toBe(false);
  });

  it("clears only the conversation the caller confirms", () => {
    expect(ChatConversationClearSchema.parse({ conversationId })).toEqual({ conversationId });
    expect(ChatConversationClearSchema.safeParse({}).success).toBe(false);
    expect(
      ChatConversationClearSchema.safeParse({ conversationId, identityId: conversationId }).success,
    ).toBe(false);
  });

  it("answers a clear with the fresh conversation and the telemetry deletion state", () => {
    const cleared = {
      cleared: true,
      conversation: {
        conversationId,
        messages: [],
        nextCursor: null,
        activeOperation: null,
        retentionDays: 730,
      },
      telemetryDeletion: "none",
    };
    expect(ChatConversationClearedSchema.parse(cleared)).toEqual(cleared);
    expect(
      ChatConversationClearedSchema.safeParse({ ...cleared, telemetryDeletion: "completed" })
        .success,
    ).toBe(false);
  });
});
