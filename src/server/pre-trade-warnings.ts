/**
 * Pre-trade warnings (Lot 11, roadmap §14).
 *
 * Nothing in the app warned before a trade was saved: a trade could
 * breach a mandatory rule (unchecked required checklist item, risk above
 * the per-trade limit, planned R:R below the minimum, too many trades
 * in the day) and the user only found out afterwards, in the violations
 * list. This module checks the draft BEFORE the write and returns
 * advisory warnings. They NEVER block the save - the trade form shows
 * them and the user explicitly confirms "Save anyway".
 *
 * Only what can be known before entry is checked: MAX_DAILY_LOSS needs
 * realised P&L and is not evaluated here; CUSTOM rules are never
 * auto-evaluated, here or anywhere.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { Decimal } from "@/lib/trading/dec";
import { evaluateChecklist } from "@/lib/playbook/checklist";
import { getDisplayPreferences } from "@/server/display-preferences";
import { getTradingDay } from "@/lib/time/trading-day";

export const preTradeWarningsSchema = z.object({
  strategyId: z.string().nullable().optional(),
  riskAmount: z.string().nullable().optional(),
  plannedRR: z.string().nullable().optional(),
  entryTime: z.string().nullable().optional(),
  checklistResults: z.record(z.string(), z.boolean()).nullable().optional(),
});

export type PreTradeWarningsInput = z.infer<typeof preTradeWarningsSchema>;

export interface PreTradeWarning {
  code:
    | "CHECKLIST_INCOMPLETE"
    | "MAX_RISK_PER_TRADE"
    | "MIN_PLANNED_RR"
    | "MAX_TRADES_PER_DAY";
  /** Display-ready English message (numbers included). */
  message: string;
  /** Missing required checklist labels, when the code is CHECKLIST_INCOMPLETE. */
  detail?: string;
}

function fmtAmount(value: string): string {
  try {
    return new Decimal(value).toFixed(2);
  } catch {
    return value;
  }
}

function fmtNumber(value: string): string {
  try {
    return new Decimal(value).toString();
  } catch {
    return value;
  }
}

function toDecimalOrNull(value: string | null | undefined): Decimal | null {
  if (value == null || value.trim() === "") return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

export async function checkPreTradeWarnings(
  userId: string,
  input: PreTradeWarningsInput,
): Promise<PreTradeWarning[]> {
  const warnings: PreTradeWarning[] = [];

  const [strategy, rules, profile, prefs] = await Promise.all([
    input.strategyId
      ? db.strategy.findFirst({
          where: { id: input.strategyId, userId, deletedAt: null },
          include: { checklistItems: { orderBy: { order: "asc" } } },
        })
      : Promise.resolve(null),
    db.tradingRule.findMany({ where: { userId, isActive: true } }),
    db.profile.findUnique({ where: { id: userId } }),
    getDisplayPreferences(userId),
  ]);

  // Required checklist items left unchecked under the CURRENT checklist
  // (a trade is always evaluated against the rules in force at entry).
  if (strategy) {
    const status = evaluateChecklist(
      strategy.checklistItems.map((item) => ({
        id: item.id,
        label: item.label,
        isRequired: item.isRequired,
      })),
      input.checklistResults ?? null,
    );
    if (!status.complete) {
      warnings.push({
        code: "CHECKLIST_INCOMPLETE",
        message: `${status.missing.length} required checklist item${status.missing.length === 1 ? " is" : "s are"} unchecked.`,
        detail: status.missing.join(", "),
      });
    }
  }

  const riskAmount = toDecimalOrNull(input.riskAmount);
  const plannedRR = toDecimalOrNull(input.plannedRR);

  for (const rule of rules) {
    const limit = rule.value.toString();
    if (rule.kind === "MAX_RISK_PER_TRADE" && riskAmount != null) {
      if (riskAmount.gt(new Decimal(limit))) {
        warnings.push({
          code: "MAX_RISK_PER_TRADE",
          message: `Risk $${fmtAmount(riskAmount.toString())} exceeds your limit of $${fmtAmount(limit)} per trade.`,
        });
      }
    }
    if (rule.kind === "MIN_PLANNED_RR" && plannedRR != null) {
      if (plannedRR.lt(new Decimal(limit))) {
        warnings.push({
          code: "MIN_PLANNED_RR",
          message: `Planned R:R ${fmtNumber(plannedRR.toString())} is below your minimum of ${fmtNumber(limit)}.`,
        });
      }
    }
    if (rule.kind === "MAX_TRADES_PER_DAY" && input.entryTime) {
      const timezone = profile?.timezone ?? "UTC";
      const dayOf = (d: Date) => getTradingDay(d, timezone, prefs.tradingDay);
      const entryDay = dayOf(new Date(input.entryTime));
      const from = new Date(`${entryDay}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() - 1);
      const to = new Date(`${entryDay}T00:00:00Z`);
      to.setUTCDate(to.getUTCDate() + 2);
      const entries = await db.trade.findMany({
        where: {
          userId,
          isDraft: false,
          status: { in: ["OPEN", "CLOSED"] },
          entryTime: { gte: from, lt: to },
        },
        select: { entryTime: true },
      });
      const count =
        entries.filter((t) => dayOf(t.entryTime) === entryDay).length + 1;
      if (new Decimal(count).gt(new Decimal(limit))) {
        warnings.push({
          code: "MAX_TRADES_PER_DAY",
          message: `This would be trade ${count} on ${entryDay}, above your limit of ${fmtNumber(limit)} per day.`,
        });
      }
    }
  }

  return warnings;
}
