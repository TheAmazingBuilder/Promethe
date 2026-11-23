/**
 * v3 — Redaction engine (PURE — shared by share links, mentor views with
 * canViewAmounts = false, and image export).
 *
 * Non-negotiable rules (v3 §4.4):
 *  - Redaction is applied on the SERVER, before data reaches the client or
 *    the stored snapshot.
 *  - Hidden fields are ABSENT from the payload (deleted structurally), never
 *    merely hidden by CSS or set to null-with-key-present.
 *  - The leak tests (tests/unit/redaction.test.ts) serialize the full
 *    redacted payload and assert that no forbidden key or value appears.
 *
 * Input contracts intentionally follow the trade DTOs (src/lib/trading/dto.ts)
 * but accept loose records — the engine must never crash on an unexpected
 * extra field; it simply copies it unless a policy rule removes it.
 */

export interface RedactionPolicy {
  /** "Pips & R only": hides lots, risk amount, currency P&L, costs, balances. */
  hideAmounts: boolean;
  /** Hides account name/id/currency/balance and broker. */
  hideAccountInfo: boolean;
  /** Hides notes, pre/post analysis, lesson learned. */
  hideNotes: boolean;
  /** Hides screenshots entirely (they may reveal balances/account numbers). */
  hideScreenshots: boolean;
  /** Hides strategy name/id. */
  hideStrategyName: boolean;
  /** Replaces exact timestamps with their date (YYYY-MM-DD) only. */
  hideExactTimes: boolean;
  /** Hides psychology fields (emotions, ratings, checklist) - mentor journal scope off. */
  hidePsychology: boolean;
}

/** The "Pips & R only" preset from the share dialog. */
export const PIPS_R_ONLY_PRESET: RedactionPolicy = {
  hideAmounts: true,
  hideAccountInfo: true,
  hideNotes: false,
  hideScreenshots: true, // screenshots may show balances - OFF by default with amounts hidden
  hideStrategyName: false,
  hideExactTimes: false,
  hidePsychology: false,
};

/** Anonymous image-export preset (v3 §4.7). */
export const ANONYMOUS_EXPORT_PRESET: RedactionPolicy = {
  hideAmounts: true,
  hideAccountInfo: true,
  hideNotes: true,
  hideScreenshots: true,
  hideStrategyName: false,
  hideExactTimes: true,
  hidePsychology: false,
};

export const NO_REDACTION: RedactionPolicy = {
  hideAmounts: false,
  hideAccountInfo: false,
  hideNotes: false,
  hideScreenshots: false,
  hideStrategyName: false,
  hideExactTimes: false,
  hidePsychology: false,
};

/** Parses a stored redactionJson, defaulting unknown/absent flags to false. */
export function parseRedactionPolicy(json: string | null | undefined): RedactionPolicy {
  if (!json) return { ...NO_REDACTION };
  try {
    const raw = JSON.parse(json) as Partial<RedactionPolicy>;
    return {
      hideAmounts: raw.hideAmounts === true,
      hideAccountInfo: raw.hideAccountInfo === true,
      hideNotes: raw.hideNotes === true,
      hideScreenshots: raw.hideScreenshots === true,
      hideStrategyName: raw.hideStrategyName === true,
      hideExactTimes: raw.hideExactTimes === true,
      hidePsychology: raw.hidePsychology === true,
    };
  } catch {
    return { ...NO_REDACTION };
  }
}

// ── internals ────────────────────────────────────────────────────────────────

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep structural copy with per-key removal (never mutates the input). */
function omit(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (keys.includes(key)) continue; // absent, not null
    out[key] = value;
  }
  return out;
}

/** Truncates ISO timestamps to their date, recursively on known time keys. */
const TIME_KEYS = new Set(["time", "entryTime", "exitTime", "createdAt", "updatedAt", "editedAt"]);

function redactTimesDeep(value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value.slice(0, 10);
  }
  if (Array.isArray(value)) return value.map(redactTimesDeep);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (TIME_KEYS.has(key)) {
        out[key] = redactTimesDeep(item);
      } else if (Array.isArray(item) || isPlainObject(item)) {
        // Recurse into nested structures (e.g. executions[].time).
        out[key] = redactTimesDeep(item);
      } else {
        out[key] = item;
      }
    }
    return out;
  }
  return value;
}

