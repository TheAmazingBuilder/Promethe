/**
 * v2.5 Module 5 - trading tools: shared entry shapes.
 *
 * These types mirror the Prisma models 1:1 (ToolScenario, FxRate,
 * MarketSessionSetting, ExitPlan, ExposureAlertSetting) and are the shapes
 * the UI works with. Persistence lives on the server now (src/server/tools.ts
 * + /api/v1/* routes, via src/hooks/use-tools.ts); nothing here touches
 * localStorage anymore.
 */
"use client";

export interface ToolScenario {
  id: string;
  name: string;
  /** MULTI_TP | MARGIN */
  kind: string;
  /** JSON payload of the calculator inputs. */
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface FxRateEntry {
  id: string;
  base: string;
  quote: string;
  /** 1 base = rate quote. Stored as a string (exact decimal). */
  rate: string;
  source: "MANUAL" | "CSV";
  /** ISO date the rate applies to. */
  date: string;
}

export interface MarketSessionSettingEntry {
  id: string;
  name: string;
  kind: "DISPLAY" | "DETECTION";
  /** IANA zone, e.g. Europe/London, or "UTC". */
  timezone: string;
  /** Local "HH:MM" open / close in the session timezone. */
  openTime: string;
  closeTime: string;
  /** ISO weekdays 1 = Monday ... 7 = Sunday. */
  activeDays: number[];
  enabled: boolean;
  sortOrder: number;
}

export interface ExitPlanTier {
  /** % of the position closed at this tier (tiers sum to 100). */
  pct: number;
  targetType: "PRICE" | "R";
  /** Target price, or R multiple as a string ("1.5"). */
  target: string;
}

export interface ExitPlanEntry {
  id: string;
  name: string;
  tiers: ExitPlanTier[];
  /** Move SL to breakeven after this tier index (0-based), null = never. */
  breakevenAfterTier: number | null;
  /** Start trailing after this tier index (0-based), null = never. */
  trailingAfterTier: number | null;
  notes: string;
  createdAt: string;
}

export interface ExposureSettings {
  enabled: boolean;
  /** Same currency, same direction, on 2+ positions, above this % of balance. */
  duplicationThresholdPercent: string;
  /** One currency above this % of balance (same direction) warns. */
  maxCurrencyExposurePercent: string;
}

export const DEFAULT_EXPOSURE_SETTINGS: ExposureSettings = {
  enabled: true,
  duplicationThresholdPercent: "2",
  maxCurrencyExposurePercent: "5",
};
