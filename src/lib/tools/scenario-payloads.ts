/**
 * Tool-scenario payloads (Lot 1 Phase C, MD §3.5/§3.6).
 *
 * Pure serialize/parse helpers for the ToolScenario payloads of the
 * calculators. The server stores the payload as opaque JSON, so a
 * faithful round-trip lives or dies here: every field the calculator
 * shows must be serialized on save and restored on load. Previously
 * multi-TP dropped the FX rate and the risk mode on load, and
 * risk-reward dropped the currency — all three are covered by
 * parse/serialize pairs in this file, with regression tests in
 * tests/unit/tool-scenarios.test.ts.
 *
 * Parse is forgiving: unknown or mistyped fields are dropped (the
 * caller keeps its current value), never thrown on. Serialize only
 * writes the fields the calculator owns.
 */

import type { Direction } from "@/lib/trading/types";

export type RiskMode = "percent" | "amount";
export type RiskBasis = "BALANCE" | "EQUITY";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asDirection(value: unknown): Direction | undefined {
  return value === "LONG" || value === "SHORT" ? value : undefined;
}

function asRiskMode(value: unknown): RiskMode | undefined {
  return value === "percent" || value === "amount" ? value : undefined;
}

function asRiskBasis(value: unknown): RiskBasis | undefined {
  return value === "BALANCE" || value === "EQUITY" ? value : undefined;
}

// ── Position size ────────────────────────────────────────────────────────────

export interface PositionSizeScenario {
  symbol?: string;
  balance?: string;
  currency?: string;
  riskBasis?: RiskBasis;
  accountEquity?: string;
  riskMode?: RiskMode;
  riskPercent?: string;
  riskAmount?: string;
  direction?: Direction;
  entry?: string;
  stopLoss?: string;
  /** Manual quote→account rate typed by the user. */
  rate?: string;
  lotStep?: string;
  minLots?: string;
  maxLots?: string;
  estimatedCosts?: string;
}

export function parsePositionSizeScenario(
  payload: Record<string, unknown>
): PositionSizeScenario {
  return {
    symbol: asString(payload.symbol),
    balance: asString(payload.balance),
    currency: asString(payload.currency),
    riskBasis: asRiskBasis(payload.riskBasis),
    accountEquity: asString(payload.accountEquity),
    riskMode: asRiskMode(payload.riskMode),
    riskPercent: asString(payload.riskPercent),
    riskAmount: asString(payload.riskAmount),
    direction: asDirection(payload.direction),
    entry: asString(payload.entry),
    stopLoss: asString(payload.stopLoss),
    rate: asString(payload.rate),
    lotStep: asString(payload.lotStep),
    minLots: asString(payload.minLots),
    maxLots: asString(payload.maxLots),
    estimatedCosts: asString(payload.estimatedCosts),
  };
}

// ── P&L simulator ────────────────────────────────────────────────────────────

export interface PnlSimulatorScenario {
  symbol?: string;
  direction?: Direction;
  lots?: string;
  entry?: string;
  exit?: string;
  stopLoss?: string;
  takeProfit?: string;
  commission?: string;
  swap?: string;
  accountCurrency?: string;
  /** Manual quote→account rate typed by the user. */
  manualRate?: string;
}

export function parsePnlSimulatorScenario(
  payload: Record<string, unknown>
): PnlSimulatorScenario {
  return {
    symbol: asString(payload.symbol),
    direction: asDirection(payload.direction),
    lots: asString(payload.lots),
    entry: asString(payload.entry),
    exit: asString(payload.exit),
    stopLoss: asString(payload.stopLoss),
    takeProfit: asString(payload.takeProfit),
    commission: asString(payload.commission),
    swap: asString(payload.swap),
    accountCurrency: asString(payload.accountCurrency),
    manualRate: asString(payload.manualRate),
  };
}

// ── Multi-TP ─────────────────────────────────────────────────────────────────

export interface MultiTpTierState {
  price: string;
  allocation: string;
}

export interface MultiTpScenario {
  symbol?: string;
  balance?: string;
  currency?: string;
  riskMode?: RiskMode;
  riskPercent?: string;
  riskAmount?: string;
  direction?: Direction;
  entry?: string;
  stopLoss?: string;
  tiers?: MultiTpTierState[];
  /** Manual quote→account rate typed by the user. */
  manualRate?: string;
  commission?: string;
  swap?: string;
}

function asTiers(value: unknown): MultiTpTierState[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) {
    return undefined;
  }
  const tiers: MultiTpTierState[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }
    const tier = raw as Record<string, unknown>;
    const price = asString(tier.price);
    const allocation = asString(tier.allocation);
    if (price === undefined || allocation === undefined) return undefined;
    tiers.push({ price, allocation });
  }
  return tiers;
}

export function parseMultiTpScenario(
  payload: Record<string, unknown>
): MultiTpScenario {
  return {
    symbol: asString(payload.symbol),
    balance: asString(payload.balance),
    currency: asString(payload.currency),
    riskMode: asRiskMode(payload.riskMode),
    riskPercent: asString(payload.riskPercent),
    riskAmount: asString(payload.riskAmount),
    direction: asDirection(payload.direction),
    entry: asString(payload.entry),
    stopLoss: asString(payload.stopLoss),
    tiers: asTiers(payload.tiers),
    manualRate: asString(payload.manualRate),
    commission: asString(payload.commission),
    swap: asString(payload.swap),
  };
}

// ── Risk / reward ────────────────────────────────────────────────────────────

export interface RiskRewardScenario {
  winRate?: string;
  rr?: string;
  riskPerTrade?: string;
  currency?: string;
}

export function parseRiskRewardScenario(
  payload: Record<string, unknown>
): RiskRewardScenario {
  return {
    winRate: asString(payload.winRate),
    rr: asString(payload.rr),
    riskPerTrade: asString(payload.riskPerTrade),
    currency: asString(payload.currency),
  };
}
