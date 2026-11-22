import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ChatGenerationResult } from "@sebela/contracts";
import { createPersistence, readDatabaseConfig, type Persistence } from "@sebela/db";
import { createTemporaryDatabase, type TemporaryDatabase } from "@sebela/db/testing";

import {
  chatPolicy,
  createChatService,
  type ChallengeVerifier,
  type ChatCaller,
  type ChatDispatch,
  type ChatService,
} from "./index.js";
import { admissionExpiry, pragueDate, quotaRules, spendWindows } from "./policy.js";

// Fictional values only.
const config = {
  fingerprintKey: "fictional-fingerprint-key-of-at-least-32-chars",
  retentionDays: 730,
  model: "fictional-model",
  pricingVersion: "fictional-pricing-1",
};

const answerFor = (grant: string, text = "A fictional answer."): ChatGenerationResult => ({
  grant,
  outcome: "answered",
  reason: null,
  language: "en",
  text,
  blocks: [
    { type: "ServiceCard", title: "Fictional service", summary: "A summary.", href: "/services" },
  ],
  sources: [{ record: { kind: "service", id: "svc-1" }, title: "Fictional service", href: "/" }],
  related: [],
  usage: {
    costUsd: 0.004,
    costUncertain: false,
    inputTokens: 100,
    outputTokens: 50,
    modelAttempts: 1,
  },
  versions: { agent: "1" },
  latencyMs: 1200,
});

/** A verifier that answers as told and counts its calls. */
function fakeVerifier(): ChallengeVerifier & { calls: number; answer: boolean } {
  const verifier = {
    calls: 0,
    answer: true,
    verify: () => {
      verifier.calls += 1;
      return Promise.resolve(verifier.answer);
    },
  };
  return verifier;
}

