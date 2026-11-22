import { randomUUID } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import {
  chatPruneBatch,
  createChatPersistence,
  type ChatAdmissionInput,
  type ChatClearInput,
  type ChatRequestClaimInput,
  type ChatRetryInput,
  type ChatIdentityRecord,
  type ChatPersistence,
  type ChatResultRecord,
} from "./index.js";

// Fictional values only; verifiers and hashes stand in for the services' one-way digests.
const allowance = 20_000;
const roomy = 1_000_000_000;
const timeout = { code: "timeout", retryable: true };

let counter = 0;
const unique = (prefix: string) => `${prefix}-${String(++counter)}-${randomUUID()}`;

describe("chat persistence", () => {
  let database: TemporaryDatabase;
  let connection: Connection;
  let chat: ChatPersistence;

  beforeAll(async () => {
    database = await createTemporaryDatabase(readDatabaseConfig(process.env));
    connection = openConnection(database.config);
    chat = createChatPersistence(connection.db);
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  const at = new Date("2026-11-22T10:00:00.000Z");
  const later = (ms: number, from = at) => new Date(from.getTime() + ms);

  const identity = () => chat.createIdentity(unique("verifier"), at);

  const admission = (
    caller: ChatIdentityRecord,
    overrides: Partial<ChatAdmissionInput> = {},
  ): ChatAdmissionInput => {
    const when = overrides.at ?? at;
    return {
      identityId: caller.identityId,
      conversationId: caller.conversation.id,
      requestId: randomUUID(),
      question: "What does Alex build?",
      questionHash: "question-hash",
      challengeTokenHash: unique("token"),
      fingerprint: unique("fingerprint"),
      at: when,
      deadlineAt: later(60_000, when),
      grantVerifier: "grant-verifier",
      model: "fake",
      pricingVersion: "2026-11",
      allowanceMicroUsd: allowance,
      quotas: [],
      admissionExpiresAt: later(86_400_000, when),
      spend: [
        {
          kind: "day",
          startsOn: "2030-01-01",
          limitMicroUsd: roomy,
        },
      ],
      ...overrides,
    };
  };

  const admitted = async (input: ChatAdmissionInput) => {
    const result = await chat.admit(input);
    if (result.status !== "admitted")
      throw new Error(`Expected an admission, got ${result.status}`);
    return result.operation;
  };

  const answered = (overrides: Partial<ChatResultRecord> = {}): ChatResultRecord => ({
    status: "completed",
    outcome: "answered",
    errorCode: null,
    errorRetryable: null,
    text: "Alex builds data platforms.",
    language: "en",
    blocks: [],
    sources: [{ record: { kind: "person", id: "alex" }, title: "Alex", href: "/" }],
    related: [],
    resultOutcome: "answered",
    resultReason: null,
    costMicroUsd: 4_000,
    inputTokens: 1_000,
    outputTokens: 100,
    modelAttempts: 3,
    latencyMs: 4_000,
    versions: { prompt: "chat-v1" },
    advancesRevision: true,
    ...overrides,
  });

  /** Claims and reconciles an operation so its identity is free again. */
  const finish = async (operationId: string, result = answered()) => {
    const claim = await chat.claimGrant(operationId, "grant-verifier", at);
    expect(claim.status).toBe("claimed");
    const reconciled = await chat.reconcile(operationId, "grant-verifier", at, result);
    expect(reconciled.status).toBe("reconciled");
  };

  describe("identities and conversations", () => {
    it("resolves an identity by its verifier with its single conversation", async () => {
      const created = await chat.createIdentity("verifier-known", at);
      const resolved = await chat.resolveIdentity("verifier-known", later(1000));
      expect(resolved).toEqual({
        identityId: created.identityId,
        conversation: { ...created.conversation, lastActivityAt: expect.any(Date) as Date },
      });
      await expect(chat.resolveIdentity("verifier-unknown", at)).resolves.toBeNull();
    });

    it("enforces one conversation per identity in the database", async () => {
      const caller = await identity();
      await expect(
        connection.db.execute(
          sql`INSERT INTO chat.conversations (identity_id, created_at, last_activity_at) VALUES (${caller.identityId}, now(), now())`,
        ),
      ).rejects.toThrow();
    });

    it("stores no client address, cookie value, grant or challenge token", async () => {
      const result = await connection.db.execute<{ column_name: string } & Record<string, unknown>>(
        sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'chat'`,
      );
      const names = result.rows.map((row) => row.column_name);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(name).not.toMatch(/(^|_)(ip|address|cookie|grant|token|secret)($|_)/);
      }
    });
  });

  describe("admission", () => {
    it("appends the question and a pending answer and creates an accepted operation", async () => {
      const caller = await identity();
      const operation = await admitted(admission(caller, { question: "Who is Alex?" }));
      expect(operation.status).toBe("accepted");
      expect(operation.contextRevision).toBe(0);
      const page = await chat.listMessages(caller.conversation.id, { limit: 20 });
      expect(page.hasMore).toBe(false);
      expect(page.messages.map((message) => [message.role, message.status, message.text])).toEqual([
        ["user", "completed", "Who is Alex?"],
        ["assistant", "pending", null],
      ]);
      expect(page.messages[1]?.id).toBe(operation.assistantMessageId);
      await expect(chat.findActiveOperation(caller.identityId)).resolves.toEqual(operation);
    });

    it("recovers a repeated request instead of appending it again", async () => {
      const caller = await identity();
      const input = admission(caller);
      const first = await admitted(input);
      const again = await chat.admit({ ...input, challengeTokenHash: unique("token") });
      expect(again).toEqual({ status: "duplicate", operation: first, sameQuestion: true });
      const conflicting = await chat.admit({
        ...input,
        questionHash: "other-question",
        challengeTokenHash: unique("token"),
      });
      expect(conflicting).toEqual({ status: "duplicate", operation: first, sameQuestion: false });
      const page = await chat.listMessages(caller.conversation.id, { limit: 20 });
      expect(page.messages).toHaveLength(2);
    });

    it("admits one of many concurrent duplicate submissions", async () => {
      const caller = await identity();
      const input = admission(caller);
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          chat.admit({ ...input, challengeTokenHash: unique("token") }),
        ),
      );
      expect(results.filter((result) => result.status === "admitted")).toHaveLength(1);
      expect(results.filter((result) => result.status === "duplicate")).toHaveLength(5);
      const page = await chat.listMessages(caller.conversation.id, { limit: 20 });
      expect(page.messages).toHaveLength(2);
    });

    it("keeps one active operation per identity under concurrent different requests", async () => {
      const caller = await identity();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => chat.admit(admission(caller))),
      );
      expect(results.filter((result) => result.status === "admitted")).toHaveLength(1);
      expect(results.filter((result) => result.status === "busy")).toHaveLength(5);
    });

    it("refuses a challenge token that already admitted a question", async () => {
      const token = unique("token");
      await admitted(admission(await identity(), { challengeTokenHash: token }));
      const second = await identity();
      await expect(chat.admit(admission(second, { challengeTokenHash: token }))).resolves.toEqual({
        status: "challenge_reused",
      });
      await expect(chat.findActiveOperation(second.identityId)).resolves.toBeNull();
    });

    it("refuses an identity over its rolling quota and says when the oldest admission ages out", async () => {
      const caller = await identity();
      const quotas = (when: Date) => [
        { scope: "identity" as const, since: later(-60_000, when), limit: 2, resetsAt: null },
      ];
      const first = await admitted(admission(caller, { quotas: quotas(at) }));
      await finish(first.id);
      const second = await admitted(
        admission(caller, { at: later(10_000), quotas: quotas(later(10_000)) }),
      );
      await finish(second.id);
      const third = await chat.admit(
        admission(caller, { at: later(20_000), quotas: quotas(later(20_000)) }),
      );
      expect(third).toEqual({
        status: "quota_exceeded",
        scope: "identity",
        retryAt: later(60_000),
      });
    });

    it("counts the fingerprint across identities and reports a fixed window's reset", async () => {
      const fingerprint = unique("fingerprint");
      const resetsAt = new Date("2026-11-23T00:00:00.000Z");
      const quotas = [
        {
          scope: "fingerprint" as const,
          since: new Date("2026-11-22T00:00:00.000Z"),
          limit: 1,
          resetsAt,
        },
      ];
      await admitted(admission(await identity(), { fingerprint, quotas }));
      await expect(
        chat.admit(admission(await identity(), { fingerprint, quotas })),
      ).resolves.toEqual({ status: "quota_exceeded", scope: "fingerprint", retryAt: resetsAt });
    });

    it("reserves the allowance in every window and refuses without storing anything", async () => {
      const day = "2031-03-31";
      const nextDay = "2031-04-01";
      const spend = [
        { kind: "day" as const, startsOn: day, limitMicroUsd: 30_000 },
        { kind: "day" as const, startsOn: nextDay, limitMicroUsd: 30_000 },
      ];
      await admitted(admission(await identity(), { spend }));
      expect(await chat.committedSpend("day", day)).toBe(allowance);
      expect(await chat.committedSpend("day", nextDay)).toBe(allowance);

      const refused = await identity();
      const token = unique("token");
      await expect(
        chat.admit(admission(refused, { spend, challengeTokenHash: token })),
      ).resolves.toEqual({ status: "budget_exhausted" });
      expect(await chat.committedSpend("day", day)).toBe(allowance);
      expect(await chat.committedSpend("day", nextDay)).toBe(allowance);
      const page = await chat.listMessages(refused.conversation.id, { limit: 20 });
      expect(page.messages).toEqual([]);
      // The token was not bound, so a later admission may still redeem it.
      await admitted(admission(refused, { challengeTokenHash: token }));
    });

    it("never reserves more than a window's limit under concurrent admissions", async () => {
      const startsOn = "2032-05-01";
      const spend = [{ kind: "month" as const, startsOn, limitMicroUsd: 3 * allowance }];
      const callers = await Promise.all(Array.from({ length: 8 }, () => identity()));
      const results = await Promise.all(
        callers.map((caller) => chat.admit(admission(caller, { spend }))),
      );
      expect(results.filter((result) => result.status === "admitted")).toHaveLength(3);
      expect(await chat.committedSpend("month", startsOn)).toBe(3 * allowance);
    });
  });

  describe("grants", () => {
    it("claims a grant once and moves the operation to running", async () => {
      const operation = await admitted(admission(await identity()));
      const claim = await chat.claimGrant(operation.id, "grant-verifier", later(1000));
      expect(claim).toEqual({ status: "claimed", operation: { ...operation, status: "running" } });
      await expect(chat.claimGrant(operation.id, "grant-verifier", later(2000))).resolves.toEqual({
        status: "refused",
      });
    });

    it("refuses another grant and an unknown operation without claiming", async () => {
      const operation = await admitted(admission(await identity()));
      await expect(chat.claimGrant(operation.id, "other-verifier", at)).resolves.toEqual({
        status: "wrong_grant",
      });
      await expect(chat.claimGrant(randomUUID(), "grant-verifier", at)).resolves.toEqual({
        status: "wrong_grant",
      });
      expect((await chat.claimGrant(operation.id, "grant-verifier", at)).status).toBe("claimed");
    });

    it("refuses an expired grant", async () => {
      const operation = await admitted(admission(await identity()));
      await expect(chat.claimGrant(operation.id, "grant-verifier", later(60_000))).resolves.toEqual(
        { status: "refused" },
      );
    });

    it("claims once under concurrent claims", async () => {
      const operation = await admitted(admission(await identity()));
      const claims = await Promise.all(
        Array.from({ length: 6 }, () => chat.claimGrant(operation.id, "grant-verifier", at)),
      );
      expect(claims.filter((claim) => claim.status === "claimed")).toHaveLength(1);
    });
  });

  describe("reconciling", () => {
    it("stores the answer once, completes the operation and settles the known cost", async () => {
      const startsOn = "2033-01-01";
      const caller = await identity();
      const operation = await admitted(
        admission(caller, { spend: [{ kind: "day", startsOn, limitMicroUsd: roomy }] }),
      );
      await chat.claimGrant(operation.id, "grant-verifier", at);
      const result = await chat.reconcile(operation.id, "grant-verifier", later(5000), answered());
      expect(result).toEqual({
        status: "reconciled",
        operation: { ...operation, status: "completed" },
      });
      expect(await chat.committedSpend("day", startsOn)).toBe(4_000);

      const repeat = await chat.reconcile(
        operation.id,
        "grant-verifier",
        later(6000),
        answered({ text: "A different answer.", costMicroUsd: 9_000 }),
      );
      expect(repeat).toEqual({
        status: "already",
        operation: { ...operation, status: "completed" },
      });
      expect(await chat.committedSpend("day", startsOn)).toBe(4_000);

      const found = await chat.findOperation(caller.identityId, operation.id);
      expect(found?.assistant).toMatchObject({
        status: "completed",
        outcome: "answered",
        text: "Alex builds data platforms.",
        language: "en",
      });
      const resolved = await chat.resolveIdentity(
        (
          await connection.db.execute<{ verifier: string } & Record<string, unknown>>(
            sql`SELECT verifier FROM chat.identities WHERE id = ${caller.identityId}`,
          )
        ).rows[0]?.verifier ?? "",
        later(7000),
      );
      expect(resolved?.conversation.revision).toBe(1);
    });

    it("keeps the full reservation when the cost is uncertain", async () => {
      const startsOn = "2033-02-01";
      const operation = await admitted(
        admission(await identity(), { spend: [{ kind: "day", startsOn, limitMicroUsd: roomy }] }),
      );
      await chat.claimGrant(operation.id, "grant-verifier", at);
      await chat.reconcile(operation.id, "grant-verifier", at, answered({ costMicroUsd: null }));
      expect(await chat.committedSpend("day", startsOn)).toBe(allowance);
    });

    it("refuses another grant and an unclaimed operation", async () => {
      const operation = await admitted(admission(await identity()));
      await expect(chat.reconcile(operation.id, "grant-verifier", at, answered())).resolves.toEqual(
        { status: "not_claimed" },
      );
      await chat.claimGrant(operation.id, "grant-verifier", at);
      await expect(chat.reconcile(operation.id, "other", at, answered())).resolves.toEqual({
        status: "wrong_grant",
      });
    });

    it("stores a failure without text and frees the identity", async () => {
      const caller = await identity();
      const operation = await admitted(admission(caller));
      await chat.claimGrant(operation.id, "grant-verifier", at);
      await chat.reconcile(
        operation.id,
        "grant-verifier",
        at,
        answered({
          status: "failed",
          outcome: null,
          errorCode: "timeout",
          errorRetryable: true,
          text: null,
          sources: [],
          resultOutcome: "limit_reached",
          resultReason: "deadline",
          advancesRevision: false,
        }),
      );
      const found = await chat.findOperation(caller.identityId, operation.id);
      expect(found?.operation.status).toBe("failed");
      expect(found?.assistant).toMatchObject({
        status: "failed",
        text: null,
        errorCode: "timeout",
      });
      await expect(chat.findActiveOperation(caller.identityId)).resolves.toBeNull();
    });
  });

  describe("failing and interrupting", () => {
    it("fails an unclaimed operation and releases its reservation", async () => {
      const startsOn = "2034-01-01";
      const caller = await identity();
      const operation = await admitted(
        admission(caller, { spend: [{ kind: "day", startsOn, limitMicroUsd: roomy }] }),
      );
      await expect(
        chat.failUnclaimed(operation.id, at, { code: "busy", retryable: true }),
      ).resolves.toBe(true);
      expect(await chat.committedSpend("day", startsOn)).toBe(0);
      const found = await chat.findOperation(caller.identityId, operation.id);
      expect(found?.assistant).toMatchObject({ status: "failed", errorCode: "busy" });
      await expect(chat.failUnclaimed(operation.id, at, timeout)).resolves.toBe(false);
    });

    it("does not fail a claimed operation", async () => {
      const operation = await admitted(admission(await identity()));
      await chat.claimGrant(operation.id, "grant-verifier", at);
      await expect(chat.failUnclaimed(operation.id, at, timeout)).resolves.toBe(false);
    });

    it("interrupts overdue operations, keeping a claimed one's spend as uncertain", async () => {
      const startsOn = "2035-01-01";
      const spend = [{ kind: "day" as const, startsOn, limitMicroUsd: roomy }];
      const when = new Date("2035-01-01T08:00:00.000Z");
      const claimedCaller = await identity();
      const claimed = await admitted(admission(claimedCaller, { spend, at: when }));
      await chat.claimGrant(claimed.id, "grant-verifier", when);
      const unclaimed = await admitted(admission(await identity(), { spend, at: when }));

      const interrupted = await chat.interruptOverdue(
        later(70_000, when),
        later(70_000, when),
        timeout,
      );
      // Operations other tests left active are overdue too.
      expect(interrupted).toEqual(expect.arrayContaining([claimed.id, unclaimed.id]));
      expect(await chat.committedSpend("day", startsOn)).toBe(allowance);
      const found = await chat.findOperation(claimedCaller.identityId, claimed.id);
      expect(found?.operation.status).toBe("interrupted");
      expect(found?.assistant).toMatchObject({
        status: "interrupted",
        text: null,
        errorCode: "timeout",
        errorRetryable: true,
      });
      await expect(chat.reconcile(claimed.id, "grant-verifier", when, answered())).resolves.toEqual(
        {
          status: "already",
          operation: { ...claimed, status: "interrupted" },
        },
      );
    });
  });

  describe("reads", () => {
    it("pages a conversation and gives an empty page for a cursor from elsewhere", async () => {
      const caller = await identity();
      for (let index = 0; index < 3; index += 1) {
        const operation = await admitted(
          admission(caller, { question: `Question ${String(index)}` }),
        );
        await finish(operation.id);
      }
      const newest = await chat.listMessages(caller.conversation.id, { limit: 4 });
      expect(newest.hasMore).toBe(true);
      expect(newest.messages.map((message) => message.text)).toEqual([
        "Question 1",
        "Alex builds data platforms.",
        "Question 2",
        "Alex builds data platforms.",
      ]);
      const older = await chat.listMessages(caller.conversation.id, {
        before: newest.messages[0]?.id ?? "",
        limit: 4,
      });
      expect(older.hasMore).toBe(false);
      expect(older.messages.map((message) => message.text)).toEqual([
        "Question 0",
        "Alex builds data platforms.",
      ]);

      const other = await identity();
      await expect(
        chat.listMessages(other.conversation.id, {
          before: newest.messages[0]?.id ?? "",
          limit: 4,
        }),
      ).resolves.toEqual({ messages: [], hasMore: false });
    });

    it("never finds another identity's operation", async () => {
      const operation = await admitted(admission(await identity()));
      const stranger = await identity();
      await expect(chat.findOperation(stranger.identityId, operation.id)).resolves.toBeNull();
      await expect(
        chat.findOperationByRequest(stranger.identityId, operation.requestId),
      ).resolves.toBeNull();
    });

    it("projects at most the latest completed answered exchanges, oldest first", async () => {
      const caller = await identity();
      for (let index = 0; index < 3; index += 1) {
        const operation = await admitted(
          admission(caller, { question: `Question ${String(index)}` }),
        );
        await finish(operation.id, answered({ text: `Answer ${String(index)}` }));
      }
      const refused = await admitted(admission(caller, { question: "Refused" }));
      await finish(
        refused.id,
        answered({ outcome: "refused", text: "No.", advancesRevision: false }),
      );
      const exchanges = await chat.recentExchanges(caller.conversation.id, 2);
      expect(exchanges).toEqual([
        { question: "Question 1", answer: "Answer 1", language: "en", sources: answered().sources },
        { question: "Question 2", answer: "Answer 2", language: "en", sources: answered().sources },
      ]);
    });
  });

  describe("request claims", () => {
    const claimInput = (
      caller: ChatIdentityRecord,
      overrides: Partial<ChatRequestClaimInput> = {},
    ) =>
      ({
        identityId: caller.identityId,
        requestId: randomUUID(),
        questionHash: "question-hash",
        challengeTokenHash: unique("token"),
        at,
        expiresAt: later(15_000),
        ...overrides,
      }) satisfies ChatRequestClaimInput;

    it("grants one of many concurrent equal claims; the others see it pending", async () => {
      const input = claimInput(await identity());
      const results = await Promise.all(Array.from({ length: 8 }, () => chat.claimRequest(input)));
      expect(results.filter((result) => result.status === "claimed")).toHaveLength(1);
      const held = results.filter((result) => result.status === "held");
      expect(held).toHaveLength(7);
      for (const result of held) {
        expect(result).toEqual({
          status: "held",
          state: "pending",
          sameQuestion: true,
          sameToken: true,
        });
      }
    });

    it("tells another question and another token apart while the claim holds", async () => {
      const input = claimInput(await identity());
      await expect(chat.claimRequest(input)).resolves.toEqual({ status: "claimed" });
      await expect(
        chat.claimRequest({ ...input, questionHash: "other-question", at: later(1000) }),
      ).resolves.toEqual({
        status: "held",
        state: "pending",
        sameQuestion: false,
        sameToken: true,
      });
      await expect(
        chat.claimRequest({ ...input, challengeTokenHash: unique("token"), at: later(1000) }),
      ).resolves.toEqual({
        status: "held",
        state: "pending",
        sameQuestion: true,
        sameToken: false,
      });
    });

    it("records how the holder's verification ended, once", async () => {
      const caller = await identity();
      const failed = claimInput(caller);
      await chat.claimRequest(failed);
      await chat.settleRequestClaim(failed, "failed");
      await chat.settleRequestClaim(failed, "verified");
      await expect(chat.claimRequest({ ...failed, at: later(1000) })).resolves.toMatchObject({
        status: "held",
        state: "failed",
      });
      const verified = claimInput(caller);
      await chat.claimRequest(verified);
      await chat.settleRequestClaim(verified, "verified");
      await expect(chat.claimRequest({ ...verified, at: later(1000) })).resolves.toMatchObject({
        status: "held",
        state: "verified",
      });
    });

    it("lets an expired claim be taken over, by one claimant only", async () => {
      const input = claimInput(await identity(), { expiresAt: later(1000) });
      await chat.claimRequest(input);
      const takeover = { ...input, at: later(2000), expiresAt: later(17_000) };
      const results = await Promise.all(
        Array.from({ length: 6 }, () => chat.claimRequest(takeover)),
      );
      expect(results.filter((result) => result.status === "claimed")).toHaveLength(1);
      expect(results.filter((result) => result.status === "held")).toHaveLength(5);
    });
  });

  describe("pruning on admission", () => {
    const expiredRows = async (table: "admissions" | "request_claims", when: Date) => {
      const result = await connection.db.execute<{ count: string } & Record<string, unknown>>(
        sql`SELECT count(*)::text AS count FROM ${sql.identifier("chat")}.${sql.identifier(table)} WHERE expires_at < ${when.toISOString()}::timestamptz`,
      );
      return Number(result.rows[0]?.count);
    };

    it("deletes a bounded batch of expired admissions and request claims", async () => {
      const when = new Date("2040-01-01T10:00:00.000Z");
      const past = new Date("2039-12-01T10:00:00.000Z");
      const owner = await identity();
      await connection.db.execute(
        sql`INSERT INTO chat.admissions (identity_id, fingerprint, admitted_at, expires_at)
            SELECT ${owner.identityId}::uuid, 'fingerprint-old', ${past.toISOString()}::timestamptz, ${past.toISOString()}::timestamptz
            FROM generate_series(1, ${chatPruneBatch + 10})`,
      );
      await connection.db.execute(
        sql`INSERT INTO chat.request_claims (identity_id, request_id, question_hash, challenge_digest, state, claimed_at, expires_at)
            SELECT ${owner.identityId}::uuid, gen_random_uuid(), 'question-hash', 'digest-' || n, 'pending', ${past.toISOString()}::timestamptz, ${past.toISOString()}::timestamptz
            FROM generate_series(1, ${chatPruneBatch + 10}) AS n`,
      );
      const admissionsBefore = await expiredRows("admissions", when);
      const claimsBefore = await expiredRows("request_claims", when);

      await admitted(
        admission(await identity(), {
          at: when,
          deadlineAt: later(60_000, when),
          admissionExpiresAt: later(86_400_000, when),
        }),
      );

      expect(await expiredRows("admissions", when)).toBe(admissionsBefore - chatPruneBatch);
      expect(await expiredRows("request_claims", when)).toBe(claimsBefore - chatPruneBatch);
    });
  });

  describe("retention", () => {
    it("deletes inactive identities with their conversations and keeps the accounting", async () => {
      const startsOn = "2036-01-01";
      const old = new Date("2036-01-01T09:00:00.000Z");
      const verifier = unique("verifier");
      const inactive = await chat.createIdentity(verifier, old);
      const operation = await admitted(
        admission(inactive, {
          at: old,
          admissionExpiresAt: later(1000, old),
          spend: [{ kind: "day", startsOn, limitMicroUsd: roomy }],
        }),
      );
      await chat.claimGrant(operation.id, "grant-verifier", old);
      await chat.reconcile(operation.id, "grant-verifier", old, answered());
      const active = await chat.createIdentity(unique("verifier"), later(10 * 86_400_000, old));

      const deleted = await chat.deleteInactive(
        later(86_400_000, old),
        later(86_400_000, old),
        100,
      );
      expect(deleted).toBeGreaterThanOrEqual(1);
      await expect(chat.resolveIdentity(verifier, later(86_400_000, old))).resolves.toBeNull();
      await expect(chat.listMessages(inactive.conversation.id, { limit: 20 })).resolves.toEqual({
        messages: [],
        hasMore: false,
      });
      expect(await chat.committedSpend("day", startsOn)).toBe(4_000);
      const remaining = await connection.db.execute<{ count: string } & Record<string, unknown>>(
        sql`SELECT count(*)::text AS count FROM chat.identities WHERE id = ${active.identityId}`,
      );
      expect(remaining.rows[0]?.count).toBe("1");
      const runs = await connection.db.execute<{ count: string } & Record<string, unknown>>(
        sql`SELECT count(*)::text AS count FROM chat.deletions`,
      );
      expect(Number(runs.rows[0]?.count)).toBeGreaterThanOrEqual(1);
    });
  });

  describe("the conversation lifecycle", () => {
    const cancelled = { code: "cancelled", retryable: true };
    const failure = (retryable: boolean) =>
      answered({
        status: "failed",
        outcome: null,
        errorCode: "unavailable",
        errorRetryable: retryable,
        text: null,
        sources: [],
        resultOutcome: "provider_error",
        resultReason: null,
        costMicroUsd: 1_000,
        advancesRevision: false,
      });
    const onDay = (startsOn: string, limitMicroUsd = roomy) => [
      { kind: "day" as const, startsOn, limitMicroUsd },
    ];
    const retryInput = (
      caller: ChatIdentityRecord,
      operationId: string,
      overrides: Partial<ChatRetryInput> = {},
    ): ChatRetryInput => {
      const gates: Partial<ChatAdmissionInput> = { ...admission(caller) };
      delete gates.requestId;
      delete gates.question;
      delete gates.questionHash;
      return { ...(gates as ChatRetryInput), operationId, retryId: randomUUID(), ...overrides };
    };
    /** An admitted, claimed operation that failed with a retryable error. */
    const failedOnce = async (caller: ChatIdentityRecord, overrides = {}) => {
      const operation = await admitted(admission(caller, overrides));
      await finish(operation.id, failure(true));
      return operation;
    };
    const tableCount = async (query: SQL) => {
      const result = await connection.db.execute<{ count: string } & Record<string, unknown>>(
        query,
      );
      return Number(result.rows[0]?.count);
    };

    describe("retry", () => {
      it("retries a failed answer as a new attempt of the same request", async () => {
        const caller = await identity();
        const first = await failedOnce(caller);
        const input = retryInput(caller, first.id);
        const result = await chat.retry(input);
        expect(result.status).toBe("admitted");
        if (result.status !== "admitted") return;
        const retried = result.operation;
        expect(retried).toMatchObject({
          requestId: first.requestId,
          questionHash: first.questionHash,
          userMessageId: first.userMessageId,
          status: "accepted",
          retryOf: first.id,
        });
        expect(retried.id).not.toBe(first.id);
        expect(retried.assistantMessageId).not.toBe(first.assistantMessageId);
        const page = await chat.listMessages(caller.conversation.id, { limit: 20 });
        expect(page.messages.map((message) => [message.id, message.status])).toEqual([
          [first.userMessageId, "completed"],
          [retried.assistantMessageId, "pending"],
        ]);
        await expect(
          chat.findOperationByRequest(caller.identityId, first.requestId),
        ).resolves.toEqual(retried);
        await expect(
          chat.findOperationByAttempt(caller.identityId, input.retryId),
        ).resolves.toEqual(retried);
        await expect(chat.findActiveOperation(caller.identityId)).resolves.toEqual(retried);
      });

      it("recovers a repeated retry id and conflicts when it names another attempt", async () => {
        const caller = await identity();
        const first = await failedOnce(caller);
        const input = retryInput(caller, first.id);
        const results = await Promise.all(
          Array.from({ length: 4 }, () =>
            chat.retry({ ...input, challengeTokenHash: unique("token") }),
          ),
        );
        const admittedOnes = results.filter((result) => result.status === "admitted");
        expect(admittedOnes).toHaveLength(1);
        const retried = admittedOnes[0]?.operation;
        for (const result of results.filter((entry) => entry.status !== "admitted")) {
          expect(result).toEqual({ status: "duplicate", operation: retried, sameTarget: true });
        }
        await expect(
          chat.retry({ ...input, operationId: randomUUID(), challengeTokenHash: unique("token") }),
        ).resolves.toEqual({ status: "duplicate", operation: retried, sameTarget: false });
        const page = await chat.listMessages(caller.conversation.id, { limit: 20 });
        expect(page.messages).toHaveLength(2);
      });

      it("recovers an active or completed attempt before any new paid work", async () => {
        const startsOn = "2042-01-01";
        const caller = await identity();
        const first = await failedOnce(caller, { spend: onDay(startsOn) });
        const retried = await chat.retry(retryInput(caller, first.id, { spend: onDay(startsOn) }));
        if (retried.status !== "admitted") throw new Error(retried.status);
        const spent = await chat.committedSpend("day", startsOn);
        await expect(
          chat.retry(retryInput(caller, first.id, { spend: onDay(startsOn) })),
        ).resolves.toEqual({ status: "recovered", operation: retried.operation });
        await finish(retried.operation.id);
        const completed = await chat.findOperation(caller.identityId, retried.operation.id);
        await expect(
          chat.retry(retryInput(caller, retried.operation.id, { spend: onDay(startsOn) })),
        ).resolves.toEqual({ status: "recovered", operation: completed?.operation });
        expect(await chat.committedSpend("day", startsOn)).toBe(spent - allowance + 4_000);
      });

      it("refuses a non-retryable failure, an older question and another identity's attempt", async () => {
        const caller = await identity();
        const final = await admitted(admission(caller));
        await finish(final.id, failure(false));
        await expect(chat.retry(retryInput(caller, final.id))).resolves.toEqual({
          status: "not_retryable",
        });

        const other = await identity();
        const older = await failedOnce(other);
        const newer = await admitted(admission(other));
        await finish(newer.id);
        await expect(chat.retry(retryInput(other, older.id))).resolves.toEqual({
          status: "not_retryable",
        });
        await expect(chat.retry(retryInput(caller, older.id))).resolves.toEqual({
          status: "not_found",
        });
      });

      it("rechecks the challenge, quota and budget gates and changes nothing on refusal", async () => {
        const caller = await identity();
        const token = unique("token");
        const first = await failedOnce(caller, { challengeTokenHash: token });
        await expect(
          chat.retry(retryInput(caller, first.id, { challengeTokenHash: token })),
        ).resolves.toEqual({ status: "challenge_reused" });
        const quotas = [
          { scope: "identity" as const, since: later(-60_000), limit: 1, resetsAt: null },
        ];
        await expect(chat.retry(retryInput(caller, first.id, { quotas }))).resolves.toMatchObject({
          status: "quota_exceeded",
          scope: "identity",
        });
        await expect(
          chat.retry(retryInput(caller, first.id, { spend: onDay("2042-02-01", allowance - 1) })),
        ).resolves.toEqual({ status: "budget_exhausted" });
        const page = await chat.listMessages(caller.conversation.id, { limit: 20 });
        expect(page.messages.map((message) => message.status)).toEqual(["completed", "failed"]);
        await expect(chat.findActiveOperation(caller.identityId)).resolves.toBeNull();
      });
    });

    describe("stop", () => {
      it("stops an unclaimed operation and releases its reservation", async () => {
        const startsOn = "2042-03-01";
        const caller = await identity();
        const operation = await admitted(admission(caller, { spend: onDay(startsOn) }));
        const stopped = await chat.stop(caller.identityId, operation.id, later(1000), cancelled);
        expect(stopped).toEqual({
          status: "stopped",
          operation: { ...operation, status: "cancelled" },
          claimed: false,
        });
        expect(await chat.committedSpend("day", startsOn)).toBe(0);
        const found = await chat.findOperation(caller.identityId, operation.id);
        expect(found?.assistant).toMatchObject({
          status: "cancelled",
          text: null,
          errorCode: "cancelled",
          errorRetryable: true,
        });
        await expect(chat.findActiveOperation(caller.identityId)).resolves.toBeNull();
        await expect(
          chat.stop(caller.identityId, operation.id, later(2000), cancelled),
        ).resolves.toEqual({
          status: "finished",
          operation: { ...operation, status: "cancelled" },
        });
        await expect(chat.claimGrant(operation.id, "grant-verifier", later(3000))).resolves.toEqual(
          { status: "refused" },
        );
      });

      it("keeps a claimed operation's reservation uncertain until a late result settles its cost once", async () => {
        const startsOn = "2042-04-01";
        const caller = await identity();
        const operation = await admitted(admission(caller, { spend: onDay(startsOn) }));
        await chat.claimGrant(operation.id, "grant-verifier", at);
        await expect(
          chat.stop(caller.identityId, operation.id, later(1000), cancelled),
        ).resolves.toMatchObject({ status: "stopped", claimed: true });
        expect(await chat.committedSpend("day", startsOn)).toBe(allowance);

        const late = await chat.reconcile(operation.id, "grant-verifier", later(2000), answered());
        expect(late).toEqual({
          status: "already",
          operation: { ...operation, status: "cancelled" },
        });
        expect(await chat.committedSpend("day", startsOn)).toBe(4_000);
        await chat.reconcile(
          operation.id,
          "grant-verifier",
          later(3000),
          answered({ costMicroUsd: 9_000 }),
        );
        expect(await chat.committedSpend("day", startsOn)).toBe(4_000);
        const found = await chat.findOperation(caller.identityId, operation.id);
        expect(found?.assistant).toMatchObject({ status: "cancelled", text: null, sources: [] });
        expect(
          await tableCount(
            sql`SELECT cost_micro_usd::text AS count FROM chat.operations WHERE id = ${operation.id}`,
          ),
        ).toBe(4_000);
      });

      it("never stops another identity's operation", async () => {
        const operation = await admitted(admission(await identity()));
        const other = await identity();
        await expect(chat.stop(other.identityId, operation.id, at, cancelled)).resolves.toBeNull();
        await expect(chat.stop(other.identityId, randomUUID(), at, cancelled)).resolves.toBeNull();
      });

      it("ends a Stop and completion race one way only, settling the cost once", async () => {
        for (let round = 0; round < 4; round += 1) {
          const startsOn = `2042-05-0${String(round + 1)}`;
          const caller = await identity();
          const operation = await admitted(admission(caller, { spend: onDay(startsOn) }));
          await chat.claimGrant(operation.id, "grant-verifier", at);
          const [stopped, reconciled] = await Promise.all([
            chat.stop(caller.identityId, operation.id, later(1000), cancelled),
            chat.reconcile(operation.id, "grant-verifier", later(1000), answered()),
          ]);
          const found = await chat.findOperation(caller.identityId, operation.id);
          if (stopped?.status === "stopped") {
            expect(reconciled.status).toBe("already");
            expect(found?.operation.status).toBe("cancelled");
            expect(found?.assistant).toMatchObject({ status: "cancelled", text: null });
          } else {
            expect(stopped?.status).toBe("finished");
            expect(reconciled.status).toBe("reconciled");
            expect(found?.operation.status).toBe("completed");
            expect(found?.assistant).toMatchObject({ status: "completed" });
          }
          expect(await chat.committedSpend("day", startsOn)).toBe(4_000);
        }
      });
    });

    describe("clear", () => {
      const clearing = (caller: ChatIdentityRecord, overrides: Partial<ChatClearInput> = {}) => ({
        identityId: caller.identityId,
        conversationId: caller.conversation.id,
        at: later(5000),
        error: cancelled,
        tombstoneExpiresAt: later(86_400_000),
        ...overrides,
      });
      const cleared = async (input: ChatClearInput) => {
        const result = await chat.clear(input);
        if (result.status !== "cleared") throw new Error(result.status);
        return result;
      };

      it("cancels active work, deletes the messages and starts a fresh conversation, quotas kept", async () => {
        const startsOn = "2042-06-01";
        const verifier = unique("verifier");
        const caller = await chat.createIdentity(verifier, at);
        const quotas = [
          { scope: "identity" as const, since: later(-60_000), limit: 2, resetsAt: null },
        ];
        const done = await admitted(admission(caller, { spend: onDay(startsOn), quotas }));
        await finish(done.id);
        const running = await admitted(admission(caller, { spend: onDay(startsOn), quotas }));
        await chat.claimGrant(running.id, "grant-verifier", at);

        const result = await cleared(clearing(caller));
        expect(result.cancelled).toEqual([running.id]);
        expect(result.telemetryPending).toBe(0);
        expect(result.conversation.id).not.toBe(caller.conversation.id);
        expect(result.conversation.revision).toBe(0);
        const resolved = await chat.resolveIdentity(verifier, later(6000));
        expect(resolved?.identityId).toBe(caller.identityId);
        expect(resolved?.conversation.id).toBe(result.conversation.id);
        await expect(chat.listMessages(caller.conversation.id, { limit: 20 })).resolves.toEqual({
          messages: [],
          hasMore: false,
        });
        await expect(chat.listMessages(result.conversation.id, { limit: 20 })).resolves.toEqual({
          messages: [],
          hasMore: false,
        });
        await expect(chat.findOperation(caller.identityId, done.id)).resolves.toBeNull();
        await expect(chat.findActiveOperation(caller.identityId)).resolves.toBeNull();
        // The running attempt's cost is unknown, so its reservation stays.
        expect(await chat.committedSpend("day", startsOn)).toBe(4_000 + allowance);
        const fresh = { ...caller, conversation: result.conversation };
        await expect(chat.admit(admission(fresh, { quotas }))).resolves.toMatchObject({
          status: "quota_exceeded",
        });
      });

      it("keeps a redeemed challenge token unusable after clearing", async () => {
        const caller = await identity();
        const token = unique("token");
        const operation = await admitted(admission(caller, { challengeTokenHash: token }));
        await finish(operation.id);
        const result = await cleared(clearing(caller));
        const fresh = { ...caller, conversation: result.conversation };
        await expect(chat.admit(admission(fresh, { challengeTokenHash: token }))).resolves.toEqual({
          status: "challenge_reused",
        });
      });

      it("lets a late claim or result recreate nothing and settles the measured cost once", async () => {
        const startsOn = "2042-07-01";
        const caller = await identity();
        const claimed = await admitted(admission(caller, { spend: onDay(startsOn) }));
        await chat.claimGrant(claimed.id, "grant-verifier", at);
        const result = await cleared(clearing(caller));
        await expect(
          chat.reconcile(claimed.id, "other-verifier", later(6000), answered()),
        ).resolves.toEqual({
          status: "wrong_grant",
        });
        await expect(
          chat.reconcile(claimed.id, "grant-verifier", later(6000), answered()),
        ).resolves.toEqual({
          status: "deleted",
        });
        expect(await chat.committedSpend("day", startsOn)).toBe(4_000);
        await expect(
          chat.reconcile(
            claimed.id,
            "grant-verifier",
            later(7000),
            answered({ costMicroUsd: 9_000 }),
          ),
        ).resolves.toEqual({ status: "deleted" });
        expect(await chat.committedSpend("day", startsOn)).toBe(4_000);
        await expect(chat.listMessages(result.conversation.id, { limit: 20 })).resolves.toEqual({
          messages: [],
          hasMore: false,
        });

        const fresh = { ...caller, conversation: result.conversation };
        const unclaimed = await admitted(admission(fresh));
        await cleared(clearing(fresh, { at: later(8000) }));
        await expect(chat.claimGrant(unclaimed.id, "grant-verifier", later(9000))).resolves.toEqual(
          {
            status: "wrong_grant",
          },
        );
        expect(
          await tableCount(
            sql`SELECT count(*)::text AS count FROM chat.messages WHERE conversation_id = ${caller.conversation.id} OR conversation_id = ${result.conversation.id}`,
          ),
        ).toBe(0);
      });

      it("clears nothing for another conversation id", async () => {
        const caller = await identity();
        const operation = await admitted(admission(caller));
        await expect(
          chat.clear(clearing(caller, { conversationId: randomUUID() })),
        ).resolves.toEqual({
          status: "mismatch",
        });
        const other = await identity();
        await expect(
          chat.clear(clearing(other, { conversationId: caller.conversation.id })),
        ).resolves.toEqual({ status: "mismatch" });
        await expect(chat.findActiveOperation(caller.identityId)).resolves.toEqual(operation);
      });

      it("hands a cleared conversation's telemetry references over for remote deletion", async () => {
        const caller = await identity();
        const operation = await admitted(admission(caller));
        await finish(operation.id);
        const traces = [unique("trace"), unique("trace")];
        for (const traceId of traces) {
          await expect(
            chat.recordTelemetryReference({
              traceId,
              conversationId: caller.conversation.id,
              operationId: operation.id,
              at,
            }),
          ).resolves.toBe("recorded");
        }
        const pendingOf = async () =>
          (await chat.pendingTelemetryDeletions(1000)).filter((entry) =>
            entry.traceId.startsWith("trace-"),
          );
        const before = (await pendingOf()).map((entry) => entry.traceId);
        expect(before).not.toEqual(expect.arrayContaining([traces[0]]));

        const result = await cleared(clearing(caller));
        expect(result.telemetryPending).toBe(2);
        const lateTrace = unique("trace");
        await expect(
          chat.recordTelemetryReference({
            traceId: lateTrace,
            conversationId: caller.conversation.id,
            operationId: operation.id,
            at: later(6000),
          }),
        ).resolves.toBe("deletion_pending");
        const pending = await pendingOf();
        expect(pending.map((entry) => entry.traceId)).toEqual(
          expect.arrayContaining([...traces, lateTrace]),
        );
        expect(pending.find((entry) => entry.traceId === traces[0])).toMatchObject({ attempts: 0 });

        await chat.settleTelemetryDeletion(traces[0] ?? "", "completed", later(7000));
        await chat.settleTelemetryDeletion(traces[1] ?? "", "failed", later(7000));
        const after = await pendingOf();
        expect(after.map((entry) => entry.traceId)).not.toContain(traces[0]);
        expect(after.find((entry) => entry.traceId === traces[1])).toMatchObject({ attempts: 1 });

        const empty = await cleared(clearing({ ...caller, conversation: result.conversation }));
        expect(empty.telemetryPending).toBe(0);
      });
    });
  });
});
