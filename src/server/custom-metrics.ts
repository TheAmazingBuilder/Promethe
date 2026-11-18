/**
 * Custom metrics CRUD (v2.5 Module 1, spec §4.6) — userId-scoped.
 *
 * Definitions are validated by Zod at the edge; the formula expression is
 * additionally parsed by the safe hand-written parser (no eval) before it is
 * persisted. The evaluator (lib/metrics/evaluator.ts) consumes the stored
 * definition JSON over the dashboard dataset.
 *
 * evaluateDefinitionForUser() powers the builder's live preview: it fetches
 * the closed-trade dataset (same TRADE_INCLUDE + local-parts mapping as
 * dashboard-data.ts, restricted to the MetricTrade subset) and runs the
 * evaluator over ALL closed trades (no period scope — a definition is a
 * whole-history statement).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { validateFormula } from "@/lib/metrics/parser";
import { weekdayOfIsoDate } from "@/lib/analytics/insights";
import {
  evaluateMetric,
  type MetricDefinition,
  type MetricResult,
  type MetricTrade,
} from "@/lib/metrics/evaluator";
import { DashboardValidationError } from "@/server/dashboards";
import type {
  CustomMetricInput,
  CustomMetricPatch,
} from "@/lib/validations/dashboard";

/** Spec §4.6 - max saved metrics per user. */
export const MAX_CUSTOM_METRICS = 50;

type MetricRow = Prisma.CustomMetricGetPayload<Record<string, never>>;

export interface CustomMetricDTO {
  id: string;
  name: string;
  description: string | null;
  /** Parsed MetricDefinition ({ aggregate, filterGroups, formula? }). */
  definition: unknown;
  format: string;
  createdAt: string;
  updatedAt: string;
}

function toMetricDTO(row: MetricRow): CustomMetricDTO {
  let definition: unknown = null;
  try {
    definition = JSON.parse(row.definition);
  } catch {
    definition = null;
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    definition,
    format: row.format,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Formula must parse BEFORE it is persisted (safe parser, no eval). */
function assertFormulaValid(
  definition: CustomMetricInput["definition"]
): void {
  if (
    definition.formula != null &&
    !validateFormula(definition.formula.expression).ok
  ) {
    throw new DashboardValidationError("FORMULA_INVALID", 422);
  }
}

export async function listCustomMetrics(
  userId: string
): Promise<CustomMetricDTO[]> {
  const rows = await db.customMetric.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toMetricDTO);
}

export async function createCustomMetric(
  userId: string,
  input: CustomMetricInput
): Promise<CustomMetricDTO> {
  const count = await db.customMetric.count({ where: { userId } });
  if (count >= MAX_CUSTOM_METRICS) {
    throw new DashboardValidationError("TOO_MANY_METRICS", 409);
  }
  assertFormulaValid(input.definition);

  const row = await db.customMetric.create({
    data: {
      userId,
      name: input.name,
      description: input.description ?? null,
      definition: JSON.stringify(input.definition),
      format: input.format,
    },
  });
  return toMetricDTO(row);
}

export async function patchCustomMetric(
  userId: string,
  metricId: string,
  patch: CustomMetricPatch
): Promise<CustomMetricDTO> {
  const existing = await db.customMetric.findFirst({
    where: { id: metricId, userId },
  });
  if (!existing) {
    throw new DashboardValidationError("METRIC_NOT_FOUND", 404);
  }
  if (patch.definition != null) {
    assertFormulaValid(patch.definition);
  }

  const row = await db.customMetric.update({
    where: { id: existing.id },
    data: {
      ...(patch.name != null ? { name: patch.name } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description ?? null }
        : {}),
      ...(patch.definition != null
        ? { definition: JSON.stringify(patch.definition) }
        : {}),
      ...(patch.format != null ? { format: patch.format } : {}),
    },
  });
  return toMetricDTO(row);
}

export async function deleteCustomMetric(
  userId: string,
  metricId: string
): Promise<boolean> {
  const existing = await db.customMetric.findFirst({
    where: { id: metricId, userId },
  });
  if (!existing) return false;
  await db.customMetric.delete({ where: { id: existing.id } });
  return true;
}

// ── Live preview (builder "Evaluate") ───────────────────────────────────────

const PREVIEW_INCLUDE = {
  instrument: true,
  account: true,
  strategy: true,
  tags: { include: { tag: true } },
} as const;

type PreviewTradeRow = Prisma.TradeGetPayload<{ include: typeof PREVIEW_INCLUDE }>;

/** Local calendar parts in `timezone` - null on invalid TZ (same as dashboard-data). */
function localParts(
  date: Date,
  timezone: string
): { date: string; hour: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    const hour = Number.parseInt(parts.hour ?? "", 10);
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number.isFinite(hour) ? hour : 0,
    };
  } catch {
    return null;
  }
}

/** Trade row → MetricTrade (the evaluator's contract). */
function toMetricTrade(t: PreviewTradeRow, timezone: string): MetricTrade {
  const exit = t.exitTime ?? t.entryTime;
  const entryLocal = localParts(t.entryTime, timezone);
  return {
    id: t.id,
    exitTime: exit.toISOString(),
    entryTime: t.entryTime.toISOString(),
    netPnl: t.netPnl?.toString() ?? null,
    rMultiple: t.rMultiple?.toString() ?? null,
    resultType: t.resultType,
    strategyName: t.strategy?.name ?? null,
    symbol: t.instrument.symbol,
    direction: t.direction,
    session: t.session,
    lots: t.lots.toString(),
    pips: t.pips?.toString() ?? null,
    riskPercent: t.riskPercent?.toString() ?? null,
    emotionBefore: t.emotionBefore,
    setupType: t.setupType,
    accountId: t.accountId,
    accountName: t.account.name,
    tags: t.tags.map((tt) => tt.tag.name),
    localWeekday: entryLocal != null ? weekdayOfIsoDate(entryLocal.date) : null,
    localHour: entryLocal?.hour ?? null,
    durationMin:
      t.exitTime != null
        ? Math.max(
            0,
            Math.round(
              (t.exitTime.getTime() - t.entryTime.getTime()) / (60 * 1000)
            )
          )
        : null,
  };
}

/**
 * Evaluate an unsaved definition over the user's FULL closed-trade history
 * (all accounts, no period scope) — the same numbers the custom-metric widget
 * would show on an all-time dashboard.
 */
export async function evaluateDefinitionForUser(
  userId: string,
  definition: MetricDefinition
): Promise<MetricResult> {
  const [profile, rows] = await Promise.all([
    db.profile.findUnique({ where: { id: userId } }),
    db.trade.findMany({
      where: { userId, status: "CLOSED", isDraft: false },
      include: PREVIEW_INCLUDE,
    }),
  ]);
  const timezone = profile?.timezone ?? "UTC";
  const trades = rows.map((t) => toMetricTrade(t, timezone));
  return evaluateMetric(definition, trades);
}