describe("visitor chat service", () => {
  let database: TemporaryDatabase;
  let persistence: Persistence;
  let verifier: ReturnType<typeof fakeVerifier>;
  let chat: ChatService;
  let now: Date;
  let address = 0;
  const nextAddress = () => `192.0.2.${String((address++ % 250) + 1)}`;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    persistence = createPersistence(database.config);
  });

  afterAll(async () => {
    await persistence.close();
    await database.drop();
  });

  beforeEach(() => {
    now = new Date("2031-03-10T12:00:00.000Z");
    verifier = fakeVerifier();
    chat = createChatService(persistence.chat, { config, verifier, now: () => now });
  });

  const newCaller = async (): Promise<ChatCaller> => (await chat.open(null)).caller;

  const submit = (
    caller: ChatCaller,
    question = "What do you build?",
    requestId = randomUUID(),
    challengeToken = `fictional-token-${randomUUID()}`,
  ) =>
    chat.submit(caller, { requestId, question, challengeToken }, { clientAddress: nextAddress() });

  const admitted = async (caller: ChatCaller, question?: string): Promise<ChatDispatch> => {
    const result = await submit(caller, question);
    if (result.status !== "admitted") throw new Error(`Expected admission, got ${result.status}.`);
    return result.dispatch;
  };

  const answer = async (dispatch: ChatDispatch, text?: string) => {
    const claim = await chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });
    expect(claim.status).toBe("claimed");
    const reconciled = await chat.reconcile(dispatch.operationId, answerFor(dispatch.grant, text));
    expect(reconciled.status).toBe("reconciled");
  };

  describe("identity", () => {
    it("issues a new opaque cookie and an empty conversation to a caller without one", async () => {
      const opened = await chat.open(null);

      expect(opened.cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const conversation = await chat.conversation(opened.caller, { limit: 20 });
      expect(conversation).toMatchObject({
        messages: [],
        nextCursor: null,
        activeOperation: null,
        retentionDays: 730,
      });
      expect(conversation.conversationId).toBe(opened.caller.conversationId);
    });

    it("resolves the same conversation from the same cookie and issues no new one", async () => {
      const first = await chat.open(null);

      const again = await chat.open(first.cookie);

      expect(again.cookie).toBeNull();
      expect(again.caller).toEqual(first.caller);
    });

    it("treats an unknown or malformed cookie as a new visitor", async () => {
      const unknown = await chat.open("A".repeat(43));
      const malformed = await chat.open("not a cookie; at all");

      expect(unknown.cookie).not.toBeNull();
      expect(malformed.cookie).not.toBeNull();
      expect(unknown.caller.conversationId).not.toBe(malformed.caller.conversationId);
    });
  });

  describe("submission", () => {
    it("admits a question with a bound dispatch and shows it pending in the conversation", async () => {
      const caller = await newCaller();
      const requestId = randomUUID();

      const result = await submit(caller, "  What do you build?  ", requestId);

      expect(result.status).toBe("admitted");
      if (result.status !== "admitted") return;
      expect(result.operation).toMatchObject({
        requestId,
        status: "accepted",
        deadlineAt: "2031-03-10T12:01:00.000Z",
      });
      expect(result.dispatch).toMatchObject({
        operationId: result.operation.operationId,
        question: "What do you build?",
        history: [],
        today: "2031-03-10",
        deadlineAt: "2031-03-10T12:01:00.000Z",
        contextRevision: 0,
        model: "fictional-model",
        pricingVersion: "fictional-pricing-1",
        allowanceUsd: 0.02,
      });
      expect(result.dispatch.grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(verifier.calls).toBe(1);

      const conversation = await chat.conversation(caller, { limit: 20 });
      expect(conversation.activeOperation).toEqual(result.operation);
      expect(conversation.messages).toMatchObject([
        { role: "user", requestId, text: "What do you build?" },
        { role: "assistant", requestId, status: "pending", text: null, outcome: null },
      ]);
      expect(JSON.stringify(conversation)).not.toContain(result.dispatch.grant);
    });

    it("recovers a duplicate of the same question without a new challenge or dispatch", async () => {
      const caller = await newCaller();
      const requestId = randomUUID();
      const first = await submit(caller, "What do you build?", requestId);

      const again = await submit(caller, "What do you build?  ", requestId);

      expect(again.status).toBe("existing");
      if (first.status !== "admitted" || again.status !== "existing") return;
      expect(again.operation).toEqual(first.operation);
      expect(verifier.calls).toBe(1);
      expect((await chat.conversation(caller, { limit: 20 })).messages).toHaveLength(2);
    });

    it("refuses a reused request id with another question", async () => {
      const caller = await newCaller();
      const requestId = randomUUID();
      await submit(caller, "What do you build?", requestId);

      await expect(submit(caller, "Something else?", requestId)).resolves.toEqual({
        status: "conflict",
      });
      expect(verifier.calls).toBe(1);
    });

    it("refuses another question while one is active, before any challenge", async () => {
      const caller = await newCaller();
      const first = await submit(caller);

      const second = await submit(caller, "And another?");

      expect(second.status).toBe("busy");
      if (first.status !== "admitted" || second.status !== "busy") return;
      expect(second.operation).toEqual(first.operation);
      expect(verifier.calls).toBe(1);
    });

    it("refuses a failed challenge and stores, counts and reserves nothing", async () => {
      const caller = await newCaller();
      verifier.answer = false;
      const before = await persistence.chat.committedSpend("day", "2031-03-10");

      await expect(submit(caller)).resolves.toEqual({ status: "challenge_failed" });

      expect((await chat.conversation(caller, { limit: 20 })).messages).toEqual([]);
      expect(await persistence.chat.committedSpend("day", "2031-03-10")).toBe(before);
      verifier.answer = true;
      for (let index = 0; index < 5; index += 1) await answer(await admitted(caller));
    });

    it("refuses a challenge token that already admitted another question", async () => {
      const one = await newCaller();
      const other = await newCaller();
      await submit(one, "What do you build?", randomUUID(), "fictional-token-once");

      await expect(
        submit(other, "What do you build?", randomUUID(), "fictional-token-once"),
      ).resolves.toEqual({ status: "challenge_failed" });
    });

    it("limits an identity to five questions in a rolling minute", async () => {
      const caller = await newCaller();
      for (let index = 0; index < 5; index += 1) {
        await answer(await admitted(caller, `Question ${String(index)}?`));
        now = new Date(now.getTime() + 1000);
      }

      const refused = await submit(caller, "A sixth?");

      expect(refused).toEqual({
        status: "quota_exceeded",
        retryAt: new Date("2031-03-10T12:01:00.000Z"),
      });
    });

    it("refuses when the global spend window cannot hold another allowance", async () => {
      chat = createChatService(persistence.chat, {
        config,
        verifier,
        now: () => now,
        policy: { ...chatPolicy, dailySpendLimitMicroUsd: 1 },
      });
      const caller = await newCaller();

      await expect(submit(caller)).resolves.toEqual({ status: "budget_exhausted" });
      expect((await chat.conversation(caller, { limit: 20 })).messages).toEqual([]);
    });
  });

  describe("history", () => {
    it("sends at most six completed answered exchanges, oldest first, as context", async () => {
      const caller = await newCaller();
      for (let index = 0; index < 7; index += 1) {
        await answer(
          await admitted(caller, `Question ${String(index)}?`),
          `Answer ${String(index)}.`,
        );
        now = new Date(now.getTime() + 61_000);
      }
      now = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      const dispatch = await admitted(caller, "And now?");

      expect(dispatch.contextRevision).toBe(7);
      expect(dispatch.history).toHaveLength(6);
      expect(dispatch.history[0]).toEqual({
        question: "Question 1?",
        answer: "Answer 1.",
        language: "en",
        sources: [{ kind: "service", recordId: "svc-1", title: "Fictional service" }],
      });
      expect(dispatch.history[5]?.question).toBe("Question 6?");
    });

    it("pages the conversation backwards with a cursor of its own messages", async () => {
      const caller = await newCaller();
      for (let index = 0; index < 3; index += 1) {
        await answer(await admitted(caller, `Question ${String(index)}?`));
        now = new Date(now.getTime() + 61_000);
      }

      const newest = await chat.conversation(caller, { limit: 4 });
      const older = await chat.conversation(caller, {
        limit: 4,
        before: newest.nextCursor ?? "",
      });

      expect(newest.messages).toHaveLength(4);
      expect(newest.nextCursor).toBe(newest.messages[0]?.id);
      expect(older.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(older.nextCursor).toBeNull();
    });
  });

  describe("generation control", () => {
    it("claims a grant once and binds it to the admission", async () => {
      const dispatch = await admitted(await newCaller());

      const claim = await chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });
      const replay = await chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });

      expect(claim).toEqual({
        status: "claimed",
        claimed: {
          claimed: true,
          deadlineAt: dispatch.deadlineAt,
          allowanceUsd: 0.02,
          model: "fictional-model",
          pricingVersion: "fictional-pricing-1",
          contextRevision: 0,
        },
      });
      expect(replay).toEqual({ status: "refused" });
    });

    it("refuses another grant and an unknown operation alike", async () => {
      const dispatch = await admitted(await newCaller());

      await expect(
        chat.claim({ operationId: dispatch.operationId, grant: "B".repeat(43) }),
      ).resolves.toEqual({ status: "wrong_grant" });
      await expect(
        chat.claim({ operationId: randomUUID(), grant: dispatch.grant }),
      ).resolves.toEqual({ status: "wrong_grant" });
    });

    it("stores an approved result once and replays it identically", async () => {
      const caller = await newCaller();
      const dispatch = await admitted(caller);
      await chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });

      const first = await chat.reconcile(dispatch.operationId, answerFor(dispatch.grant));
      const repeat = await chat.reconcile(
        dispatch.operationId,
        answerFor(dispatch.grant, "A different text."),
      );

      expect(first.status).toBe("reconciled");
      expect(repeat.status).toBe("already");
      const observed = await chat.observe(caller, dispatch.operationId);
      expect(observed?.terminal).toBe(true);
      expect(observed?.operation.status).toBe("completed");
      expect(observed?.assistant).toMatchObject({
        status: "completed",
        outcome: "answered",
        text: "A fictional answer.",
        error: null,
      });
      expect(observed?.events.map((event) => event.type)).toEqual([
        "start",
        "text_delta",
        "block",
        "sources",
        "complete",
      ]);
      expect((await chat.observe(caller, dispatch.operationId))?.events).toEqual(observed?.events);
    });

    it("maps a deadline limit to a retryable timeout and a cancellation to unavailable", async () => {
      const caller = await newCaller();
      const late = await admitted(caller);
      await chat.claim({ operationId: late.operationId, grant: late.grant });
      await chat.reconcile(late.operationId, {
        ...answerFor(late.grant, ""),
        outcome: "limit_reached",
        reason: "deadline",
        blocks: [],
        sources: [],
      });
      now = new Date(now.getTime() + 61_000);
      const cancelled = await admitted(caller);
      await chat.claim({ operationId: cancelled.operationId, grant: cancelled.grant });
      await chat.reconcile(cancelled.operationId, {
        ...answerFor(cancelled.grant, ""),
        outcome: "cancelled",
        blocks: [],
        sources: [],
      });

      expect((await chat.observe(caller, late.operationId))?.assistant).toMatchObject({
        status: "failed",
        error: { code: "timeout", retryable: true },
        text: null,
      });
      expect((await chat.observe(caller, cancelled.operationId))?.assistant).toMatchObject({
        status: "failed",
        error: { code: "unavailable", retryable: true },
      });
    });

    it("stores a refusal as a completed answer that does not become context", async () => {
      const caller = await newCaller();
      const refused = await admitted(caller);
      await chat.claim({ operationId: refused.operationId, grant: refused.grant });
      await chat.reconcile(refused.operationId, {
        ...answerFor(refused.grant, "I can only talk about the portfolio."),
        outcome: "refused",
        blocks: [],
        sources: [],
      });
      now = new Date(now.getTime() + 61_000);

      const next = await admitted(caller);

      expect((await chat.observe(caller, refused.operationId))?.assistant).toMatchObject({
        status: "completed",
        outcome: "refused",
      });
      expect(next.history).toEqual([]);
      expect(next.contextRevision).toBe(0);
    });

    it("stores an invalid result as a non-retryable internal failure and none of its content", async () => {
      const caller = await newCaller();
      const dispatch = await admitted(caller);
      await chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });

      const result = await chat.reconcile(dispatch.operationId, {
        ...answerFor(dispatch.grant, "Unapproved draft text."),
        blocks: [{ type: "UnknownCard", html: "<script>" }],
      });

      expect(result.status).toBe("reconciled");
      const observed = await chat.observe(caller, dispatch.operationId);
      expect(observed?.assistant).toMatchObject({
        status: "failed",
        error: { code: "internal", retryable: false },
        text: null,
        blocks: [],
        sources: [],
      });
      expect(JSON.stringify(observed)).not.toContain("Unapproved draft text.");
    });

    it("refuses a result without a grant and one for an unclaimed operation", async () => {
      const dispatch = await admitted(await newCaller());

      await expect(chat.reconcile(dispatch.operationId, { text: "x" })).resolves.toEqual({
        status: "invalid",
      });
      await expect(
        chat.reconcile(dispatch.operationId, answerFor(dispatch.grant)),
      ).resolves.toEqual({ status: "not_claimed" });
    });

    it("fails a refused dispatch as retryable unavailable and frees the identity", async () => {
      const caller = await newCaller();
      const dispatch = await admitted(caller);

      await expect(chat.dispatchRefused(dispatch.operationId)).resolves.toBe(true);

      expect((await chat.observe(caller, dispatch.operationId))?.assistant).toMatchObject({
        status: "failed",
        error: { code: "unavailable", retryable: true },
      });
      now = new Date(now.getTime() + 1000);
      await admitted(caller, "Again?");
    });

    it("interrupts an operation without a result after its deadline and the grace", async () => {
      const caller = await newCaller();
      const dispatch = await admitted(caller);
      await chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });

      now = new Date("2031-03-10T12:01:04.000Z");
      expect(await chat.interruptOverdue(5000)).not.toContain(dispatch.operationId);
      now = new Date("2031-03-10T12:01:06.000Z");
      expect(await chat.interruptOverdue(5000)).toContain(dispatch.operationId);

      const observed = await chat.observe(caller, dispatch.operationId);
      expect(observed?.operation.status).toBe("interrupted");
      expect(observed?.assistant.error).toEqual({ code: "timeout", retryable: true });
      await expect(
        chat.reconcile(dispatch.operationId, answerFor(dispatch.grant)),
      ).resolves.toMatchObject({ status: "already" });
    });
  });

  describe("observation", () => {
    it("reports progress stages from the operation and the elapsed time only", async () => {
      const caller = await newCaller();
      const dispatch = await admitted(caller);

      const queued = await chat.observe(caller, dispatch.operationId);
      await chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });
      now = new Date(now.getTime() + 2000);
      const checking = await chat.observe(caller, dispatch.operationId);
      now = new Date(now.getTime() + 4000);
      const answering = await chat.observe(caller, dispatch.operationId);

      expect(queued).toMatchObject({ stage: "queued", terminal: false, elapsedMs: 0 });
      expect(queued?.events).toEqual([
        {
          type: "start",
          eventId: 0,
          requestId: queued?.operation.requestId,
          messageId: queued?.assistant.id,
        },
      ]);
      expect(checking).toMatchObject({ stage: "checking", elapsedMs: 2000 });
      expect(answering).toMatchObject({ stage: "answering", elapsedMs: 6000 });
    });

    it("reveals nothing of another identity's operation or of an unknown one", async () => {
      const owner = await newCaller();
      const stranger = await newCaller();
      const dispatch = await admitted(owner);

      await expect(chat.operation(stranger, dispatch.operationId)).resolves.toBeNull();
      await expect(chat.observe(stranger, dispatch.operationId)).resolves.toBeNull();
      await expect(chat.operation(owner, randomUUID())).resolves.toBeNull();
      await expect(chat.operation(owner, "not-an-id")).resolves.toBeNull();
      await expect(chat.operation(owner, dispatch.operationId)).resolves.toMatchObject({
        operationId: dispatch.operationId,
      });
    });
  });

  describe("retention", () => {
    it("deletes a conversation once its retention has passed since the last activity", async () => {
      const opened = await chat.open(null);
      await answer(await admitted(opened.caller));

      now = new Date(now.getTime() + 729 * 24 * 60 * 60 * 1000);
      await chat.deleteExpired(100);
      const kept = await chat.open(opened.cookie);
      now = new Date(now.getTime() + 731 * 24 * 60 * 60 * 1000);
      const deleted = await chat.deleteExpired(100);
      const after = await chat.open(opened.cookie);

      expect(kept.caller).toEqual(opened.caller);
      expect(deleted).toBeGreaterThanOrEqual(1);
      expect(after.cookie).not.toBeNull();
      expect(after.caller.conversationId).not.toBe(opened.caller.conversationId);
    });
  });
});

