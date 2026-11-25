import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ChatOperationSchema,
  ChatUsageSchema,
  type ChatCompactionResult,
  type ChatContextSummary,
  type ChatGenerationResult,
} from "@sebela/contracts";
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
  effort: "medium",
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
        effort: "medium",
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

    /** Like Siteverify: slow, and a token passes once; a second redemption fails. */
    const singleUseVerifier = (passes = true) => {
      const redeemed = new Set<string>();
      const calls: (string | null)[] = [];
      const single: ChallengeVerifier & { calls: (string | null)[] } = {
        calls,
        verify: async (token, remoteAddress) => {
          calls.push(remoteAddress);
          await new Promise((resolve) => setTimeout(resolve, 150));
          if (redeemed.has(token)) return false;
          redeemed.add(token);
          return passes;
        },
      };
      return single;
    };

    it("redeems the challenge once for concurrent equal submissions and admits them as one", async () => {
      const single = singleUseVerifier();
      chat = createChatService(persistence.chat, { config, verifier: single, now: () => now });
      const caller = await newCaller();
      const submission = {
        requestId: randomUUID(),
        question: "What do you build?",
        challengeToken: `fictional-token-${randomUUID()}`,
      };

      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          chat.submit(caller, submission, { clientAddress: nextAddress() }),
        ),
      );

      expect(single.calls).toHaveLength(1);
      const admittedResults = results.filter((result) => result.status === "admitted");
      expect(admittedResults).toHaveLength(1);
      expect(results.filter((result) => result.status === "existing")).toHaveLength(2);
      const operations = results.map((result) => ("operation" in result ? result.operation : null));
      for (const operation of operations) expect(operation).toEqual(operations[0]);
      expect((await chat.conversation(caller, { limit: 20 })).messages).toHaveLength(2);
    });

    it("gives every concurrent equal submission the challenge failure of the one that verified", async () => {
      const single = singleUseVerifier(false);
      chat = createChatService(persistence.chat, { config, verifier: single, now: () => now });
      const caller = await newCaller();
      const submission = {
        requestId: randomUUID(),
        question: "What do you build?",
        challengeToken: `fictional-token-${randomUUID()}`,
      };

      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          chat.submit(caller, submission, { clientAddress: nextAddress() }),
        ),
      );

      expect(single.calls).toHaveLength(1);
      expect(results).toEqual(Array.from({ length: 3 }, () => ({ status: "challenge_failed" })));
      expect((await chat.conversation(caller, { limit: 20 })).messages).toEqual([]);
    });

    it("refuses a concurrent submission of another question under the same request id", async () => {
      const single = singleUseVerifier();
      chat = createChatService(persistence.chat, { config, verifier: single, now: () => now });
      const caller = await newCaller();
      const requestId = randomUUID();
      const challengeToken = `fictional-token-${randomUUID()}`;

      const [first, second] = await Promise.all([
        chat.submit(
          caller,
          { requestId, question: "What do you build?", challengeToken },
          { clientAddress: nextAddress() },
        ),
        new Promise((resolve) => setTimeout(resolve, 20)).then(() =>
          chat.submit(
            caller,
            { requestId, question: "Something else?", challengeToken },
            { clientAddress: nextAddress() },
          ),
        ),
      ]);

      expect(first.status).toBe("admitted");
      expect(second).toEqual({ status: "conflict" });
      expect(single.calls).toHaveLength(1);
    });

    it("verifies without a client address and counts every unknown address in one bucket", async () => {
      const seen: (string | null)[] = [];
      chat = createChatService(persistence.chat, {
        config,
        verifier: {
          verify: (_token, remoteAddress) => {
            seen.push(remoteAddress);
            return Promise.resolve(true);
          },
        },
        now: () => now,
      });
      now = new Date("2031-04-10T12:00:00.000Z");
      const ask = async (clientAddress: string | null) =>
        chat.submit(
          await newCaller(),
          {
            requestId: randomUUID(),
            question: "What do you build?",
            challengeToken: `fictional-token-${randomUUID()}`,
          },
          { clientAddress },
        );

      for (let index = 0; index < 20; index += 1) {
        expect((await ask(null)).status).toBe("admitted");
      }

      expect(await ask(null)).toMatchObject({ status: "quota_exceeded" });
      expect((await ask("198.51.100.7")).status).toBe("admitted");
      expect(seen.slice(0, 21)).toEqual(Array.from({ length: 21 }, () => null));
      expect(seen[21]).toBe("198.51.100.7");
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

    it("sends only stored exchanges the AI service accepts: a language, a question and an answer", async () => {
      const stored = [
        { question: "Kept?", answer: "Kept.", language: "cs", sources: [] },
        { question: "No language?", answer: "None.", language: null, sources: [] },
        { question: "Another language?", answer: "Other.", language: "de", sources: [] },
        { question: "Empty answer?", answer: "", language: "en", sources: [] },
        { question: "", answer: "Empty question.", language: "en", sources: [] },
      ];
      const projecting = createChatService(
        {
          ...persistence.chat,
          workingContext: () => Promise.resolve({ revision: 0, summary: null, exchanges: stored }),
        },
        { config, verifier, now: () => now },
      );
      const caller = (await projecting.open(null)).caller;

      const result = await projecting.submit(
        caller,
        { requestId: randomUUID(), question: "And now?", challengeToken: "fictional-token" },
        { clientAddress: nextAddress() },
      );

      if (result.status !== "admitted")
        throw new Error(`Expected admission, got ${result.status}.`);
      expect(result.dispatch.history).toEqual([
        { question: "Kept?", answer: "Kept.", language: "cs", sources: [] },
      ]);
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
          kind: "answer",
          deadlineAt: dispatch.deadlineAt,
          allowanceUsd: 0.02,
          model: "fictional-model",
          effort: "medium",
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
  describe("usage and limits", () => {
    const minuteMs = 60_000;
    const at = (iso: string) => {
      now = new Date(iso);
    };
    const later = (ms: number) => {
      now = new Date(now.getTime() + ms);
    };
    const ask = (
      caller: ChatCaller,
      clientAddress: string | null,
      question = "What do you build?",
    ) =>
      chat.submit(
        caller,
        { requestId: randomUUID(), question, challengeToken: `fictional-token-${randomUUID()}` },
        { clientAddress },
      );
    const admittedFrom = async (caller: ChatCaller, clientAddress: string, question?: string) => {
      const result = await ask(caller, clientAddress, question);
      if (result.status !== "admitted")
        throw new Error(`Expected admission, got ${result.status}.`);
      return result.dispatch;
    };
    const answeredFrom = async (caller: ChatCaller, clientAddress: string, question?: string) => {
      const dispatch = await admittedFrom(caller, clientAddress, question);
      await answer(dispatch);
      return dispatch;
    };
    const settle = async (dispatch: ChatDispatch, change: Partial<ChatGenerationResult>) => {
      await chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });
      const result = await chat.reconcile(dispatch.operationId, {
        ...answerFor(dispatch.grant, ""),
        blocks: [],
        sources: [],
        ...change,
      });
      expect(result.status).toBe("reconciled");
    };

    it("reports the caller's meters and the effective model, and labels a missing measurement unavailable", async () => {
      at("2032-01-05T10:00:00.000Z");
      const caller = await newCaller();
      const context = { clientAddress: "203.0.113.1" };

      expect(await chat.usage(caller, context)).toEqual({
        serverTime: "2032-01-05T10:00:00.000Z",
        model: { name: "fictional-model", effort: "medium" },
        rollingTwoHours: { used: 0, limit: 10, percent: 0, nextReleaseAt: null },
        utcDay: { used: 0, limit: 30, percent: 0, resetsAt: "2032-01-06T00:00:00.000Z" },
        activeOperation: null,
        restriction: null,
        context: { status: "unavailable" },
        nextRequest: { status: "unavailable" },
      });

      const result = await ask(caller, context.clientAddress);
      if (result.status !== "admitted") throw new Error("Expected admission.");
      later(30_000);
      const active = await chat.usage(caller, context);

      expect(active).toMatchObject({
        serverTime: "2032-01-05T10:00:30.000Z",
        rollingTwoHours: {
          used: 1,
          limit: 10,
          percent: 10,
          nextReleaseAt: "2032-01-05T12:00:00.000Z",
        },
        utcDay: { used: 1, limit: 30, percent: 100 / 30 },
        activeOperation: result.operation,
        restriction: null,
        context: { status: "unavailable" },
      });
      expect(ChatUsageSchema.parse(active)).toEqual(active);
    });

    it("shows the last measured main call and keeps each answer's model and effort after a change", async () => {
      at("2032-01-06T10:00:00.000Z");
      const caller = await newCaller();
      const context = { clientAddress: "203.0.113.2" };
      const first = await admittedFrom(caller, context.clientAddress);
      later(2000);
      await settle(first, {
        ...answerFor(first.grant),
        context: { estimatedInputTokens: 6400, reportedInputTokens: 6512, capTokens: 16000 },
      });

      expect((await chat.usage(caller, context)).context).toEqual({
        status: "measured",
        operationId: first.operationId,
        measuredAt: "2032-01-06T10:00:02.000Z",
        estimatedInputTokens: 6400,
        reportedInputTokens: 6512,
        capTokens: 16000,
      });

      chat = createChatService(persistence.chat, {
        config: { ...config, model: "fictional-model-2", effort: "high" },
        verifier,
        now: () => now,
      });
      later(minuteMs);
      const second = await admittedFrom(caller, context.clientAddress, "And then?");
      expect(second).toMatchObject({ model: "fictional-model-2", effort: "high" });
      await settle(second, answerFor(second.grant));

      const usage = await chat.usage(caller, context);
      expect(usage.model).toEqual({ name: "fictional-model-2", effort: "high" });
      expect(usage.context).toMatchObject({ status: "measured", operationId: first.operationId });
      const answers = (await chat.conversation(caller, { limit: 20 })).messages.filter(
        (message) => message.role === "assistant",
      );
      expect(answers).toMatchObject([
        { model: "fictional-model", effort: "medium" },
        { model: "fictional-model-2", effort: "high" },
      ]);
    });

    it("gives two tabs the same snapshot and consumes nothing by reading, reattaching or recovering", async () => {
      at("2032-01-07T10:00:00.000Z");
      const caller = await newCaller();
      const context = { clientAddress: "203.0.113.3" };
      const first = await ask(caller, context.clientAddress);
      if (first.status !== "admitted") throw new Error("Expected admission.");

      const [one, other] = await Promise.all([
        chat.usage(caller, context),
        chat.usage(caller, context),
      ]);
      expect(other).toEqual(one);
      for (let index = 0; index < 5; index += 1) {
        await chat.usage(caller, context);
        await chat.conversation(caller, { limit: 20 });
        await chat.observe(caller, first.operation.operationId);
        await chat.operation(caller, first.operation.operationId);
      }
      await expect(
        chat.submit(
          caller,
          {
            requestId: first.operation.requestId,
            question: "What do you build?",
            challengeToken: `fictional-token-${randomUUID()}`,
          },
          context,
        ),
      ).resolves.toMatchObject({ status: "existing" });

      expect(await chat.usage(caller, context)).toEqual(one);
      expect(one.rollingTwoHours.used).toBe(1);
    });

    it("restricts an identity at five per rolling minute and frees it exactly a minute after the oldest", async () => {
      at("2032-01-08T10:00:00.000Z");
      const caller = await newCaller();
      const context = { clientAddress: "203.0.113.4" };
      for (let index = 0; index < 5; index += 1) {
        await answeredFrom(caller, context.clientAddress, `Question ${String(index)}?`);
        later(1000);
      }

      const usage = await chat.usage(caller, context);
      expect(usage.restriction).toEqual({ reason: "minute", retryAt: "2032-01-08T10:01:00.000Z" });
      expect(usage.rollingTwoHours).toMatchObject({ used: 5, percent: 50 });
      await expect(ask(caller, context.clientAddress)).resolves.toEqual({
        status: "quota_exceeded",
        retryAt: new Date("2032-01-08T10:01:00.000Z"),
      });

      at("2032-01-08T10:00:59.999Z");
      expect((await chat.usage(caller, context)).restriction).toMatchObject({ reason: "minute" });
      at("2032-01-08T10:01:00.000Z");
      expect((await chat.usage(caller, context)).restriction).toBeNull();
      expect((await ask(caller, context.clientAddress)).status).toBe("admitted");
    });

    it("restricts an identity at ten per rolling two hours and releases the oldest exactly", async () => {
      at("2032-01-09T10:00:00.000Z");
      const caller = await newCaller();
      const context = { clientAddress: "203.0.113.5" };
      for (let index = 0; index < 10; index += 1) {
        await answeredFrom(caller, context.clientAddress, `Question ${String(index)}?`);
        later(11 * minuteMs);
      }

      const usage = await chat.usage(caller, context);
      expect(usage.rollingTwoHours).toEqual({
        used: 10,
        limit: 10,
        percent: 100,
        nextReleaseAt: "2032-01-09T12:00:00.000Z",
      });
      expect(usage.utcDay).toMatchObject({ used: 10, limit: 30 });
      expect(usage.restriction).toEqual({
        reason: "two_hours",
        retryAt: "2032-01-09T12:00:00.000Z",
      });
      await expect(ask(caller, context.clientAddress)).resolves.toEqual({
        status: "quota_exceeded",
        retryAt: new Date("2032-01-09T12:00:00.000Z"),
      });

      at("2032-01-09T12:00:00.000Z");
      const released = await chat.usage(caller, context);
      expect(released.rollingTwoHours).toMatchObject({
        used: 9,
        nextReleaseAt: "2032-01-09T12:11:00.000Z",
      });
      expect(released.restriction).toBeNull();
      expect((await ask(caller, context.clientAddress)).status).toBe("admitted");
    });

    it("restricts an identity at thirty per UTC day until the next UTC midnight", async () => {
      at("2032-01-10T00:00:00.000Z");
      const caller = await newCaller();
      const context = { clientAddress: "203.0.113.6" };
      for (let index = 0; index < 30; index += 1) {
        await answeredFrom(caller, context.clientAddress, `Question ${String(index)}?`);
        later(13 * minuteMs);
      }

      const usage = await chat.usage(caller, context);
      expect(usage.utcDay).toEqual({
        used: 30,
        limit: 30,
        percent: 100,
        resetsAt: "2032-01-11T00:00:00.000Z",
      });
      expect(usage.rollingTwoHours.used).toBe(9);
      expect(usage.restriction).toEqual({ reason: "day", retryAt: "2032-01-11T00:00:00.000Z" });
      await expect(ask(caller, context.clientAddress)).resolves.toEqual({
        status: "quota_exceeded",
        retryAt: new Date("2032-01-11T00:00:00.000Z"),
      });

      at("2032-01-10T23:59:59.999Z");
      expect((await chat.usage(caller, context)).restriction).toMatchObject({ reason: "day" });
      at("2032-01-11T00:00:00.000Z");
      const reset = await chat.usage(caller, context);
      expect(reset.utcDay).toMatchObject({ used: 0, resetsAt: "2032-01-12T00:00:00.000Z" });
      expect(reset.restriction).toBeNull();
      expect((await ask(caller, context.clientAddress)).status).toBe("admitted");
    });

    it("restricts a shared network at twenty per minute however many cookies it cycles", async () => {
      at("2032-01-11T10:00:00.000Z");
      const shared = "203.0.113.7";
      for (let index = 0; index < 20; index += 1) {
        await answeredFrom(await newCaller(), shared);
        later(1000);
      }
      const fresh = await newCaller();

      const usage = await chat.usage(fresh, { clientAddress: shared });
      expect(usage.rollingTwoHours.used).toBe(0);
      expect(usage.utcDay.used).toBe(0);
      expect(usage.restriction).toEqual({
        reason: "shared_network",
        retryAt: "2032-01-11T10:01:00.000Z",
      });
      await expect(ask(fresh, shared)).resolves.toEqual({
        status: "quota_exceeded",
        retryAt: new Date("2032-01-11T10:01:00.000Z"),
      });
      expect((await chat.usage(fresh, { clientAddress: "203.0.113.8" })).restriction).toBeNull();
      expect((await ask(fresh, "203.0.113.8")).status).toBe("admitted");
    });

    it("restricts a shared network at a hundred per UTC day", async () => {
      at("2032-01-12T00:00:00.000Z");
      const shared = "203.0.113.9";
      for (let index = 0; index < 100; index += 1) {
        await answeredFrom(await newCaller(), shared);
        later(4000);
      }
      const fresh = await newCaller();

      expect((await chat.usage(fresh, { clientAddress: shared })).restriction).toEqual({
        reason: "shared_network",
        retryAt: "2032-01-13T00:00:00.000Z",
      });
      await expect(ask(fresh, shared)).resolves.toEqual({
        status: "quota_exceeded",
        retryAt: new Date("2032-01-13T00:00:00.000Z"),
      });
    });

    it("keeps counting through a cleared conversation and a restarted service", async () => {
      at("2032-01-13T10:00:00.000Z");
      const caller = await newCaller();
      const context = { clientAddress: "203.0.113.10" };
      for (let index = 0; index < 5; index += 1) {
        await answeredFrom(caller, context.clientAddress, `Question ${String(index)}?`);
        later(1000);
      }
      const cleared = await chat.clear(caller, { conversationId: caller.conversationId });
      const after = {
        identityId: caller.identityId,
        conversationId: cleared.cleared.conversation.conversationId,
      };
      chat = createChatService(persistence.chat, { config, verifier, now: () => now });

      const usage = await chat.usage(after, context);
      expect(usage.rollingTwoHours.used).toBe(5);
      expect(usage.restriction).toMatchObject({ reason: "minute" });
      await expect(ask(after, context.clientAddress)).resolves.toMatchObject({
        status: "quota_exceeded",
      });
    });

    it("gives back work that never started and counts paid failures, refusals and explicit retries", async () => {
      at("2032-01-14T10:00:00.000Z");
      const caller = await newCaller();
      const context = { clientAddress: "203.0.113.11" };
      const used = async () => (await chat.usage(caller, context)).rollingTwoHours.used;

      const refusedDispatch = await admittedFrom(caller, context.clientAddress, "One?");
      await chat.dispatchRefused(refusedDispatch.operationId);
      expect(await used()).toBe(0);
      later(1000);

      const noWork = await admittedFrom(caller, context.clientAddress, "Two?");
      await settle(noWork, {
        outcome: "cancelled",
        usage: {
          costUsd: 0,
          costUncertain: false,
          inputTokens: 0,
          outputTokens: 0,
          modelAttempts: 0,
        },
      });
      expect(await used()).toBe(0);
      later(1000);

      const paid = await admittedFrom(caller, context.clientAddress, "Three?");
      await settle(paid, { outcome: "cancelled" });
      expect(await used()).toBe(1);
      later(1000);

      const retried = await chat.retry(
        caller,
        paid.operationId,
        { retryId: randomUUID(), challengeToken: `fictional-token-${randomUUID()}` },
        context,
      );
      if (retried.status !== "admitted")
        throw new Error(`Expected a retry, got ${retried.status}.`);
      expect(await used()).toBe(2);
      await answer(retried.dispatch);
      later(1000);

      const refusal = await admittedFrom(caller, context.clientAddress, "Four?");
      await settle(refusal, {
        ...answerFor(refusal.grant, "I can only talk about the portfolio."),
        outcome: "refused",
        blocks: [],
        sources: [],
      });
      expect(await used()).toBe(3);
    });

    it("names the service budget, without an amount, until the full window ends", async () => {
      at("2032-01-15T10:00:00.000Z");
      const context = { clientAddress: "203.0.113.12" };
      chat = createChatService(persistence.chat, {
        config,
        verifier,
        now: () => now,
        policy: { ...chatPolicy, dailySpendLimitMicroUsd: 1 },
      });
      const caller = await newCaller();

      const daily = await chat.usage(caller, context);
      expect(daily.restriction).toEqual({
        reason: "service_budget",
        retryAt: "2032-01-16T00:00:00.000Z",
      });
      expect(daily.rollingTwoHours.used).toBe(0);
      await expect(ask(caller, context.clientAddress)).resolves.toEqual({
        status: "budget_exhausted",
      });

      chat = createChatService(persistence.chat, {
        config,
        verifier,
        now: () => now,
        policy: { ...chatPolicy, monthlySpendLimitMicroUsd: 1 },
      });
      expect((await chat.usage(caller, context)).restriction).toEqual({
        reason: "service_budget",
        retryAt: "2032-02-01T00:00:00.000Z",
      });
    });
  });

  describe("the conversation lifecycle", () => {
    const token = () => `fictional-token-${randomUUID()}`;
    const retrySubmission = (retryId = randomUUID()) => ({ retryId, challengeToken: token() });
    const context = () => ({ clientAddress: nextAddress() });

    /** A claimed attempt that ended with a retryable timeout. */
    const timedOut = async (caller: ChatCaller, question?: string) => {
      const dispatch = await admitted(caller, question);
      await chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });
      await chat.reconcile(dispatch.operationId, {
        ...answerFor(dispatch.grant, ""),
        outcome: "limit_reached",
        reason: "deadline",
        blocks: [],
        sources: [],
      });
      now = new Date(now.getTime() + 1000);
      return dispatch;
    };

    describe("retry", () => {
      it("asks the same question again as a new attempt of the same request", async () => {
        const caller = await newCaller();
        const failed = await timedOut(caller, "What is the newest project?");
        const original = await chat.operation(caller, failed.operationId);
        const calls = verifier.calls;

        const result = await chat.retry(caller, failed.operationId, retrySubmission(), context());

        expect(result.status).toBe("admitted");
        if (result.status !== "admitted") return;
        expect(verifier.calls).toBe(calls + 1);
        expect(result.operation.requestId).toBe(original?.requestId);
        expect(result.operation.operationId).not.toBe(failed.operationId);
        expect(result.dispatch).toMatchObject({
          operationId: result.operation.operationId,
          question: "What is the newest project?",
          history: [],
        });
        expect(result.dispatch.grant).not.toBe(failed.grant);
        const conversation = await chat.conversation(caller, { limit: 20 });
        expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
        expect(conversation.messages[1]).toMatchObject({
          id: result.operation.assistantMessageId,
          status: "pending",
        });
        expect(conversation.activeOperation).toEqual(result.operation);
      });

      it("recovers a repeated retry and an active or completed attempt without a challenge", async () => {
        const caller = await newCaller();
        const failed = await timedOut(caller);
        const submission = retrySubmission();
        const first = await chat.retry(caller, failed.operationId, submission, context());
        if (first.status !== "admitted") throw new Error(first.status);
        const calls = verifier.calls;

        await expect(
          chat.retry(
            caller,
            failed.operationId,
            { ...submission, challengeToken: token() },
            context(),
          ),
        ).resolves.toEqual({ status: "existing", operation: first.operation });
        await expect(chat.retry(caller, randomUUID(), submission, context())).resolves.toEqual({
          status: "conflict",
        });
        await expect(
          chat.retry(caller, failed.operationId, retrySubmission(), context()),
        ).resolves.toEqual({ status: "existing", operation: first.operation });
        expect(verifier.calls).toBe(calls);
      });

      it("refuses a failed challenge, another identity's attempt and a non-retryable failure", async () => {
        const caller = await newCaller();
        const failed = await timedOut(caller);
        verifier.answer = false;
        await expect(
          chat.retry(caller, failed.operationId, retrySubmission(), context()),
        ).resolves.toEqual({ status: "challenge_failed" });
        verifier.answer = true;
        expect((await chat.conversation(caller, { limit: 20 })).activeOperation).toBeNull();

        const stranger = await newCaller();
        await expect(
          chat.retry(stranger, failed.operationId, retrySubmission(), context()),
        ).resolves.toEqual({ status: "not_found" });
        await expect(
          chat.retry(caller, "not-an-id", retrySubmission(), context()),
        ).resolves.toEqual({ status: "not_found" });

        const other = await newCaller();
        const invalid = await admitted(other);
        await chat.claim({ operationId: invalid.operationId, grant: invalid.grant });
        await chat.reconcile(invalid.operationId, { ...answerFor(invalid.grant), blocks: [{}] });
        await expect(
          chat.retry(other, invalid.operationId, retrySubmission(), context()),
        ).resolves.toEqual({ status: "not_retryable" });
      });
    });

    describe("stop", () => {
      it("cancels a running generation as a retryable cancellation and frees the identity", async () => {
        const caller = await newCaller();
        const dispatch = await admitted(caller);
        await chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });

        const stopped = await chat.stop(caller, dispatch.operationId);

        expect(stopped).toMatchObject({
          status: "stopped",
          running: true,
          operation: { operationId: dispatch.operationId, status: "cancelled" },
        });
        const observed = await chat.observe(caller, dispatch.operationId);
        expect(observed?.terminal).toBe(true);
        expect(observed?.assistant).toMatchObject({
          status: "cancelled",
          error: { code: "cancelled", retryable: true },
          text: null,
        });
        expect(observed?.events.at(-1)).toMatchObject({
          type: "error",
          code: "cancelled",
          retryable: true,
        });
        await expect(
          chat.reconcile(dispatch.operationId, answerFor(dispatch.grant)),
        ).resolves.toMatchObject({ status: "already" });
        expect((await chat.observe(caller, dispatch.operationId))?.assistant.text).toBeNull();
        await expect(chat.stop(caller, dispatch.operationId)).resolves.toMatchObject({
          status: "finished",
        });
        now = new Date(now.getTime() + 1000);
        await admitted(caller, "Again?");
      });

      it("cancels an unclaimed operation without a generation to stop and refuses its grant", async () => {
        const caller = await newCaller();
        const dispatch = await admitted(caller);
        await expect(chat.stop(caller, dispatch.operationId)).resolves.toMatchObject({
          status: "stopped",
          running: false,
        });
        await expect(
          chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant }),
        ).resolves.toEqual({ status: "refused" });
      });

      it("never stops another identity's operation or an unknown one", async () => {
        const dispatch = await admitted(await newCaller());
        const stranger = await newCaller();
        await expect(chat.stop(stranger, dispatch.operationId)).resolves.toBeNull();
        await expect(chat.stop(stranger, "not-an-id")).resolves.toBeNull();
        await expect(chat.stop(stranger, randomUUID())).resolves.toBeNull();
      });
    });

    describe("clear", () => {
      it("cancels active work, deletes the messages and opens a fresh conversation", async () => {
        const opened = await chat.open(null);
        const caller = opened.caller;
        await answer(await admitted(caller));
        now = new Date(now.getTime() + 1000);
        const active = await admitted(caller, "Another question?");
        await chat.claim({ operationId: active.operationId, grant: active.grant });

        const result = await chat.clear(caller, { conversationId: caller.conversationId });

        expect(result.cancelled).toEqual([active.operationId]);
        expect(result.cleared).toMatchObject({
          cleared: true,
          telemetryDeletion: "none",
          conversation: {
            messages: [],
            nextCursor: null,
            activeOperation: null,
            retentionDays: 730,
          },
        });
        expect(result.cleared.conversation.conversationId).not.toBe(caller.conversationId);
        const again = await chat.open(opened.cookie);
        expect(again.caller).toEqual({
          identityId: caller.identityId,
          conversationId: result.cleared.conversation.conversationId,
        });
        await expect(chat.observe(again.caller, active.operationId)).resolves.toBeNull();
        await expect(chat.reconcile(active.operationId, answerFor(active.grant))).resolves.toEqual({
          status: "deleted",
        });
        expect((await chat.conversation(again.caller, { limit: 20 })).messages).toEqual([]);
      });

      it("clears nothing when the conversation id is not the caller's", async () => {
        const caller = await newCaller();
        await answer(await admitted(caller));
        const result = await chat.clear(caller, { conversationId: randomUUID() });
        expect(result.cancelled).toEqual([]);
        expect(result.cleared.cleared).toBe(false);
        expect(result.cleared.telemetryDeletion).toBe("none");
        expect(result.cleared.conversation.conversationId).toBe(caller.conversationId);
        expect(result.cleared.conversation.messages).toHaveLength(2);
      });
    });
  });

  describe("compaction", () => {
    const summary: ChatContextSummary = {
      language: "en",
      goals: ["Choose a fictional service."],
      openQuestions: ["Which plan fits a small team?"],
      covered: ["The fictional services were listed."],
      visitorClaims: ["The visitor says they run a small team."],
      references: [{ kind: "service", recordId: "svc-1", title: "Fictional service" }],
    };

    const compactedFor = (grant: string, kept = 1): ChatCompactionResult => ({
      grant,
      outcome: "compacted",
      reason: null,
      summary,
      kept,
      summaryTokens: 120,
      nextInputTokens: 900,
      usage: {
        costUsd: 0.003,
        costUncertain: false,
        inputTokens: 2000,
        outputTokens: 150,
        modelAttempts: 1,
      },
      versions: { prompt: "compaction-v1" },
      latencyMs: 900,
    });

    const compact = (
      caller: ChatCaller,
      requestId: string = randomUUID(),
      challengeToken = `fictional-token-${randomUUID()}`,
    ) => chat.compact(caller, { requestId, challengeToken }, { clientAddress: nextAddress() });

    /** A caller whose working context holds `count` answered exchanges. */
    const withExchanges = async (count: number) => {
      const caller = await newCaller();
      for (let index = 0; index < count; index += 1) {
        await answer(
          await admitted(caller, `Question ${String(index)}?`),
          `Answer ${String(index)}.`,
        );
        now = new Date(now.getTime() + 61_000);
      }
      return caller;
    };

    const started = async (caller: ChatCaller) => {
      const result = await compact(caller);
      if (result.status !== "started") throw new Error(`Expected a start, got ${result.status}.`);
      return result;
    };

    it("is a local no-op for a small working context: no challenge, quota or spend", async () => {
      const empty = await newCaller();
      const small = await withExchanges(2);
      const calls = verifier.calls;
      const before = await chat.usage(small, { clientAddress: null });

      await expect(compact(empty)).resolves.toEqual({
        status: "noop",
        reason: "nothing_to_compact",
      });
      await expect(compact(small)).resolves.toEqual({
        status: "noop",
        reason: "nothing_to_compact",
      });

      expect(verifier.calls).toBe(calls);
      const after = await chat.usage(small, { clientAddress: null });
      expect(after.utcDay.used).toBe(before.utcDay.used);
      expect(after.activeOperation).toBeNull();
    });

    it("starts a compaction of the working context without appending a visitor message", async () => {
      const caller = await withExchanges(3);
      const calls = verifier.calls;

      const result = await started(caller);

      expect(verifier.calls).toBe(calls + 1);
      expect(ChatOperationSchema.parse(result.operation)).toEqual(result.operation);
      expect(result.operation).toMatchObject({
        kind: "compaction",
        status: "accepted",
        assistantMessageId: null,
        compaction: null,
      });
      expect(result.dispatch).toMatchObject({
        operationId: result.operation.operationId,
        summary: null,
        contextRevision: 3,
        model: "fictional-model",
        effort: "medium",
        pricingVersion: "fictional-pricing-1",
        allowanceUsd: 0.02,
        deadlineAt: result.operation.deadlineAt,
      });
      expect(result.dispatch.grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(result.dispatch.exchanges.map((exchange) => exchange.question)).toEqual([
        "Question 0?",
        "Question 1?",
        "Question 2?",
      ]);
      const conversation = await chat.conversation(caller, { limit: 20 });
      expect(conversation.messages).toHaveLength(6);
      expect(conversation.activeOperation).toEqual(result.operation);
      expect(JSON.stringify(conversation)).not.toContain(result.dispatch.grant);
    });

    it("recovers a repeated request without a challenge and refuses a question's request id", async () => {
      const caller = await withExchanges(3);
      const requestId = randomUUID();
      const first = await compact(caller, requestId);
      if (first.status !== "started") throw new Error(first.status);
      const calls = verifier.calls;

      await expect(compact(caller, requestId)).resolves.toEqual({
        status: "existing",
        operation: first.operation,
      });
      await expect(
        chat.submit(
          caller,
          { requestId, question: "What do you build?", challengeToken: "fictional-token" },
          { clientAddress: nextAddress() },
        ),
      ).resolves.toEqual({ status: "conflict" });
      expect(verifier.calls).toBe(calls);

      const asking = await withExchanges(3);
      const question = await admitted(asking, "One more?");
      const questionRequest = (await chat.operation(asking, question.operationId))?.requestId;
      await expect(compact(asking, questionRequest)).resolves.toEqual({ status: "conflict" });
    });

    it("is refused while another operation is active, in either direction, before any challenge", async () => {
      const caller = await withExchanges(3);
      const asking = await admitted(caller, "Still answering?");
      const calls = verifier.calls;

      const busy = await compact(caller);

      expect(busy).toMatchObject({
        status: "busy",
        operation: { operationId: asking.operationId },
      });
      expect(verifier.calls).toBe(calls);
      await answer(asking);
      now = new Date(now.getTime() + 61_000);

      const compaction = await started(caller);
      await expect(submit(caller, "And now?")).resolves.toEqual({
        status: "busy",
        operation: compaction.operation,
      });
    });

    it("refuses a failed challenge and starts nothing", async () => {
      const caller = await withExchanges(3);
      verifier.answer = false;

      await expect(compact(caller)).resolves.toEqual({ status: "challenge_failed" });

      verifier.answer = true;
      expect((await chat.conversation(caller, { limit: 20 })).activeOperation).toBeNull();
    });

    it("binds the grant claim to a compaction, and an answer's result is refused for it", async () => {
      const caller = await withExchanges(3);
      const { dispatch } = await started(caller);

      const claim = await chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });

      expect(claim).toMatchObject({
        status: "claimed",
        claimed: { kind: "compaction", contextRevision: 3, allowanceUsd: 0.02 },
      });
      await expect(
        chat.reconcile(dispatch.operationId, answerFor(dispatch.grant)),
      ).resolves.toEqual({ status: "wrong_grant" });
    });

    it("installs a valid summary at its revision; the next question carries it and only the kept exchanges", async () => {
      const caller = await withExchanges(3);
      const { dispatch } = await started(caller);
      await chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });

      const result = await chat.reconcileCompaction(
        dispatch.operationId,
        compactedFor(dispatch.grant, 1),
      );
      const repeat = await chat.reconcileCompaction(
        dispatch.operationId,
        compactedFor(dispatch.grant, 2),
      );

      expect(result).toMatchObject({
        status: "reconciled",
        operation: { status: "completed", compaction: { outcome: "compacted", reason: null } },
      });
      expect(repeat.status).toBe("already");
      await expect(chat.observe(caller, dispatch.operationId)).resolves.toBeNull();
      await expect(chat.operation(caller, dispatch.operationId)).resolves.toMatchObject({
        kind: "compaction",
        status: "completed",
      });
      expect((await chat.conversation(caller, { limit: 20 })).messages).toHaveLength(6);

      now = new Date(now.getTime() + 61_000);
      const next = await admitted(caller, "And the price?");
      expect(next.summary).toEqual(summary);
      expect(next.history.map((exchange) => exchange.question)).toEqual(["Question 2?"]);
      expect(next.contextRevision).toBe(4);
      await answer(next, "A fictional price.");
      now = new Date(now.getTime() + 61_000);

      // A later compaction summarises the summary together with the exchanges after it.
      const again = await compact(caller);
      expect(again.status).toBe("noop");
      const more = await admitted(caller, "And the timeline?");
      await answer(more, "A fictional timeline.");
      now = new Date(now.getTime() + 61_000);
      const second = await started(caller);
      expect(second.dispatch.summary).toEqual(summary);
      expect(second.dispatch.exchanges.map((exchange) => exchange.question)).toEqual([
        "Question 2?",
        "And the price?",
        "And the timeline?",
      ]);
    });

    it("keeps the prior working context after a failed, invalid or stopped compaction", async () => {
      const caller = await withExchanges(3);
      const failed = await started(caller);
      await chat.claim({ operationId: failed.dispatch.operationId, grant: failed.dispatch.grant });
      await expect(
        chat.reconcileCompaction(failed.dispatch.operationId, {
          ...compactedFor(failed.dispatch.grant),
          outcome: "failed",
          reason: "provider",
          summary: null,
          kept: 0,
          summaryTokens: 0,
          nextInputTokens: null,
        }),
      ).resolves.toMatchObject({
        status: "reconciled",
        operation: { status: "failed", compaction: { outcome: "failed", reason: "provider" } },
      });
      now = new Date(now.getTime() + 61_000);

      const invalid = await started(caller);
      await chat.claim({
        operationId: invalid.dispatch.operationId,
        grant: invalid.dispatch.grant,
      });
      await expect(
        chat.reconcileCompaction(invalid.dispatch.operationId, {
          ...compactedFor(invalid.dispatch.grant),
          summary: { language: "en", goals: ["x".repeat(5000)] },
        }),
      ).resolves.toMatchObject({
        status: "reconciled",
        operation: { compaction: { outcome: "failed", reason: "invalid_result" } },
      });
      now = new Date(now.getTime() + 61_000);

      const stopped = await started(caller);
      await chat.claim({
        operationId: stopped.dispatch.operationId,
        grant: stopped.dispatch.grant,
      });
      await expect(chat.stop(caller, stopped.dispatch.operationId)).resolves.toMatchObject({
        status: "stopped",
        running: true,
        operation: { status: "cancelled" },
      });
      await expect(
        chat.reconcileCompaction(
          stopped.dispatch.operationId,
          compactedFor(stopped.dispatch.grant),
        ),
      ).resolves.toMatchObject({ status: "already" });
      now = new Date(now.getTime() + 61_000);

      const next = await admitted(caller, "Where were we?");
      expect(next.summary).toBeNull();
      expect(next.history).toHaveLength(3);
      expect(next.contextRevision).toBe(3);
    });

    it("refuses a result without a grant, for an unclaimed compaction, or for an answer", async () => {
      const caller = await withExchanges(3);
      const { dispatch } = await started(caller);

      await expect(chat.reconcileCompaction(dispatch.operationId, { kept: 1 })).resolves.toEqual({
        status: "invalid",
      });
      await expect(
        chat.reconcileCompaction(dispatch.operationId, compactedFor(dispatch.grant)),
      ).resolves.toEqual({ status: "not_claimed" });
      await expect(
        chat.reconcileCompaction("not-an-id", compactedFor(dispatch.grant)),
      ).resolves.toEqual({ status: "wrong_grant" });

      const asking = await admitted(await newCaller());
      await chat.claim({ operationId: asking.operationId, grant: asking.grant });
      await expect(
        chat.reconcileCompaction(asking.operationId, compactedFor(asking.grant)),
      ).resolves.toEqual({ status: "wrong_grant" });
    });

    it("is never retried as a question", async () => {
      const caller = await withExchanges(3);
      const { dispatch } = await started(caller);
      await chat.dispatchRefused(dispatch.operationId);

      await expect(
        chat.retry(
          caller,
          dispatch.operationId,
          { retryId: randomUUID(), challengeToken: "fictional-token" },
          { clientAddress: nextAddress() },
        ),
      ).resolves.toEqual({ status: "not_retryable" });
    });

    it("counts against the visitor's quota and reports the post-compaction estimate", async () => {
      const caller = await withExchanges(3);
      const { dispatch } = await started(caller);
      await chat.claim({ operationId: dispatch.operationId, grant: dispatch.grant });
      now = new Date(now.getTime() + 2000);
      await chat.reconcileCompaction(dispatch.operationId, compactedFor(dispatch.grant));

      const usage = await chat.usage(caller, { clientAddress: null });

      expect(usage.utcDay.used).toBe(4);
      expect(usage.nextRequest).toEqual({
        status: "estimated",
        historyTokens: 900,
        operationId: dispatch.operationId,
        measuredAt: now.toISOString(),
      });
      expect(ChatUsageSchema.parse(usage)).toEqual(usage);
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