// Keys removed per policy flag. Field names follow the trade DTOs.
const AMOUNT_KEYS = [
  "netPnl", "grossPnl", "commission", "swap", "fees", "riskAmount",
  "lots", "units", "pnlCurrency", "accountInitialBalance", "accountBalanceAtEntry",
  "plannedRiskAmount", "quoteToAccountRate",
];
const ACCOUNT_KEYS = [
  "accountId", "accountName", "accountCurrency", "accountInitialBalance",
  "broker", "brokerServer", "brokerLogin", "accountType",
];
const NOTE_KEYS = ["notes", "preTradeAnalysis", "postTradeReview", "lessonLearned"];
const STRATEGY_KEYS = ["strategyId", "strategyName"];
const PSYCH_KEYS = [
  "emotionBefore", "emotionDuring", "emotionAfter", "confidence",
  "setupQualityRating", "executionRating", "followedPlan", "checklistResults",
];

// Keys that are ALWAYS stripped from anything going to a public/mentor view —
// internal identifiers and server-side bookkeeping.
const ALWAYS_STRIPPED = [
  "userId", "clientMutationId", "storagePath", "tokenHash", "tokenPrefix",
];

// ── trade payload ────────────────────────────────────────────────────────────

export interface RedactedTrade {
  redacted: boolean;
  policy: RedactionPolicy;
  trade: Record<string, unknown>;
}

/**
 * Redacts a trade detail payload (TradeDetailDTO-shaped). Returns a NEW
 * object; the input is never mutated. `screenshots` entries keep only the
 * fields needed for public rendering (id, label, caption, url).
 */
export function redactTrade(
  trade: Record<string, unknown>,
  policy: RedactionPolicy
): RedactedTrade {
  let out = omit(trade, ALWAYS_STRIPPED);

  if (policy.hideAmounts) out = omit(out, AMOUNT_KEYS);
  if (policy.hideAccountInfo) out = omit(out, ACCOUNT_KEYS);
  if (policy.hideNotes) out = omit(out, NOTE_KEYS);
  if (policy.hideStrategyName) out = omit(out, STRATEGY_KEYS);
  if (policy.hidePsychology) out = omit(out, PSYCH_KEYS);

  // Executions: drop per-execution money when amounts are hidden.
  if (Array.isArray(out.executions)) {
    out.executions = (out.executions as Record<string, unknown>[]).map((execution) => {
      let ex = omit(execution, ALWAYS_STRIPPED);
      if (policy.hideAmounts) ex = omit(ex, ["commission", "pnl", "lots"]);
      return ex;
    });
  }

  // Screenshots: dropped entirely, or sanitized to public-safe fields.
  if (policy.hideScreenshots || !Array.isArray(out.screenshots)) {
    out = omit(out, ["screenshots"]);
  } else {
    out.screenshots = (out.screenshots as Record<string, unknown>[]).map((shot) =>
      omit(shot, [...ALWAYS_STRIPPED, "tradeId", "userId", "storagePath", "createdAt"])
    );
  }

  // Tags are safe (name/color/kind) — kept as-is.
  if (policy.hideExactTimes) {
    out = redactTimesDeep(out) as Record<string, unknown>;
  }

  return { redacted: hasAnyRedaction(policy), policy, trade: out };
}

function hasAnyRedaction(policy: RedactionPolicy): boolean {
  return (
    policy.hideAmounts ||
    policy.hideAccountInfo ||
    policy.hideNotes ||
    policy.hideScreenshots ||
    policy.hideStrategyName ||
    policy.hideExactTimes ||
    policy.hidePsychology
  );
}

// ── equity curve / stats payloads ─────────────────────────────────────────────

export interface CurvePoint {
  time: string;
  value: number;
}

/**
 * Normalizes an equity curve when amounts are hidden: converts the curve to
 * cumulative R multiples (needs `initialRisk` per trade order) or to percent
 * of the starting value. When amounts are visible, points pass through with
 * time redaction only.
 */
