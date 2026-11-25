import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { readDatabaseConfig } from "../../config.js";
import { openConnection, type Connection } from "../../connection.js";
import { createTemporaryDatabase, type TemporaryDatabase } from "../../testing.js";
import {
  createChatPersistence,
  type ChatAdmissionInput,
  type ChatIdentityRecord,
  type ChatPersistence,
  type ChatResultRecord,
  type ChatTelemetryRegistrationInput,
} from "./index.js";

// Fictional identifiers only. The telemetry tables are global queues, so this file has a database
// of its own and every test starts with them empty.
const minute = 60_000;
const day = 24 * 60 * minute;
const horizon = 10 * minute;
const retention = 30 * day;
const backoff = { backoffMs: 15 * minute, maxBackoffMs: day };
const grant = "grant-verifier";

let counter = 0;
const unique = (prefix: string) => `${prefix}-${String(++counter)}-${randomUUID()}`;
const traceId = () => randomUUID().replaceAll("-", "");

describe("chat telemetry persistence", () => {
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

  beforeEach(async () => {
    await connection.db.execute(sql`DELETE FROM chat.telemetry_references`);
    await connection.db.execute(sql`DELETE FROM chat.telemetry_deletions`);
  });

  const at = new Date("2026-11-22T10:00:00.000Z");
  const later = (ms: number, from = at) => new Date(from.getTime() + ms);

  const admission = (caller: ChatIdentityRecord): ChatAdmissionInput => ({
    identityId: caller.identityId,
    conversationId: caller.conversation.id,
    requestId: randomUUID(),
    question: "What does Alex build?",
    questionHash: "question-hash",
    challengeTokenHash: unique("token"),
    fingerprint: unique("fingerprint"),
    at,
    deadlineAt: later(minute),
    grantVerifier: grant,
    model: "fake",
    effort: "medium",
    pricingVersion: "2026-11",
    allowanceMicroUsd: 20_000,
    quotas: [],
    admissionExpiresAt: later(day),
    spend: [{ kind: "day", startsOn: "2030-01-01", limitMicroUsd: 1_000_000_000 }],
  });

  const answered: ChatResultRecord = {
    status: "completed",
    outcome: "answered",
    errorCode: null,
    errorRetryable: null,
    text: "Alex builds data platforms.",
    language: "en",
    blocks: [],
    sources: [],
    related: [],
    resultOutcome: "answered",
    resultReason: null,
    costMicroUsd: 4_000,
    inputTokens: 1_000,
    outputTokens: 100,
    modelAttempts: 1,
    latencyMs: 4_000,
    versions: { prompt: "chat-v1" },
    context: null,
    advancesRevision: true,
  };

  /** A fresh identity with one admitted operation, claimed unless told otherwise. */
  async function operationOf(options: { claimed?: boolean; caller?: ChatIdentityRecord } = {}) {
    const caller = options.caller ?? (await chat.createIdentity(unique("verifier"), at));
    const admitted = await chat.admit(admission(caller));
    if (admitted.status !== "admitted") throw new Error(admitted.status);
    if (options.claimed ?? true) {
      expect((await chat.claimGrant(admitted.operation.id, grant, at)).status).toBe("claimed");
    }
    return { caller, operationId: admitted.operation.id };
  }

  const registration = (
    operationId: string,
    overrides: Partial<ChatTelemetryRegistrationInput> = {},
  ): ChatTelemetryRegistrationInput => {
    const when = overrides.at ?? at;
    return {
      operationId,
      verifier: grant,
      traceId: traceId(),
      at: when,
      exportUntil: later(horizon, when),
      expiresAt: later(retention, when),
      ...overrides,
    };
  };

  const clear = async (caller: ChatIdentityRecord, when = later(minute)) => {
    const result = await chat.clear({
      identityId: caller.identityId,
      conversationId: caller.conversation.id,
      at: when,
      error: { code: "cancelled", retryable: true },
      tombstoneExpiresAt: later(day, when),
    });
    if (result.status !== "cleared") throw new Error(result.status);
    return result;
  };

  const references = async () =>
    (
      await connection.db.execute<{ trace_id: string } & Record<string, unknown>>(
        sql`SELECT trace_id FROM chat.telemetry_references ORDER BY trace_id`,
      )
    ).rows.map((row) => row.trace_id);

  interface DeletionRow extends Record<string, unknown> {
    trace_id: string;
    state: string;
    attempts: number;
    next_attempt_at: Date;
    settled_at: Date | null;
  }

  const deletionOf = async (trace: string) => {
    const result = await connection.db.execute<DeletionRow>(
      sql`SELECT trace_id, state, attempts, next_attempt_at, settled_at
          FROM chat.telemetry_deletions WHERE trace_id = ${trace}`,
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : {
          ...row,
          next_attempt_at: new Date(row.next_attempt_at),
          settled_at: row.settled_at === null ? null : new Date(row.settled_at),
        };
  };

  const due = async (when: Date, limit = 1000) =>
    (await chat.claimDueTelemetryDeletions(when, limit, later(15 * minute, when))).map(
      (row) => row.traceId,
    );

  describe("registration", () => {
    it("records a claimed operation's trace with its expiry, idempotently", async () => {
      const { operationId } = await operationOf();
      const input = registration(operationId);

      await expect(chat.registerTelemetry(input)).resolves.toEqual({
        status: "recorded",
        expiresAt: later(retention),
      });
      await expect(
        chat.registerTelemetry({
          ...input,
          at: later(minute),
          exportUntil: later(minute + horizon),
          expiresAt: later(minute + retention),
        }),
      ).resolves.toEqual({ status: "recorded", expiresAt: later(retention) });
      expect(await references()).toEqual([input.traceId]);
    });

    it("refuses a wrong grant, an unclaimed grant and another operation's trace", async () => {
      const { operationId } = await operationOf();
      const unclaimed = await operationOf({ claimed: false });
      const taken = registration(operationId);
      await chat.registerTelemetry(taken);

      await expect(
        chat.registerTelemetry(registration(operationId, { verifier: "wrong-verifier" })),
      ).resolves.toEqual({ status: "wrong_grant" });
      await expect(chat.registerTelemetry(registration(unclaimed.operationId))).resolves.toEqual({
        status: "not_claimed",
      });
      const other = await operationOf();
      await expect(
        chat.registerTelemetry(registration(other.operationId, { traceId: taken.traceId })),
      ).resolves.toEqual({ status: "trace_conflict" });
      expect(await references()).toEqual([taken.traceId]);
      await expect(chat.telemetryDeletionBacklog()).resolves.toBe(0);
    });

    it("refuses a late registration after a clear and schedules its deletion past the horizon", async () => {
      const finished = await operationOf();
      await chat.reconcile(finished.operationId, grant, at, answered);
      const running = await operationOf({ caller: finished.caller });
      await clear(finished.caller);

      const late = later(2 * minute);
      const tombstoned = registration(running.operationId, { at: late });
      await expect(chat.registerTelemetry(tombstoned)).resolves.toEqual({
        status: "refused",
        deleteAfter: later(horizon, late),
      });
      const reported = registration(finished.operationId, { at: late });
      await expect(chat.registerTelemetry(reported)).resolves.toEqual({
        status: "refused",
        deleteAfter: later(horizon, late),
      });
      await expect(
        chat.registerTelemetry(registration(running.operationId, { verifier: "wrong-verifier" })),
      ).resolves.toEqual({ status: "wrong_grant" });

      expect(await references()).toEqual([]);
      await expect(chat.telemetryDeletionBacklog()).resolves.toBe(2);
      expect(await due(later(horizon - 1, late))).toEqual([]);
      expect((await due(later(horizon, late))).sort()).toEqual(
        [tombstoned.traceId, reported.traceId].sort(),
      );
    });

    it("never records a trace again once it is owed a deletion, nor after it completed", async () => {
      const { caller, operationId } = await operationOf();
      const input = registration(operationId);
      await chat.registerTelemetry(input);
      const cleared = await clear(caller);
      expect(cleared.telemetryPending).toBe(1);

      const next = await operationOf({ caller: { ...caller, conversation: cleared.conversation } });
      const again = registration(next.operationId, { traceId: input.traceId, at: later(minute) });
      await expect(chat.registerTelemetry(again)).resolves.toEqual({
        status: "refused",
        deleteAfter: later(horizon),
      });
      await chat.settleTelemetryDeletions({
        outcome: "completed",
        traceIds: await due(later(horizon)),
        at: later(horizon),
      });
      await expect(chat.registerTelemetry({ ...again, at: later(day) })).resolves.toMatchObject({
        status: "refused",
      });

      expect(await references()).toEqual([]);
      expect(await deletionOf(input.traceId)).toMatchObject({ state: "completed", attempts: 0 });
      await expect(chat.telemetryDeletionBacklog()).resolves.toBe(0);
    });

    it("hands over or refuses a registration racing a clear, never leaving it behind", async () => {
      for (let round = 0; round < 8; round += 1) {
        const { caller, operationId } = await operationOf();
        const input = registration(operationId);

        const [registered] = await Promise.all([chat.registerTelemetry(input), clear(caller)]);

        expect(["recorded", "refused"]).toContain(registered.status);
        expect(await references()).toEqual([]);
        expect(await deletionOf(input.traceId)).toMatchObject({ state: "pending" });
      }
    });
  });

  describe("handover and expiry", () => {
    it("hands a cleared conversation's references over no earlier than their export horizon", async () => {
      const { caller, operationId } = await operationOf();
      const traces = [registration(operationId), registration(operationId, { at: later(minute) })];
      for (const input of traces) await chat.registerTelemetry(input);

      const cleared = await clear(caller, later(2 * minute));

      expect(cleared.telemetryPending).toBe(2);
      expect(await references()).toEqual([]);
      expect(await due(later(horizon - 1))).toEqual([]);
      expect(await due(later(horizon))).toEqual([traces[0]?.traceId]);
      expect(await due(later(minute + horizon))).toEqual([traces[1]?.traceId]);
    });

    it("hands an inactive conversation's references over when it is deleted", async () => {
      const { operationId } = await operationOf();
      const input = registration(operationId);
      await chat.registerTelemetry(input);

      expect(await chat.deleteInactive(later(day), later(day), 1000)).toBeGreaterThanOrEqual(1);

      expect(await references()).toEqual([]);
      expect(await due(later(day))).toEqual([input.traceId]);
    });

    it("sweeps expired references to deletion in bounded batches", async () => {
      const { operationId } = await operationOf();
      const traces = [0, 1, 2].map((index) => registration(operationId, { at: later(index) }));
      for (const input of traces) await chat.registerTelemetry(input);

      expect(await chat.sweepExpiredTelemetry(later(retention - 1), 1000)).toBe(0);
      expect(await chat.sweepExpiredTelemetry(later(retention + 2), 2)).toBe(2);
      expect(await references()).toEqual([traces[2]?.traceId]);
      expect(await chat.sweepExpiredTelemetry(later(retention + 2), 2)).toBe(1);
      expect(await chat.sweepExpiredTelemetry(later(retention + 2), 2)).toBe(0);

      await expect(chat.telemetryDeletionBacklog()).resolves.toBe(3);
      expect((await due(later(retention + 2))).sort()).toEqual(
        traces.map((input) => input.traceId).sort(),
      );
    });

    it("moves each expired reference once when sweeps and a clear race", async () => {
      const { caller, operationId } = await operationOf();
      const traces = Array.from({ length: 30 }, () => registration(operationId));
      for (const input of traces) await chat.registerTelemetry(input);
      const expired = later(retention);

      const [first, second, cleared] = await Promise.all([
        chat.sweepExpiredTelemetry(expired, 1000),
        chat.sweepExpiredTelemetry(expired, 1000),
        clear(caller, expired),
      ]);

      expect(first + second + cleared.telemetryPending).toBe(30);
      expect(await references()).toEqual([]);
      await expect(chat.telemetryDeletionBacklog()).resolves.toBe(30);
    });
  });

  describe("deletion", () => {
    /** `count` traces refused at `at`, so they are due after the horizon. */
    async function owed(count: number) {
      const traces: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const input = registration(randomUUID(), { at: later(index) });
        expect((await chat.registerTelemetry(input)).status).toBe("refused");
        traces.push(input.traceId);
      }
      return traces;
    }

    it("takes due deletions longest due first and leases them from other runs", async () => {
      const traces = await owed(5);
      const when = later(horizon + 10);

      const taken = await chat.claimDueTelemetryDeletions(when, 2, later(15 * minute, when));
      expect(taken).toEqual([
        { traceId: traces[0], requestedAt: at, attempts: 0 },
        { traceId: traces[1], requestedAt: later(1), attempts: 0 },
      ]);
      expect(await due(when)).toEqual(traces.slice(2));
      expect(await due(when)).toEqual([]);
      expect((await due(later(15 * minute, when))).sort()).toEqual([...traces].sort());
    });

    it("gives concurrent runs disjoint deletions", async () => {
      const traces = await owed(12);
      const when = later(horizon + 20);

      const runs = await Promise.all([due(when, 5), due(when, 5), due(when, 5)]);

      expect(runs.flat().sort()).toEqual([...traces].sort());
    });

    it("backs off a failed deletion, doubling up to a day, or until a given retry time", async () => {
      const [trace = ""] = await owed(1);
      let when = later(horizon);
      const expected = [15, 30, 60, 120, 240, 480, 960, 1440, 1440];

      for (const [attempt, minutes] of expected.entries()) {
        expect(await due(when)).toEqual([trace]);
        await chat.settleTelemetryDeletions({
          outcome: "retry",
          traceIds: [trace],
          at: when,
          retryAt: null,
          ...backoff,
        });
        const row = await deletionOf(trace);
        expect(row).toMatchObject({ state: "pending", attempts: attempt + 1 });
        expect(row?.next_attempt_at).toEqual(later(minutes * minute, when));
        when = later(minutes * minute, when);
      }

      const retryAt = later(3 * day, when);
      await chat.settleTelemetryDeletions({
        outcome: "retry",
        traceIds: [trace],
        at: when,
        retryAt,
        ...backoff,
      });
      expect((await deletionOf(trace))?.next_attempt_at).toEqual(retryAt);
      expect(await due(later(-1, retryAt))).toEqual([]);
      expect(await due(retryAt)).toEqual([trace]);
    });

    it("keeps only non-content accounting of a completed deletion and never takes it again", async () => {
      const traces = await owed(2);
      const when = later(horizon + 10);
      await due(when);

      await chat.settleTelemetryDeletions({
        outcome: "completed",
        traceIds: traces,
        at: when,
      });
      await chat.settleTelemetryDeletions({
        outcome: "retry",
        traceIds: traces,
        at: when,
        retryAt: null,
        ...backoff,
      });

      expect(await deletionOf(traces[0] ?? "")).toMatchObject({
        state: "completed",
        attempts: 0,
        settled_at: when,
      });
      await expect(chat.telemetryDeletionBacklog()).resolves.toBe(0);
      expect(await due(later(365 * day))).toEqual([]);
      const columns = await connection.db.execute<
        { column_name: string } & Record<string, unknown>
      >(
        sql`SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'chat' AND table_name = 'telemetry_deletions'
            ORDER BY column_name`,
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual([
        "attempts",
        "next_attempt_at",
        "requested_at",
        "settled_at",
        "state",
        "trace_id",
      ]);
    });
  });
});
