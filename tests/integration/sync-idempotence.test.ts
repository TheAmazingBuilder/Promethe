/**
 * Lot 2 — Broker Sync concurrent idempotence (PostgreSQL schema promethe_test).
 *
 * Exercises the SyncEventLog state machine in src/lib/sync/process.ts:
 *  - two simultaneous calls with the same event ID produce one business effect;
 *  - repeat after success is a duplicate;
 *  - a retryable failure recovers on retry, and exhausted retries become definitive;
 *  - a crashed reservation recovers after lease expiry, while a live lease is not reprocessed;
 *  - out-of-order events and partial closes stay coherent.
 *
 * The sequential idempotency of the handlers themselves (re-sends, backfills,
 * MT4 stitching) is covered by tests/integration/sync-engine.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  processIngestPayload,
  SYNC_EVENT_MAX_ATTEMPTS,
} from "@/lib/sync/process";
import type { BrokerConnection } from "@prisma/client";
import type { MtIngestPayload, MtEvent } from "@/lib/sync/types";

const OFFSET = 7200; // GMT+2 broker
const nowSec = () => Math.floor(Date.now() / 1000);
const serverNow = () => nowSec() + OFFSET;

function envelope(events: MtEvent[], overrides: Partial<MtIngestPayload> = {}): MtIngestPayload {
  return {
    schemaVersion: 1,
    platform: "MT5",
    eaVersion: "1.0.1",
    server: "TestBroker-Live",
    login: "22334455",
    currency: "USD",
    leverage: "500",
    serverGmtOffsetSeconds: OFFSET,
    sentAt: nowSec(),
    events,
    ...overrides,
  };
}

const GOLD_SPEC = {
  digits: "2",
  point: "0.01",
  tickSize: "0.01",
  tickValue: "1",
  contractSize: "100",
};

function openedEvent(positionId: string, overrides: Record<string, unknown> = {}): MtEvent {
  const openTime = serverNow() - 3600;
  return {
    eventId: `MT5:TestBroker-Live:22334455:OPEN:${positionId}`,
    type: "POSITION_OPENED",
    time: openTime,
    symbol: "XAUUSD",
    symbolSpec: GOLD_SPEC,
    positionId,
    ticket: `88${positionId}`,
    direction: "LONG",
    volume: "0.10",
    openTime,
    openPrice: "2650.50",
    stopLoss: "2645.00",
    takeProfit: "2662.00",
    ...overrides,
  } as MtEvent;
}

let user: { id: string; email: string };
let accountId: string;
let connection: BrokerConnection;

beforeAll(async () => {
  const created = await createUserWithDefaults({
    email: "sync-idem@test.local",
    password: "password1",
    displayName: "Sync Idempotence Tester",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "fr",
  });
  user = created.user;
  accountId = (await db.account.findFirstOrThrow({ where: { userId: user.id } })).id;

  connection = await db.brokerConnection.create({
    data: {
      userId: user.id,
      accountId,
      platform: "MT5",
      label: "Test MT5 idempotence",
      tokenHash: "e".repeat(64),
      tokenPrefix: "tj_idm",
      status: "PENDING",
    },
  });

  // Bind the connection first so the concurrent test does not race the binding write.
  const bound = await processIngestPayload(connection, envelope([
    {
      eventId: "MT5:TestBroker-Live:22334455:HB:bind",
      type: "HEARTBEAT",
      time: serverNow(),
      balance: "10000",
      equity: "10000",
      openPositions: 0,
    },
  ]));
  expect(bound.results[0]?.status).toBe("ACCEPTED");
  connection = await db.brokerConnection.findUniqueOrThrow({ where: { id: connection.id } });
  expect(connection.status).toBe("ACTIVE");
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: user.id } });
  await db.instrument.deleteMany({ where: { userId: user.id } });
  await db.symbolMapping.deleteMany({ where: { userId: user.id } });
  await db.$disconnect();
});

async function freshConnection(): Promise<BrokerConnection> {
  return db.brokerConnection.findUniqueOrThrow({ where: { id: connection.id } });
}

async function logRow(eventId: string) {
  return db.syncEventLog.findUniqueOrThrow({
    where: { userId_eventId: { userId: user.id, eventId } },
  });
}

async function tradesFor(positionId: string) {
  return db.trade.findMany({
    where: {
      accountId,
      externalId: `MT5:TestBroker-Live:22334455:${positionId}`,
    },
  });
}

describe("concurrent idempotence", () => {
  it("two simultaneous calls with the same event ID produce one trade", async () => {
    const positionId = "9201";
    const eventId = `MT5:TestBroker-Live:22334455:OPEN:${positionId}`;
    const [first, second] = await Promise.all([
      processIngestPayload(await freshConnection(), envelope([openedEvent(positionId)])),
      processIngestPayload(await freshConnection(), envelope([openedEvent(positionId)])),
    ]);

    const statuses = [first.results[0]?.status, second.results[0]?.status].sort();
    expect(statuses).toEqual(["ACCEPTED", "DUPLICATE"]);

    expect(await tradesFor(positionId)).toHaveLength(1);
    const row = await logRow(eventId);
    expect(row.status).toBe("PROCESSED");
    expect(await db.syncEventLog.count({ where: { userId: user.id, eventId } })).toBe(1);
  });

  it("repeat after success is a duplicate with no side effect", async () => {
    const positionId = "9202";
    const eventId = `MT5:TestBroker-Live:22334455:OPEN:${positionId}`;
    const first = await processIngestPayload(await freshConnection(), envelope([openedEvent(positionId)]));
    expect(first.results[0]?.status).toBe("ACCEPTED");
    const second = await processIngestPayload(await freshConnection(), envelope([openedEvent(positionId)]));
    expect(second.results).toEqual([{ eventId, status: "DUPLICATE" }]);

    expect(await tradesFor(positionId)).toHaveLength(1);
    expect((await logRow(eventId)).status).toBe("PROCESSED");
  });
});

describe("failure, retry and lease recovery", () => {
  it("a handler failure settles FAILED and a retry recovers", async () => {
    const eventId = "MT5:TestBroker-Live:22334455:HB:bad-balance";
    // The snapshot for this heartbeat is attempted (event time is 20 minutes
    // ahead of the last snapshot, past the 15-minute downsampling), and the
    // invalid balance makes the snapshot insert fail.
    const failingTime = serverNow() + 20 * 60;
    const snapshotsBefore = await db.accountEquitySnapshot.count({ where: { accountId } });

    const failed = await processIngestPayload(await freshConnection(), envelope([
      {
        eventId,
        type: "HEARTBEAT",
        time: failingTime,
        balance: "not-a-number",
        equity: "10000",
        openPositions: 0,
      },
    ]));
    expect(failed.results).toEqual([{ eventId, status: "REJECTED", reason: "EVENT_FAILED" }]);
    const failedRow = await logRow(eventId);
    expect(failedRow.status).toBe("FAILED");
    expect(failedRow.errorCode).toBe("EVENT_FAILED");
    expect(await db.accountEquitySnapshot.count({ where: { accountId } })).toBe(snapshotsBefore);

    const retried = await processIngestPayload(await freshConnection(), envelope([
      {
        eventId,
        type: "HEARTBEAT",
        time: failingTime,
        balance: "10000",
        equity: "10040",
        openPositions: 0,
      },
    ]));
    expect(retried.results).toEqual([{ eventId, status: "ACCEPTED" }]);
    const row = await logRow(eventId);
    expect(row.status).toBe("PROCESSED");
    expect(row.attempts).toBe(2);
    expect(await db.accountEquitySnapshot.count({ where: { accountId } })).toBe(snapshotsBefore + 1);
  });

  it("a FAILED row is reclaimed on retry", async () => {
    const positionId = "9205";
    const eventId = `MT5:TestBroker-Live:22334455:OPEN:${positionId}`;
    await db.syncEventLog.create({
      data: {
        userId: user.id,
        connectionId: connection.id,
        eventId,
        type: "POSITION_OPENED",
        status: "FAILED",
        errorCode: "EVENT_FAILED",
        attempts: 1,
      },
    });
    const result = await processIngestPayload(await freshConnection(), envelope([openedEvent(positionId)]));
    expect(result.results[0]?.status).toBe("ACCEPTED");
    expect(await tradesFor(positionId)).toHaveLength(1);
    const row = await logRow(eventId);
    expect(row.status).toBe("PROCESSED");
    expect(row.attempts).toBe(2);
  });

  it("a crashed reservation recovers after lease expiry", async () => {
    const positionId = "9203";
    const eventId = `MT5:TestBroker-Live:22334455:OPEN:${positionId}`;
    await db.syncEventLog.create({
      data: {
        userId: user.id,
        connectionId: connection.id,
        eventId,
        type: "POSITION_OPENED",
        status: "PROCESSING",
        leaseExpiresAt: new Date(Date.now() - 60_000), // expired 1 minute ago
        attempts: 1,
      },
    });
    const result = await processIngestPayload(await freshConnection(), envelope([openedEvent(positionId)]));
    expect(result.results[0]?.status).toBe("ACCEPTED");
    expect(await tradesFor(positionId)).toHaveLength(1);
    const row = await logRow(eventId);
    expect(row.status).toBe("PROCESSED");
    expect(row.attempts).toBe(2);
    expect(row.leaseExpiresAt).toBeNull();
  });

  it("a live lease is not reprocessed", async () => {
    const positionId = "9204";
    const eventId = `MT5:TestBroker-Live:22334455:OPEN:${positionId}`;
    await db.syncEventLog.create({
      data: {
        userId: user.id,
        connectionId: connection.id,
        eventId,
        type: "POSITION_OPENED",
        status: "PROCESSING",
        leaseExpiresAt: new Date(Date.now() + 5 * 60_000), // still held
        attempts: 1,
      },
    });
    const result = await processIngestPayload(await freshConnection(), envelope([openedEvent(positionId)]));
    expect(result.results).toEqual([{ eventId, status: "DUPLICATE" }]);
    expect(await tradesFor(positionId)).toHaveLength(0);
    const row = await logRow(eventId);
    expect(row.status).toBe("PROCESSING");
    expect(row.attempts).toBe(1);
  });

  it("exhausted retries become definitive", async () => {
    const failedPosition = "9206";
    const failedEventId = `MT5:TestBroker-Live:22334455:OPEN:${failedPosition}`;
    await db.syncEventLog.create({
      data: {
        userId: user.id,
        connectionId: connection.id,
        eventId: failedEventId,
        type: "POSITION_OPENED",
        status: "FAILED",
        errorCode: "EVENT_FAILED",
        attempts: SYNC_EVENT_MAX_ATTEMPTS,
      },
    });
    const failed = await processIngestPayload(await freshConnection(), envelope([openedEvent(failedPosition)]));
    expect(failed.results).toEqual([{ eventId: failedEventId, status: "DUPLICATE" }]);
    expect(await tradesFor(failedPosition)).toHaveLength(0);
    const failedRow = await logRow(failedEventId);
    expect(failedRow.status).toBe("REJECTED");
    expect(failedRow.errorCode).toBe("RETRY_EXHAUSTED");

    const crashedPosition = "9207";
    const crashedEventId = `MT5:TestBroker-Live:22334455:OPEN:${crashedPosition}`;
    await db.syncEventLog.create({
      data: {
        userId: user.id,
        connectionId: connection.id,
        eventId: crashedEventId,
        type: "POSITION_OPENED",
        status: "PROCESSING",
        leaseExpiresAt: new Date(Date.now() - 60_000),
        attempts: SYNC_EVENT_MAX_ATTEMPTS,
      },
    });
    const crashed = await processIngestPayload(await freshConnection(), envelope([openedEvent(crashedPosition)]));
    expect(crashed.results).toEqual([{ eventId: crashedEventId, status: "DUPLICATE" }]);
    expect(await tradesFor(crashedPosition)).toHaveLength(0);
    const crashedRow = await logRow(crashedEventId);
    expect(crashedRow.status).toBe("REJECTED");
    expect(crashedRow.errorCode).toBe("RETRY_EXHAUSTED");
  });
});

describe("out-of-order events and partial closes stay coherent", () => {
  it("a late OPENED never regresses a backfilled CLOSED trade", async () => {
    const positionId = "9208";
    const closeTime = serverNow();
    const openTime = serverNow() - 7200;
    const closed = await processIngestPayload(await freshConnection(), envelope([
      {
        eventId: `MT5:TestBroker-Live:22334455:CLOSE:${positionId}`,
        type: "POSITION_CLOSED",
        time: closeTime,
        symbol: "XAUUSD",
        symbolSpec: GOLD_SPEC,
        positionId,
        ticket: `88${positionId}`,
        direction: "LONG",
        volume: "0.10",
        openTime,
        openPrice: "2650.50",
        closeTime,
        closePrice: "2658.40",
        profit: "80.00",
      },
    ]));
    expect(closed.results[0]?.status).toBe("ACCEPTED");

    const late = await processIngestPayload(await freshConnection(), envelope([openedEvent(positionId)]));
    expect(late.results[0]?.status).toBe("ACCEPTED"); // processed, no-op
    const trades = await tradesFor(positionId);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.status).toBe("CLOSED");
    expect(await db.tradeExecution.count({ where: { tradeId: trades[0]?.id } })).toBe(2);
  });

  it("a partial close sent twice creates one execution, then the close finalizes", async () => {
    const positionId = "9209";
    const partialEvent = {
      eventId: `MT5:TestBroker-Live:22334455:PCLOSE:${positionId}:1`,
      type: "POSITION_PARTIAL_CLOSE",
      time: serverNow() - 900,
      positionId,
      closedVolume: "0.05",
      closeTime: serverNow() - 900,
      closePrice: "2655.80",
      profit: "27.50",
      commission: "-0.20",
      swap: "0",
    } as MtEvent;

    await processIngestPayload(await freshConnection(), envelope([openedEvent(positionId)]));
    const first = await processIngestPayload(await freshConnection(), envelope([partialEvent]));
    expect(first.results[0]?.status).toBe("ACCEPTED");
    const dup = await processIngestPayload(await freshConnection(), envelope([partialEvent]));
    expect(dup.results).toEqual([{ eventId: partialEvent.eventId, status: "DUPLICATE" }]);

    const closeTime = serverNow();
    await processIngestPayload(await freshConnection(), envelope([
      {
        eventId: `MT5:TestBroker-Live:22334455:CLOSE:${positionId}`,
        type: "POSITION_CLOSED",
        time: closeTime,
        symbol: "XAUUSD",
        symbolSpec: GOLD_SPEC,
        positionId,
        ticket: `88${positionId}`,
        direction: "LONG",
        volume: "0.05",
        openTime: serverNow() - 3600,
        openPrice: "2650.50",
        closeTime,
        closePrice: "2658.40",
        profit: "40.00",
      },
    ]));

    const trades = await tradesFor(positionId);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.status).toBe("CLOSED");
    const executions = await db.tradeExecution.findMany({
      where: { tradeId: trades[0]?.id },
      orderBy: { time: "asc" },
    });
    expect(executions.map((e) => e.type)).toEqual(["ENTRY", "PARTIAL_EXIT", "FINAL_EXIT"]);
  });
});