export function redactEquityCurve(
  points: CurvePoint[],
  policy: RedactionPolicy,
  mode: "PERCENT" | "R_CUMULATIVE" = "PERCENT",
  risks?: number[]
): { points: CurvePoint[]; unit: "CURRENCY" | "PERCENT" | "R" } {
  if (!policy.hideAmounts || points.length === 0) {
    return {
      points: policy.hideExactTimes
        ? points.map((p) => ({ ...p, time: p.time.slice(0, 10) }))
        : points,
      unit: "CURRENCY",
    };
  }

  if (mode === "R_CUMULATIVE" && risks && risks.length === points.length) {
    let cumulative = 0;
    const mapped = points.map((point, index) => {
      cumulative += risks[index];
      return { time: policy.hideExactTimes ? point.time.slice(0, 10) : point.time, value: round(cumulative) };
    });
    return { points: mapped, unit: "R" };
  }

  const start = points[0].value;
  const mapped = points.map((point) => ({
    time: policy.hideExactTimes ? point.time.slice(0, 10) : point.time,
    value: start !== 0 ? round(((point.value - start) / Math.abs(start)) * 100) : 0,
  }));
  return { points: mapped, unit: "PERCENT" };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Redacts a generic stats/breakdown table: removes monetary keys when amounts
 * are hidden, keeps ratios (winRate, profitFactor, expectancy in R…).
 */
const STAT_AMOUNT_KEYS = [
  "netPnl", "grossPnl", "grossWin", "grossLoss", "avgWin", "avgLoss",
  "largestWin", "largestLoss", "maxWin", "maxLoss",
  "totalCommission", "totalSwap", "totalFees", "balance", "equity",
  "maxDrawdownAmount", "maxDrawdown", "initialBalance", "profitAmount",
];

export function redactStats(
  stats: Record<string, unknown>,
  policy: RedactionPolicy
): Record<string, unknown> {
  let out = omit(stats, ALWAYS_STRIPPED);
  if (policy.hideAmounts) out = omit(out, STAT_AMOUNT_KEYS);
  if (policy.hideAccountInfo) out = omit(out, ACCOUNT_KEYS);
  if (policy.hideExactTimes) out = redactTimesDeep(out) as Record<string, unknown>;
  return out;
}

// ── leak testing helpers (used by tests AND runtime assertions) ───────────────

/**
 * Deep-scans a payload for forbidden values. A leak is:
 *  - a string value that CONTAINS a forbidden string (case-sensitive for
 *    numbers, case-insensitive for label-ish probes), or
 *  - a number strictly equal to a forbidden number, or its exact string form.
 * Returns the JSON paths of every leak found (empty = clean).
 */
export function findLeaks(payload: unknown, forbidden: (string | number)[]): string[] {
  const leaks: string[] = [];

  const numberProbes = forbidden.filter((f): f is number => typeof f === "number");
  const stringProbes = forbidden.filter((f): f is string => typeof f === "string");

  function scan(value: unknown, path: string): void {
    if (typeof value === "number") {
      for (const probe of numberProbes) {
        if (value === probe) leaks.push(`${path} (= ${probe})`);
      }
      return;
    }
    if (typeof value === "string") {
      // ISO timestamps are metadata, not monetary values. Their fractional
      // seconds can coincidentally contain a forbidden money probe (e.g.
      // "...:50.000Z" matching "50.00"), so scan them as structured dates.
      if (/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$/.test(value)) {
        return;
      }
      for (const probe of numberProbes) {
        // Exact string form, quoted form, or NUMERIC equality (parses
        // "610.750" — never a substring match, which would flag prices
        // containing the lots value).
        const asNumber = Number(value);
        if (
          value === String(probe) ||
          value.includes(`"${probe}"`) ||
          (value.trim() !== "" && Number.isFinite(asNumber) && asNumber === probe)
        ) {
          leaks.push(`${path} (= ${probe})`);
        }
      }
      for (const probe of stringProbes) {
        if (probe.length >= 2 && value.toLowerCase().includes(probe.toLowerCase())) {
          leaks.push(`${path} (contains "${probe}")`);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => scan(item, `${path}[${index}]`));
      return;
    }
    if (isPlainObject(value)) {
      for (const [key, item] of Object.entries(value)) {
        // The KEY itself can leak (e.g. "accountNumber": "…").
        for (const probe of stringProbes) {
          if (probe.length >= 2 && key.toLowerCase().includes(probe.toLowerCase())) {
            leaks.push(`${path}.${key} (key contains "${probe}")`);
          }
        }
        scan(item, `${path}.${key}`);
      }
    }
  }

  scan(payload, "$");
  return leaks;
}

/** Runtime guard for public endpoints: throws when a leak is detected. */
export function assertNoLeaks(payload: unknown, forbidden: (string | number)[]): void {
  const leaks = findLeaks(payload, forbidden);
  if (leaks.length > 0) {
    throw new Error(`Redaction leak detected: ${leaks.slice(0, 5).join("; ")}`);
  }
}

// ── runtime key-based guard (v3 Phase 4) ────────────────────────────────────

/**
 * Keys that MUST be structurally absent from any payload under this policy.
 * Key-exact matching has no false positives (unlike value scanning, where a
 * visible R of 0.5 can numerically equal hidden lots of 0.5).
 */
export function hiddenKeysForPolicy(policy: RedactionPolicy): string[] {
  return [
    ...ALWAYS_STRIPPED,
    ...(policy.hideAmounts ? AMOUNT_KEYS : []),
    ...(policy.hideAccountInfo ? ACCOUNT_KEYS : []),
    ...(policy.hideNotes ? NOTE_KEYS : []),
    ...(policy.hideStrategyName ? STRATEGY_KEYS : []),
    ...(policy.hidePsychology ? PSYCH_KEYS : []),
    ...(policy.hideScreenshots ? ["screenshots"] : []),
  ];
}

/**
 * Deep key scan: throws when any key that the policy hides is still present
 * anywhere in the payload. This is the runtime tripwire for redaction
 * regressions (a renamed or forgotten field survives key-based removal only
 * by changing its KEY — which this catches).
 */
export function assertNoHiddenKeys(payload: unknown, policy: RedactionPolicy): void {
  const forbidden = new Set(hiddenKeysForPolicy(policy));
  if (forbidden.size === 0) return;
  const hits: string[] = [];
  const scan = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => scan(item, `${path}[${index}]`));
      return;
    }
    if (isPlainObject(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (forbidden.has(key)) hits.push(`${path}.${key}`);
        scan(item, `${path}.${key}`);
      }
    }
  };
  scan(payload, "$");
  if (hits.length > 0) {
    throw new Error(`Redaction leak (hidden key present): ${hits.slice(0, 5).join("; ")}`);
  }
}