describe("chat policy", () => {
  const at = new Date("2031-03-31T23:59:30.000Z");

  it("counts an identity per rolling minute, rolling two hours and UTC day, and a fingerprint per minute and day", () => {
    expect(quotaRules(at)).toEqual([
      { scope: "identity", since: new Date("2031-03-31T23:58:30.000Z"), limit: 5, resetsAt: null },
      { scope: "identity", since: new Date("2031-03-31T21:59:30.000Z"), limit: 10, resetsAt: null },
      {
        scope: "identity",
        since: new Date("2031-03-31T00:00:00.000Z"),
        limit: 30,
        resetsAt: new Date("2031-04-01T00:00:00.000Z"),
      },
      {
        scope: "fingerprint",
        since: new Date("2031-03-31T23:58:30.000Z"),
        limit: 20,
        resetsAt: null,
      },
      {
        scope: "fingerprint",
        since: new Date("2031-03-31T00:00:00.000Z"),
        limit: 100,
        resetsAt: new Date("2031-04-01T00:00:00.000Z"),
      },
    ]);
  });

  it("reserves in every UTC day and month the attempt touches", () => {
    expect(spendWindows(at, new Date(at.getTime() + 60_000))).toEqual([
      { kind: "day", startsOn: "2031-03-31", limitMicroUsd: 2_000_000 },
      { kind: "day", startsOn: "2031-04-01", limitMicroUsd: 2_000_000 },
      { kind: "month", startsOn: "2031-03-01", limitMicroUsd: 20_000_000 },
      { kind: "month", startsOn: "2031-04-01", limitMicroUsd: 20_000_000 },
    ]);
    const midday = new Date("2031-03-10T12:00:00.000Z");
    expect(spendWindows(midday, new Date(midday.getTime() + 60_000))).toEqual([
      { kind: "day", startsOn: "2031-03-10", limitMicroUsd: 2_000_000 },
      { kind: "month", startsOn: "2031-03-01", limitMicroUsd: 20_000_000 },
    ]);
  });

  it("keeps an admission's fingerprint until its day and two hours have passed", () => {
    expect(admissionExpiry(at)).toEqual(new Date("2031-04-01T01:59:30.000Z"));
    expect(admissionExpiry(new Date("2031-03-10T08:00:00.000Z"))).toEqual(
      new Date("2031-03-11T00:00:00.000Z"),
    );
  });

  it("dates the question in the site's time zone", () => {
    expect(pragueDate(at)).toBe("2031-04-01");
    expect(pragueDate(new Date("2031-03-10T12:00:00.000Z"))).toBe("2031-03-10");
  });
});
