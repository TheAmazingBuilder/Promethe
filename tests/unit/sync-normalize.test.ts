/**
 * v3 Phase 2 — Pure normalization unit tests (normalize.ts + status.ts).
 */
import { describe, expect, it } from "vitest";
import {
  balanceOperationType,
  brokerNetPnl,
  eaCostToAppCost,
  inferExitReason,
  inferSpecFromPayload,
  normalizeBrokerSymbol,
  parseMt4ChainComment,
  positionExternalId,
  serverTimeToUtc,
} from "@/lib/sync/normalize";
import {
  evaluateLifeStatus,
  isWeekendUtc,
  shouldRecordEquitySnapshot,
  withinSkew,
} from "@/lib/sync/status";

describe("serverTimeToUtc", () => {
  it("converts broker server time to UTC using the offset", () => {
    // Server 12:00 GMT+2 → UTC 10:00
    const utc = serverTimeToUtc(1735732800, 7200);
    expect(utc.toISOString()).toBe(new Date((1735732800 - 7200) * 1000).toISOString());
    expect(utc.getUTCHours()).toBe(10);
  });

  it("handles negative offsets (US brokers)", () => {
    const utc = serverTimeToUtc(1735732800, -18000); // GMT-5
    expect(utc.getTime()).toBe((1735732800 + 18000) * 1000);
  });
});

describe("positionExternalId", () => {
  it("builds a stable cross-platform id", () => {
    expect(positionExternalId("MT5", "SRV", "123", "555")).toBe("MT5:SRV:123:555");
  });
});

describe("parseMt4ChainComment", () => {
  it("parses 'from #' references (remainder ticket)", () => {
    expect(parseMt4ChainComment("from #123456")).toEqual({ kind: "from", ticket: "123456" });
    expect(parseMt4ChainComment("de #98765")).toEqual({ kind: "from", ticket: "98765" });
  });

  it("parses 'to #' references (closed part)", () => {
    expect(parseMt4ChainComment("to #456789")).toEqual({ kind: "to", ticket: "456789" });
  });

  it("returns null for regular comments", () => {
    expect(parseMt4ChainComment("some slippage")).toBeNull();
    expect(parseMt4ChainComment("")).toBeNull();
    expect(parseMt4ChainComment(null)).toBeNull();
    expect(parseMt4ChainComment("[tp] 2660.00")).toBeNull();
  });
});

describe("eaCostToAppCost / brokerNetPnl", () => {
  it("flips the MetaTrader signing to the app convention", () => {
    expect(eaCostToAppCost("-0.70").toString()).toBe("0.7");
    expect(eaCostToAppCost("0.5").toString()).toBe("-0.5");
    expect(eaCostToAppCost(null).toString()).toBe("0");
    expect(eaCostToAppCost("").toString()).toBe("0");
  });

  it("computes the broker net P&L (account currency)", () => {
    // gross 53.00, commission -0.70, swap 0, fees 0 → net 52.30
    expect(brokerNetPnl("53.00", "-0.70", "0", "0").toString()).toBe("52.3");
    expect(brokerNetPnl("-20", "-0.35", "-0.10", "0").toString()).toBe("-20.45");
  });
});

describe("normalizeBrokerSymbol", () => {
  it("strips common retail suffixes", () => {
    expect(normalizeBrokerSymbol("XAUUSDm")).toBe("XAUUSD");
    expect(normalizeBrokerSymbol("EURUSD.pro")).toBe("EURUSD");
    expect(normalizeBrokerSymbol("GBPUSD.raw")).toBe("GBPUSD");
    expect(normalizeBrokerSymbol("EURUSD-i")).toBe("EURUSD");
    expect(normalizeBrokerSymbol("GBPUSD-s")).toBe("GBPUSD");
  });

  it("applies well-known aliases", () => {
    expect(normalizeBrokerSymbol("GOLD")).toBe("XAUUSD");
    expect(normalizeBrokerSymbol("gold")).toBe("XAUUSD");
    expect(normalizeBrokerSymbol("SILVERm")).toBe("XAGUSD");
    expect(normalizeBrokerSymbol("GOLD.pro")).toBe("XAUUSD");
  });

  it("keeps canonical symbols intact", () => {
    expect(normalizeBrokerSymbol("XAUUSD")).toBe("XAUUSD");
    expect(normalizeBrokerSymbol("EURUSD")).toBe("EURUSD");
    expect(normalizeBrokerSymbol("NAS100")).toBe("NAS100");
    expect(normalizeBrokerSymbol("usdjpy")).toBe("USDJPY");
  });

  it("does not over-strip short symbols", () => {
    expect(normalizeBrokerSymbol("USDM")).toBe("USDM"); // would leave < 4 chars
  });
});