/**
 * Collects the forbidden probes for a trade payload — everything the policy
 * hides that must NOT appear anywhere in the serialized output.
 */
export function tradeLeakProbes(
  trade: Record<string, unknown>,
  policy: RedactionPolicy
): (string | number)[] {
  const probes: (string | number)[] = [];
  const push = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      probes.push(value);
      return;
    }
    if (typeof value === "string" && value.length > 0) {
      // Numeric strings (prices, lots, P&L) become NUMBER probes so they are
      // matched with strict equality — substring matching would flag e.g.
      // entryPrice "2650.50" as "containing" lots "0.5".
      if (/^-?\d+(\.\d+)?$/.test(value.trim())) {
        const asNumber = Number(value);
        if (Number.isFinite(asNumber)) {
          probes.push(asNumber);
          return;
        }
      }
      probes.push(value);
    }
  };

  if (policy.hideAccountInfo) {
    push(trade.accountName);
    push(trade.accountId);
    push(trade.broker);
  }
  if (policy.hideStrategyName) push(trade.strategyName);
  if (policy.hideNotes) push(trade.notes);
  if (policy.hideAmounts) {
    push(trade.netPnl);
    push(trade.riskAmount);
    push(trade.lots);
  }
  return probes.filter((probe) => {
    if (typeof probe === "string") {
      // Skip generic/short values that would produce false positives.
      return probe.trim().length >= 2;
    }
    return true;
  });
}
