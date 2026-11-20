/**
 * v3 Phase 2 — Sync engine integration tests (PostgreSQL schema promethe_test).
 *
 * Exercises processIngestPayload end-to-end (the same code the /api/ingest/mt
 * route runs): idempotency, retries, out-of-order delivery, partial closes,
 * MT4 partial-close stitching, SL/TP modifications, balance operations,
 * symbol mapping, timezone conversion with GMT offset, broker P&L override,
 * MISMATCH binding, STALE sweep, and token→account isolation.
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
  resolveInstrumentForSymbol,
  sweepStaleConnections,
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
    login: "11223344",
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

let user: { id: string; email: string };
let accountId: string;
let connection: BrokerConnection;
let instrumentId: string;

beforeAll(async () => {
  const created = await createUserWithDefaults({
    email: "sync@test.local",
    password: "password1",
    displayName: "Sync Tester",
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
      label: "Test MT5",
      tokenHash: "f".repeat(64),
      tokenPrefix: "tj_tst",
      status: "PENDING",
    },
  });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: user.id } });
  await db.instrument.deleteMany({ where: { userId: user.id } });
  await db.symbolMapping.deleteMany({ where: { userId: user.id } });
  await db.$disconnect();
});

async function freshConnection(): Promise<BrokerConnection> {
  connection = await db.brokerConnection.findUniqueOrThrow({ where: { id: connection.id } });
  return connection;
}

describe("ingest engine — full lifecycle", () => {
  const positionId = "9001";

  it("binds the connection on the first payload (heartbeat)", async () => {
    const result = await processIngestPayload(await freshConnection(), envelope([
      {
        eventId: "MT5:TestBroker-Live:11223344:HB:1",
        type: "HEARTBEAT",
        time: serverNow(),
        balance: "10000",
        equity: "10040",
        openPositions: 0,
      },
    ]));
    expect(result.results).toEqual([
      { eventId: "MT5:TestBroker-Live:11223344:HB:1", status: "ACCEPTED" },
    ]);

    const bound = await db.brokerConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(bound.brokerServer).toBe("TestBroker-Live");
    expect(bound.brokerLogin).toBe("11223344");
    expect(bound.status).toBe("ACTIVE");
    expect(bound.lastHeartbeatAt).not.toBeNull();

    // Account mirrors the binding (import matching).
    const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.brokerServer).toBe("TestBroker-Live");

    // Equity snapshot recorded.
    const snapshot = await db.accountEquitySnapshot.findFirst({ where: { accountId } });
    expect(snapshot?.equity.toString()).toBe("10040");
  });

  it("rejects a payload from a different login with MISMATCH", async () => {
    const wrong = envelope(
      [
        {
          eventId: "MT5:TestBroker-Live:99999999:HB:2",
          type: "HEARTBEAT",
          time: serverNow(),
          balance: "1",
          equity: "1",
          openPositions: 0,
        },
      ],
      { login: "99999999" }
    );
    await expect(processIngestPayload(await freshConnection(), wrong)).rejects.toThrow();
    const mismatched = await db.brokerConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(mismatched.status).toBe("MISMATCH");

    // Owner resets the binding from the UI → PENDING again.
    connection = await db.brokerConnection.update({
      where: { id: connection.id },
      data: { brokerServer: null, brokerLogin: null, status: "PENDING" },
    });
  });

  it("handles POSITION_OPENED with symbol mapping + magic strategy", async () => {
    const strategy = await db.strategy.create({
      data: { userId: user.id, name: "Gold London" },
    });
    await db.magicNumberMapping.create({
      data: { userId: user.id, magicNumber: "777", strategyId: strategy.id },
    });

    const openTime = serverNow() - 3600;
    const result = await processIngestPayload(await freshConnection(), envelope([
      {
        eventId: `MT5:TestBroker-Live:11223344:OPEN:${positionId}`,
        type: "POSITION_OPENED",
        time: openTime,
        symbol: "XAUUSDm",
        symbolSpec: GOLD_SPEC,
        positionId,
        ticket: "99001",
        direction: "LONG",
        volume: "0.50",
        openTime,
        openPrice: "2650.50",
        stopLoss: "2645.00",
        takeProfit: "2662.00",
        magic: "777",
      },
    ]));
    expect(result.results[0]?.status).toBe("ACCEPTED");

    const trade = await db.trade.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: `MT5:TestBroker-Live:11223344:${positionId}` } },
    });
    expect(trade.status).toBe("OPEN");
    expect(trade.source).toBe("EA_SYNC");
    expect(trade.needsDetails).toBe(true);
    expect(trade.magicNumber).toBe("777");
    expect(trade.strategyId).toBe(strategy.id);
    expect(Number(trade.initialStopLoss)).toBe(2645.00);
    expect(trade.positionId).toBe(positionId);

    // UTC conversion: openTime (server) − 7200s.
    expect(new Date(trade.entryTime).getTime()).toBe((openTime - OFFSET) * 1000);

    // Symbol mapping recorded: XAUUSDm → normalized XAUUSD instrument.
    const mapping = await db.symbolMapping.findUniqueOrThrow({
      where: { userId_brokerSymbol: { userId: user.id, brokerSymbol: "XAUUSDm" } },
    });
    expect(mapping.instrumentId).toBe(trade.instrumentId);
    const instrument = await db.instrument.findUniqueOrThrow({ where: { id: mapping.instrumentId } });
    expect(instrument.symbol).toBe("XAUUSD");
    expect(Number(instrument.pipSize)).toBe(0.1); // 2 digits × 10 points
    instrumentId = instrument.id;
  });

  it("records SL/TP modifications with history rows", async () => {
    await processIngestPayload(await freshConnection(), envelope([
      {
        eventId: `MT5:TestBroker-Live:11223344:MOD:${positionId}:1`,
        type: "POSITION_MODIFIED",
        time: serverNow() - 1800,
        positionId,
        stopLoss: "2650.00",
        takeProfit: "2668.00",
      },
    ]));

    const trade = await db.trade.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: `MT5:TestBroker-Live:11223344:${positionId}` } },
    });
    expect(Number(trade.stopLoss)).toBe(2650.00);
    expect(Number(trade.initialStopLoss)).toBe(2645.00); // initial preserved
    expect(Number(trade.takeProfit)).toBe(2668.00);

    const modifications = await db.tradeModification.findMany({ where: { tradeId: trade.id } });
    expect(modifications).toHaveLength(2);
    expect(modifications.some((m) => m.field === "STOP_LOSS" && Number(m.oldValue) === 2645 && Number(m.newValue) === 2650)).toBe(true);
  });

  it("handles partial closes as executions", async () => {
    await processIngestPayload(await freshConnection(), envelope([
      {
        eventId: `MT5:TestBroker-Live:11223344:PCLOSE:${positionId}:1`,
        type: "POSITION_PARTIAL_CLOSE",
        time: serverNow() - 900,
        positionId,
        closedVolume: "0.20",
        closeTime: serverNow() - 900,
        closePrice: "2655.80",
        profit: "106.00",
        commission: "-0.40",
        swap: "0",
      },
    ]));

    const trade = await db.trade.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: `MT5:TestBroker-Live:11223344:${positionId}` } },
    });
    expect(trade.status).toBe("OPEN");
    const executions = await db.tradeExecution.findMany({ where: { tradeId: trade.id }, orderBy: { time: "asc" } });
    expect(executions.map((e) => e.type)).toEqual(["ENTRY", "PARTIAL_EXIT"]);
    expect(executions[1]?.lots.toString()).toBe("0.2");
    expect(executions[1]?.commission.toString()).toBe("0.4"); // app signing
  });

  it("closes the position with broker P&L, pips and R", async () => {
    await processIngestPayload(await freshConnection(), envelope([
      {
        eventId: `MT5:TestBroker-Live:11223344:CLOSE:${positionId}`,
        type: "POSITION_CLOSED",
        time: serverNow(),
        symbol: "XAUUSDm",
        symbolSpec: GOLD_SPEC,
        positionId,
        ticket: "99001",
        direction: "LONG",
        volume: "0.30",
        openTime: serverNow() - 3600,
        openPrice: "2650.50",
        closeTime: serverNow(),
        closePrice: "2658.40",
        stopLoss: "2650.00",
        takeProfit: "2668.00",
        commission: "-0.60",
        swap: "-0.30",
        fees: "0",
        profit: "237.00", // per-deal profit (the partial already sent 106)
        mfePrice: "2659.10",
        maePrice: "2649.20",
        mfeMaeComplete: true,
      },
    ]));

    const trade = await db.trade.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: `MT5:TestBroker-Live:11223344:${positionId}` } },
    });
    expect(trade.status).toBe("CLOSED");
    expect(trade.pnlSource).toBe("BROKER");
    // net = gross − costs: 343 − (0.40 + 0.60) − 0.30 − 0 = 341.70
    expect(Number(trade.netPnl)).toBeCloseTo(341.7, 2);
    expect(trade.commission.toString()).toBe("1"); // 0.40 + 0.60
    expect(trade.swap.toString()).toBe("0.3");
    // pips: weighted entry 2650.50, weighted exit 2657.36 → 68.6 pips
    expect(Number(trade.pips)).toBeGreaterThan(65);
    expect(Number(trade.pips)).toBeLessThan(72);
    // R: risk = |2650.50 − 2645.00| × 0.5 lots × 100 = 275 → 341.7 / 275 ≈ 1.24
    expect(Number(trade.rMultiple)).toBeCloseTo(1.24, 1);
    expect(trade.resultType).toBe("WIN");
    expect(Number(trade.mfePrice)).toBe(2659.10);
    expect(trade.mfeMaeComplete).toBe(true);
    expect(trade.mfeMaeSource).toBe("EA_TRACKED");

    const executions = await db.tradeExecution.findMany({ where: { tradeId: trade.id }, orderBy: { time: "asc" } });
    expect(executions.map((e) => e.type)).toEqual(["ENTRY", "PARTIAL_EXIT", "FINAL_EXIT"]);
  });

  it("is idempotent: re-sending the same events changes nothing", async () => {
    const before = await db.trade.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: `MT5:TestBroker-Live:11223344:${positionId}` } },
    });
    const result = await processIngestPayload(await freshConnection(), envelope([
      {
        eventId: `MT5:TestBroker-Live:11223344:CLOSE:${positionId}`,
        type: "POSITION_CLOSED",
        time: serverNow(),
        symbol: "XAUUSDm",
        positionId,
        ticket: "99001",
        volume: "0.30",
        closeTime: serverNow(),
        closePrice: "2658.40",
        profit: "237.00",
      },
      {
        eventId: `MT5:TestBroker-Live:11223344:PCLOSE:${positionId}:1`,
        type: "POSITION_PARTIAL_CLOSE",
        time: serverNow() - 900,
        positionId,
        closedVolume: "0.20",
        closeTime: serverNow() - 900,
        closePrice: "2655.80",
        profit: "106.00",
      },
    ]));
    expect(result.results.every((r) => r.status === "DUPLICATE")).toBe(true);

    const after = await db.trade.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: `MT5:TestBroker-Live:11223344:${positionId}` } },
    });
    expect(after.netPnl?.equals(before.netPnl ?? 0)).toBe(true);
    const executionCount = await db.tradeExecution.count({ where: { tradeId: after.id } });
    expect(executionCount).toBe(3);
  });

  it("processes out-of-order history-style closes (backfill)", async () => {
    const latePosition = "9002";
    const openTime = serverNow() - 7200;
    await processIngestPayload(connection, envelope([
      {
        eventId: `MT5:TestBroker-Live:11223344:CLOSE:${latePosition}`,
        type: "POSITION_CLOSED",
        time: serverNow(),
        symbol: "EURUSD",
        symbolSpec: { digits: "5", point: "0.00001", tickSize: "0.00001", tickValue: "1", contractSize: "100000" },
        positionId: latePosition,
        ticket: "99002",
        direction: "SHORT",
        volume: "0.10",
        openTime,
        openPrice: "1.08500",
        closeTime: serverNow() - 3600,
        closePrice: "1.08320",
        stopLoss: "1.08650",
        takeProfit: "1.08200",
        commission: "-0.35",
        swap: "0",
        fees: "0",
        profit: "18.00",
      },
    ]));

    const trade = await db.trade.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: `MT5:TestBroker-Live:11223344:${latePosition}` } },
    });
    expect(trade.status).toBe("CLOSED");
    expect(Number(trade.netPnl)).toBeCloseTo(17.65, 2);
    expect(Number(trade.pips)).toBeCloseTo(18, 0); // (1.08500−1.08320)/0.0001
    expect(trade.exitReason).toBe("MANUAL");
    const executions = await db.tradeExecution.findMany({ where: { tradeId: trade.id } });
    expect(executions.map((e) => e.type).sort()).toEqual(["ENTRY", "FINAL_EXIT"]);
  });

  it("never regresses a CLOSED trade on a late OPENED", async () => {
    const result = await processIngestPayload(await freshConnection(), envelope([
      {
        eventId: `MT5:TestBroker-Live:11223344:OPEN:9002`,
        type: "POSITION_OPENED",
        time: serverNow() - 7200,
        symbol: "EURUSD",
        positionId: "9002",
        ticket: "99002",
        direction: "SHORT",
        volume: "0.10",
        openTime: serverNow() - 7200,
        openPrice: "1.08500",
      },
    ]));
    expect(result.results[0]?.status).toBe("ACCEPTED");
    const trade = await db.trade.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: "MT5:TestBroker-Live:11223344:9002" } },
    });
    expect(trade.status).toBe("CLOSED"); // still closed
    expect(await db.trade.count({ where: { accountId, positionId: "9002" } })).toBe(1);
  });

  it("creates balance operations as deduped CashTransactions", async () => {
    const eventId = `MT5:TestBroker-Live:11223344:BAL:${nowSec()}`;
    const event = {
      eventId,
      type: "BALANCE_OPERATION" as const,
      time: serverNow(),
      amount: "500",
      kind: "DEPOSIT" as const,
      comment: "wire in",
    };
    await processIngestPayload(await freshConnection(), envelope([event]));
    const cash = await db.cashTransaction.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: eventId } },
    });
    expect(cash.type).toBe("DEPOSIT");
    expect(Number(cash.amount)).toBe(500);

    // Re-send under the SAME eventId → DUPLICATE, no double entry.
    await processIngestPayload(await freshConnection(), envelope([event]));
    const count = await db.cashTransaction.count({ where: { accountId, externalId: eventId } });
    expect(count).toBe(1);
  });

  it("HISTORY_BATCH pages process like individual closes", async () => {
    const trades = [1, 2, 3].map((n) => ({
      positionId: `HB${n}`,
      ticket: `HB${n}`,
      symbol: "XAUUSDm",
      symbolSpec: GOLD_SPEC,
      direction: "LONG" as const,
      volume: "0.10",
      openTime: serverNow() - 86400 - n * 3600,
      openPrice: "2640.00",
      closeTime: serverNow() - 86400,
      closePrice: "2645.00",
      commission: "-0.20",
      swap: "0",
      fees: "0",
      profit: "50.00",
    }));
    await processIngestPayload(await freshConnection(), envelope([
      { eventId: "MT5:TestBroker-Live:11223344:HIST:1", type: "HISTORY_BATCH", time: serverNow(), page: 1, totalPages: 1, trades },
    ]));
    const externalIds = trades.map((t) => `MT5:TestBroker-Live:11223344:${t.positionId}`);
    const rows = await db.trade.findMany({ where: { accountId, externalId: { in: externalIds } } });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.status).toBe("CLOSED");
      expect(Number(row.netPnl)).toBeCloseTo(49.8, 1);
    }
  });
});

describe("MT4 partial-close chain stitching", () => {
  it("stitches a 'from #N' remainder into the original trade", async () => {
    // MT4 platform connection.
    const mt4 = await db.brokerConnection.create({
      data: {
        userId: user.id,
        accountId,
        platform: "MT4",
        label: "Test MT4",
        tokenHash: "e".repeat(64),
        tokenPrefix: "tj_mt4",
        status: "PENDING",
      },
    });
    const payload = (events: MtEvent[]): MtIngestPayload => ({
      schemaVersion: 1,
      platform: "MT4",
      eaVersion: "1.0.1",
      server: "TestBroker-MT4",
      login: "44332211",
      serverGmtOffsetSeconds: OFFSET,
      sentAt: nowSec(),
      events,
    });

    const openTime = serverNow() - 3600;
    // 1. Original order #111 opened 0.30.
    await processIngestPayload(mt4, payload([
      {
        eventId: "MT4:TestBroker-MT4:44332211:OPEN:111",
        type: "POSITION_OPENED",
        time: openTime,
        symbol: "XAUUSD",
        positionId: "111",
        ticket: "111",
        direction: "LONG",
        volume: "0.30",
        openTime,
        openPrice: "2650.00",
        stopLoss: "2645.00",
      },
    ]));

    // 2. Remainder ticket #222 with comment "from #111" → ADD, not a new trade.
    await processIngestPayload(mt4, payload([
      {
        eventId: "MT4:TestBroker-MT4:44332211:OPEN:222",
        type: "POSITION_OPENED",
        time: serverNow() - 600,
        symbol: "XAUUSD",
        positionId: "222",
        ticket: "222",
        direction: "LONG",
        volume: "0.20",
        openTime: serverNow() - 600,
        openPrice: "2651.00",
        comment: "from #111",
      },
    ]));

    const trade = await db.trade.findUniqueOrThrow({
      where: { accountId_externalId: { accountId, externalId: "MT4:TestBroker-MT4:44332211:111" } },
    });
    const executions = await db.tradeExecution.findMany({ where: { tradeId: trade.id }, orderBy: { time: "asc" } });
    expect(executions.map((e) => e.type)).toEqual(["ENTRY", "ADD"]);
    expect(await db.trade.count({ where: { accountId, externalId: "MT4:TestBroker-MT4:44332211:222" } })).toBe(0);
  });
});

describe("STALE sweep", () => {
  it("marks a weekday-silent connection STALE and notifies once", async () => {
    // Heartbeat 2h ago on a weekday → STALE (weekend-safe: skip assertion
    // when the test itself runs during the FX weekend).
    const stale = await db.brokerConnection.create({
      data: {
        userId: user.id,
        accountId,
        platform: "MT5",
        label: "Silent MT5",
        tokenHash: "d".repeat(64),
        tokenPrefix: "tj_sil",
        status: "ACTIVE",
        lastHeartbeatAt: new Date(Date.now() - 2 * 3600_000),
      },
    });

    const isWeekend = [0, 6].includes(new Date().getUTCDay()) ||
      (new Date().getUTCDay() === 5 && new Date().getUTCHours() >= 22);
    if (!isWeekend) {
      const sweep = await sweepStaleConnections();
      expect(sweep.staleCount).toBeGreaterThanOrEqual(1);
      const row = await db.brokerConnection.findUniqueOrThrow({ where: { id: stale.id } });
      expect(row.status).toBe("STALE");
      const notification = await db.notificationLog.findFirst({
        where: { userId: user.id, type: "SYNC_STALE" },
      });
      expect(notification).not.toBeNull();
    }

    await db.brokerConnection.delete({ where: { id: stale.id } });
    await db.notificationLog.deleteMany({ where: { userId: user.id } });
  });
});

describe("symbol resolution", () => {
  it("maps broker suffixes to existing instruments", async () => {
    const instrument = await resolveInstrumentForSymbol(user.id, "EURUSD.pro", {
      digits: "5",
      point: "0.00001",
      tickSize: "0.00001",
      tickValue: "1",
      contractSize: "100000",
    });
    expect(instrument.symbol).toBe("EURUSD");
    // matches the user's (or global) preset — never a new instrument
    expect(instrument.userId === null || instrument.userId === user.id).toBe(true);
  });

  it("aliases GOLD → XAUUSD", async () => {
    const instrument = await resolveInstrumentForSymbol(user.id, "GOLD", null);
    expect(instrument.symbol).toBe("XAUUSD");
  });
});