describe("inferSpecFromPayload", () => {
  it("infers a 0.10 pip for 2-digit metals", () => {
    const spec = inferSpecFromPayload({ digits: "2", point: "0.01", tickSize: "0.01", tickValue: "1", contractSize: "100" });
    expect(spec.pipSize).toBe("0.1");
    expect(spec.pointSize).toBe("0.01");
    expect(spec.contractSize).toBe("100");
  });

  it("infers 0.0001 pip for 5-digit FX", () => {
    const spec = inferSpecFromPayload({ digits: "5", point: "0.00001", tickSize: "0.00001", tickValue: "1", contractSize: "100000" });
    expect(spec.pipSize).toBe("0.0001");
  });

  it("infers 0.01 pip for 3-digit JPY pairs", () => {
    const spec = inferSpecFromPayload({ digits: "3", point: "0.001", tickSize: "0.001", tickValue: "0.01", contractSize: "100000" });
    expect(spec.pipSize).toBe("0.01");
  });
});

describe("inferExitReason", () => {
  it("detects SL/TP hits within tolerance", () => {
    expect(inferExitReason("LONG", "2645.00", "2645.00", "2660.00")).toBe("SL_HIT");
    expect(inferExitReason("LONG", "2660.00", "2645.00", "2660.00")).toBe("TP_HIT");
    expect(inferExitReason("LONG", "2655.00", "2645.00", "2660.00")).toBe("MANUAL");
    // Slippage past the stop still counts as SL_HIT.
    expect(inferExitReason("LONG", "2644.70", "2645.00", "2660.00")).toBe("SL_HIT");
  });
});

describe("balanceOperationType", () => {
  it("maps signs and kinds to cash transaction types", () => {
    expect(balanceOperationType("500")).toBe("DEPOSIT");
    expect(balanceOperationType("-300")).toBe("WITHDRAWAL");
    expect(balanceOperationType("100", "CREDIT")).toBe("BONUS");
    expect(balanceOperationType("-50", "WITHDRAWAL")).toBe("WITHDRAWAL");
  });
});

describe("status evaluation", () => {
  it("treats Sat/Sun/Fri-late-UTC as the FX weekend", () => {
    expect(isWeekendUtc(new Date("2025-01-04T12:00:00Z"))).toBe(true); // Sat
    expect(isWeekendUtc(new Date("2025-01-05T12:00:00Z"))).toBe(true); // Sun
    expect(isWeekendUtc(new Date("2025-01-03T21:00:00Z"))).toBe(false); // Fri 21:59
    expect(isWeekendUtc(new Date("2025-01-03T23:00:00Z"))).toBe(true); // Fri 23:00
    expect(isWeekendUtc(new Date("2025-01-06T12:00:00Z"))).toBe(false); // Mon
  });

  it("derives PENDING/ACTIVE/STALE from heartbeat age", () => {
    const now = new Date("2025-01-06T12:00:00Z"); // Monday
    expect(evaluateLifeStatus(null, now)).toBe("PENDING");
    expect(evaluateLifeStatus(new Date(now.getTime() - 10 * 60_000), now)).toBe("ACTIVE");
    expect(evaluateLifeStatus(new Date(now.getTime() - 45 * 60_000), now)).toBe("STALE");
    // Same silence on a weekend stays ACTIVE until 72h.
    const sat = new Date("2025-01-04T12:00:00Z");
    expect(evaluateLifeStatus(new Date(sat.getTime() - 45 * 60_000), sat)).toBe("ACTIVE");
    expect(evaluateLifeStatus(new Date(sat.getTime() - 73 * 3600_000), sat)).toBe("STALE");
  });

  it("downsamples equity snapshots to 15-minute intervals", () => {
    const now = new Date("2025-01-06T12:00:00Z");
    expect(shouldRecordEquitySnapshot(null, now)).toBe(true);
    expect(shouldRecordEquitySnapshot(new Date(now.getTime() - 5 * 60_000), now)).toBe(false);
    expect(shouldRecordEquitySnapshot(new Date(now.getTime() - 16 * 60_000), now)).toBe(true);
  });

  it("tolerates up to 10 minutes of clock skew", () => {
    const now = new Date("2025-01-06T12:00:00Z");
    expect(withinSkew(Math.floor(now.getTime() / 1000) - 300, now)).toBe(true);
    expect(withinSkew(Math.floor(now.getTime() / 1000) - 900, now)).toBe(false);
  });
});
